"""把 Shopify 上**尚未上线的排期**拉进本地库。

## 为什么需要

用户要求本地库「只存平台自己发布的**和未来的**，过去的通通不记录」。
「未来的」这半句很关键：排期不是平台独有的事 —— 内容可能是在 Shopify
后台、或别的工具（GEO 那套脚本）排上去的。

实测店铺里有 **172 条页面** + 2 篇文章已经排好期（`isPublished: false`
+ 未来 `publishedAt`），而平台一条都不知道。不拉进来的话，仪表盘显示的
「排期全景」是残缺的 —— 用户明明排了 100 多条，界面写 0。

## 只拉未来，不拉过去

这是与「导入历史」的本质区别：拉完之后本地库仍然**不含**店铺的 2748 条
既有已发布内容。所以：

  - 不需要维护一份镜像，不存在「本地 N 条 vs 线上 M 条对不上」
  - 拉取成本固定：用 `published_status:unpublished` 过滤，实测 12 文章 +
    184 页面各一页搞定（**一次请求**），不随店铺历史增长

## 归属判断

拉回来要放进哪个栏目？文章看 blog handle，页面看 templateSuffix
（见 `channel_map.py`）。认不出来的**不入库但报数** ——
实测有 2 篇排期文章在 `zima-campaign-hub` 博客里，不属于平台任何栏目。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ..storage import ContentStore, store as default_store
from .channel_map import resolve_article_channel, resolve_page_channel
from .client import ShopifyError, ShopifyGraphQLClient, shopify_client

# 复用发布器里的前台域名（页面 URL 展示用）
STORE_DOMAIN = "shop.zimaspace.com"

# 一次请求同时拿未发布的文章和页面。实测店铺 12 文章 / 184 页面，各一页。
# 上限用于异常情况兜底（正常永远翻不到第二页）。
UNPUBLISHED_QUERY = """
query PullScheduled($after: String) {
  articles(first: 250, after: $after, query: "published_status:unpublished") {
    nodes {
      id
      title
      handle
      isPublished
      publishedAt
      blog { handle title }
    }
    pageInfo { hasNextPage endCursor }
  }
  pages(first: 250, after: $after, query: "published_status:unpublished") {
    nodes {
      id
      title
      handle
      isPublished
      publishedAt
      templateSuffix
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

MAX_PAGES = 10

REMOTE_SOURCE_TAG = "shopify-schedule"


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    normalized = str(value).strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


@dataclass
class PullReport:
    articles_scanned: int = 0
    """未发布文章总数（含草稿）"""
    pages_scanned: int = 0
    """未发布页面总数（含草稿）"""
    scheduled_found: int = 0
    """其中时间在未来 = 已排期"""
    upserted: int = 0
    """写入本地的条数（含更新已有行）"""
    by_channel: dict[str, int] = field(default_factory=dict)
    skipped: dict[str, int] = field(default_factory=dict)
    """未能归属的原因 → 条数"""
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "articlesScanned": self.articles_scanned,
            "pagesScanned": self.pages_scanned,
            "scheduledFound": self.scheduled_found,
            "upserted": self.upserted,
            "byChannel": dict(sorted(self.by_channel.items(), key=lambda kv: -kv[1])),
            "skipped": dict(sorted(self.skipped.items(), key=lambda kv: -kv[1])),
            "error": self.error,
        }


class SchedulePuller:
    def __init__(
        self,
        client: ShopifyGraphQLClient | None = None,
        store: ContentStore | None = None,
    ) -> None:
        self._client = client or shopify_client
        self._store = store or default_store

    async def _fetch_unpublished(self) -> tuple[list[dict], list[dict]]:
        articles: list[dict] = []
        pages: list[dict] = []
        after: str | None = None
        reads = 0

        while reads < MAX_PAGES:
            data = await self._client.execute(UNPUBLISHED_QUERY, {"after": after})
            reads += 1

            article_conn = data.get("articles") or {}
            page_conn = data.get("pages") or {}
            articles.extend(article_conn.get("nodes") or [])
            pages.extend(page_conn.get("nodes") or [])

            has_next = (article_conn.get("pageInfo") or {}).get("hasNextPage") or (
                page_conn.get("pageInfo") or {}
            ).get("hasNextPage")
            if not has_next:
                break
            after = (article_conn.get("pageInfo") or {}).get("endCursor")
            if not after:
                break

        return articles, pages

    async def pull(self) -> PullReport:
        report = PullReport()
        now = datetime.now(timezone.utc)

        try:
            articles, pages = await self._fetch_unpublished()
        except ShopifyError as error:
            report.error = str(error)
            return report

        report.articles_scanned = len(articles)
        report.pages_scanned = len(pages)

        records: list[dict[str, Any]] = []

        for article in articles:
            published_at = _parse_iso(article.get("publishedAt"))
            # 只留未来：未发布且没有未来时间的是草稿，属于「过去」那一类，不收
            if published_at is None or published_at <= now:
                continue

            blog = article.get("blog") or {}
            resolution = resolve_article_channel(blog.get("handle"))
            report.scheduled_found += 1

            if not resolution.resolved:
                label = resolution.reason or "未知"
                report.skipped[label] = report.skipped.get(label, 0) + 1
                continue

            handle = str(article.get("handle") or "")
            records.append(
                {
                    "channel_id": resolution.channel_id,
                    "content_type": "blog_article",
                    "title": str(article.get("title") or ""),
                    "handle": handle,
                    "blog_name": str(blog.get("title") or ""),
                    "status": "scheduled",
                    "scheduled_at": published_at.isoformat(),
                    "published_at": None,
                    "published_url": (
                        f"/blogs/{blog.get('handle')}/{handle}" if handle else None
                    ),
                    "shopify_gid": str(article.get("id") or ""),
                    "shopify_kind": "Article",
                    "publish_key": f"{REMOTE_SOURCE_TAG}|Article|{article.get('id')}",
                    "source_file": REMOTE_SOURCE_TAG,
                }
            )

        for page in pages:
            published_at = _parse_iso(page.get("publishedAt"))
            if published_at is None or published_at <= now:
                continue

            resolution = resolve_page_channel(page.get("templateSuffix"))
            report.scheduled_found += 1

            if not resolution.resolved:
                label = resolution.reason or "未知"
                report.skipped[label] = report.skipped.get(label, 0) + 1
                continue

            handle = str(page.get("handle") or "")
            records.append(
                {
                    "channel_id": resolution.channel_id,
                    "content_type": "page",
                    "title": str(page.get("title") or ""),
                    "handle": handle,
                    "template": page.get("templateSuffix"),
                    "status": "scheduled",
                    "scheduled_at": published_at.isoformat(),
                    "published_at": None,
                    "published_url": (
                        f"https://{STORE_DOMAIN}/pages/{handle}" if handle else None
                    ),
                    "shopify_gid": str(page.get("id") or ""),
                    "shopify_kind": "Page",
                    "publish_key": f"{REMOTE_SOURCE_TAG}|Page|{page.get('id')}",
                    "source_file": REMOTE_SOURCE_TAG,
                }
            )

        for record in records:
            # upsert_remote 会先按 GID 找已有行（平台自己发过的那些），
            # 避免同一个线上对象在本地出现两行
            self._store.upsert_remote(record)
            channel_id = record["channel_id"]
            report.by_channel[channel_id] = report.by_channel.get(channel_id, 0) + 1

        report.upserted = len(records)
        return report


schedule_puller = SchedulePuller()

__all__ = [
    "MAX_PAGES",
    "REMOTE_SOURCE_TAG",
    "STORE_DOMAIN",
    "UNPUBLISHED_QUERY",
    "PullReport",
    "SchedulePuller",
    "schedule_puller",
]
