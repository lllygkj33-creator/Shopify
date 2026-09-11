"""博客反链（可选功能，来自 `publish_user_stories.py`）。

## 它做什么

用户故事页面发布成功后，往一篇**已有的博客文章**正文末尾追加一段上下文反链，
把博客流量引到新发布的用户故事页。

## 两个关键设计

1. **幂等**：块里带一个 marker 注释
   `<!-- ZIMA_USER_STORY_BACKLINK:<page-handle> -->`。
   再次运行时，只要正文里已经有这个 marker（或那条页面 URL），就跳过，
   不会把同一段反链重复追加。
2. **可配置**：JSON 里用 `backlink` 对象描述——
   `article_url`（要挂到哪篇博客）、`lead_in`（引导语）、`anchor_text`（锚文本）。
   `enabled: false` 或整个字段缺失 = 不做反链。

## 与页面发布的关系

反链是**页面成功发布之后**才执行的副作用。页面发布失败就不会执行；
反链失败**不会**回滚已发布的页面（页面本身是成功的），但会把错误报出来。
"""

from __future__ import annotations

import html as html_lib
import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from .client import ShopifyGraphQLClient, shopify_client
from ..site_config import site

# 标记前缀来自站点配置（写进正文 HTML 的注释，用于幂等识别）
BACKLINK_MARKER_PREFIX = site.backlink_marker_prefix
# 写进正文的 HTML 属性名，属于部署侧命名
BACKLINK_ATTR = str(site.get("backlinkAttribute", "data-user-story-backlink"))

FIND_ARTICLE_QUERY = """
query FindBacklinkArticle($query: String!) {
  articles(first: 20, query: $query) {
    nodes {
      id
      title
      handle
      body
      blog { handle }
    }
  }
}
"""

ARTICLE_UPDATE_MUTATION = """
mutation UpdateUserStoryBacklink($id: ID!, $article: ArticleUpdateInput!) {
  articleUpdate(id: $id, article: $article) {
    article { id title handle body blog { handle } }
    userErrors { field message code }
  }
}
"""


class BacklinkError(RuntimeError):
    """反链失败（消息可直接展示）。"""


@dataclass
class BacklinkConfig:
    enabled: bool
    article_url: str = ""
    blog_handle: str = ""
    article_handle: str = ""
    lead_in: str = ""
    anchor_text: str = ""


def parse_blog_article_url(value: str) -> tuple[str, str]:
    """从博客文章 URL 里解析出 (blog_handle, article_handle)。"""
    parsed = urlparse(str(value or ""))
    parts = [part for part in parsed.path.split("/") if part]

    if len(parts) < 3 or parts[0] != "blogs":
        raise BacklinkError(
            "backlink.article_url 必须形如 "
            "https://shop.example-store.test/blogs/<blog-handle>/<article-handle>"
        )

    return parts[1], parts[2]


def load_backlink(data: dict[str, Any]) -> BacklinkConfig | None:
    """从 JSON 里读取 backlink 配置。缺失返回 None。"""
    source = data.get("backlink")
    if source is None:
        return None

    if isinstance(source, str):
        try:
            source = json.loads(source)
        except json.JSONDecodeError as error:
            raise BacklinkError(
                "backlink 是字符串但不是合法 JSON："
                f"第 {error.lineno} 行第 {error.colno} 列：{error.msg}"
            ) from error

    if not isinstance(source, dict):
        raise BacklinkError("backlink 必须是 JSON 对象")

    enabled_raw = source.get("enabled")
    enabled = True if enabled_raw is None else _parse_bool(enabled_raw, default=True)
    if not enabled:
        return BacklinkConfig(enabled=False)

    article_url = str(source.get("article_url") or "").strip()
    lead_in = str(source.get("lead_in") or "").strip()
    anchor_text = str(source.get("anchor_text") or "").strip()

    for field_name, value in (
        ("article_url", article_url),
        ("lead_in", lead_in),
        ("anchor_text", anchor_text),
    ):
        if not value:
            raise BacklinkError(f"backlink.{field_name} 不能为空")

    blog_handle, article_handle = parse_blog_article_url(article_url)

    return BacklinkConfig(
        enabled=True,
        article_url=article_url,
        blog_handle=blog_handle,
        article_handle=article_handle,
        lead_in=lead_in,
        anchor_text=anchor_text,
    )


def _parse_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y", "published", "visible"}:
            return True
        if normalized in {"false", "0", "no", "n", "draft", "hidden"}:
            return False
    return default


def build_backlink_block(
    page_handle: str, page_url: str, backlink: BacklinkConfig
) -> str:
    """构造要追加的 HTML 块（带幂等 marker）。"""
    marker = f"{BACKLINK_MARKER_PREFIX}:{page_handle}"

    lead_in = html_lib.escape(backlink.lead_in, quote=False)
    anchor_text = html_lib.escape(backlink.anchor_text, quote=False)
    url = html_lib.escape(page_url, quote=True)
    title = html_lib.escape(backlink.anchor_text, quote=True)
    data_value = html_lib.escape(page_handle, quote=True)

    return (
        f"<!-- {marker} -->\n"
        f'<p {BACKLINK_ATTR}="{data_value}">'
        f'{lead_in} <a href="{url}" title="{title}">{anchor_text}</a>.'
        f"</p>"
    )


class BacklinkRunner:
    """执行反链：查文章 → 幂等判断 → 追加。"""

    def __init__(self, client: ShopifyGraphQLClient | None = None) -> None:
        self._client = client or shopify_client

    async def find_article(
        self, blog_handle: str, article_handle: str
    ) -> dict[str, Any] | None:
        data = await self._client.execute(
            FIND_ARTICLE_QUERY, {"query": f"handle:{article_handle}"}
        )
        nodes = (data.get("articles") or {}).get("nodes") or []

        for article in nodes:
            blog = article.get("blog") or {}
            if (
                article.get("handle") == article_handle
                and blog.get("handle") == blog_handle
            ):
                return article
        return None

    async def update_article_body(
        self, article_id: str, new_body: str
    ) -> dict[str, Any]:
        data = await self._client.execute(
            ARTICLE_UPDATE_MUTATION, {"id": article_id, "article": {"body": new_body}}
        )
        result = data.get("articleUpdate") or {}

        user_errors = result.get("userErrors") or []
        if user_errors:
            raise BacklinkError(
                "articleUpdate 反链失败："
                + json.dumps(user_errors, ensure_ascii=False)
            )
        if not result.get("article"):
            raise BacklinkError("articleUpdate 没有返回 article")

        return result["article"]

    async def ensure(
        self,
        *,
        page_handle: str,
        page_url: str,
        backlink: BacklinkConfig,
    ) -> str | None:
        """返回 'ADDED' / 'ALREADY PRESENT'；未启用返回 None。"""
        if not backlink.enabled:
            return None

        article = await self.find_article(
            backlink.blog_handle, backlink.article_handle
        )
        if article is None:
            raise BacklinkError(
                "找不到要挂反链的博客文章："
                f"/blogs/{backlink.blog_handle}/{backlink.article_handle}"
            )

        marker = f"{BACKLINK_MARKER_PREFIX}:{page_handle}"
        current_body = article.get("body") or ""

        # 幂等：已有 marker 或已有该页面 URL 就不再追加
        if marker in current_body or page_url in current_body:
            return "ALREADY PRESENT"

        block = build_backlink_block(page_handle, page_url, backlink)
        new_body = current_body.rstrip() + "\n\n" + block + "\n"
        await self.update_article_body(article["id"], new_body)
        return "ADDED"


backlink_runner = BacklinkRunner()


def backlink_marker(page_handle: str) -> str:
    """幂等 marker（供测试与排查使用）。"""
    return f"{BACKLINK_MARKER_PREFIX}:{page_handle}"


__all__ = [
    "BacklinkConfig",
    "BacklinkError",
    "BacklinkRunner",
    "backlink_runner",
    "backlink_marker",
    "build_backlink_block",
    "load_backlink",
    "parse_blog_article_url",
]
