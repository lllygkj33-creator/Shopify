"""博客文章发布器（5 个博客栏目通用）。

**移植来源**：`GEO/publish_articles_random_covers_fixed.py`（2095 行，你确认只有它可用）。

## 与 GEO 脚本的关系

逻辑是**逐条对照移植**的，不是重写。为了可维护性做了三处结构性调整：

1. 同步 `urlopen` → `async httpx`（复用 TokenManager 的自动续期与 401 自愈）
2. 模块级全局变量 + `print` → 类 + 结构化返回值（供 API 逐条回传结果）
3. 交互式 CLI 选择流程 → 去掉（改由前端驱动）

**以下行为刻意保持与脚本完全一致**（这些是最容易被"顺手优化"掉、但会导致行为漂移的地方）：

- `reviewer` 未指定时从默认审核人里**随机**选一个
- 关联产品未指定时从产品池里**随机**选**一个**（不是整列表）
- `meta description` 与 `summary` **必须 ≤ 160 字符**，超出直接报错
- `handle` 必须严格匹配 `[a-z0-9]+(-[a-z0-9]+)*`
- 正文没有 `[[related_products_1]]` 时，在**第 4 个 H2 之前**自动插入；
  **H2 少于 4 个直接报错**
- 封面图从 Shopify Files 里按配置名单匹配后**随机洗牌分配**（一轮内不重复）
- 默认**禁止**创建发布时间已经过去的内容
"""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import unquote, urlparse

from .. import config as app_config
from .html_audit import audit_external_links
from .client import (
    ShopifyError,
    ShopifyGraphQLClient,
    shopify_client,
)
from ..site_config import site

# ---------------------------------------------------------------------------
# 常量（来自可用的发布脚本）
# ---------------------------------------------------------------------------

METAOBJECT_DEFINITION_NAME = "Blog Author Information"

RELATED_PRODUCTS_PLACEHOLDER = "<p><span>[[related_products_1]]</span></p>"

DEFAULT_REVIEWERS_FALLBACK = site.default_reviewers
"""默认评审人兜底（全局设置里没配时用）。

**故意为空**：评审人是真实的人，属于个人信息，不写进仓库。
要固定默认值就在 `.env` 里配 `DEFAULT_REVIEWERS=姓名一,姓名二`（.env 已 gitignore），
或者直接在全局设置界面里填（存到 data/settings.json，同样不提交）。"""

RELATED_PRODUCT_TITLES_FALLBACK = site.related_products

# Shopify 后台 Content > Files 中允许作为文章封面的图片名称（不含扩展名，匹配不区分大小写）。
# 可作为文章封面的图片名（Shopify Content > Files），**部署内容**，来自站点配置
COVER_IMAGE_NAMES: list[str] = [str(x) for x in (site.get("coverImageNames") or [])]

COVER_IMAGE_QUERY_LIMIT = 250
COVER_IMAGE_MAX_PAGES = 20
REQUIRE_ALL_COVER_IMAGES = False

META_DESCRIPTION_MAX_LENGTH = 160
SUMMARY_MAX_LENGTH = 160

HANDLE_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")

PUBLISH_HISTORY_FILE = app_config.DATA_DIR / "publish_history.jsonl"

# 前台域名（用于判断站内/外链；脚本里是 STORE_DOMAIN）
STORE_DOMAIN = site.storefront_domain


class PublishError(RuntimeError):
    """发布失败（面向用户，消息可直接展示）。"""


# ---------------------------------------------------------------------------
# 纯函数：与脚本逐行对应，便于单测
# ---------------------------------------------------------------------------


def normalize_handle(handle: Any) -> str:
    """url → handle。严格校验，与脚本一致。"""
    value = str(handle).strip()

    if value.startswith("https://") or value.startswith("http://"):
        value = (
            value.split("?", 1)[0].split("#", 1)[0].rstrip("/").split("/")[-1]
        )

    value = value.strip("/")

    if not HANDLE_PATTERN.fullmatch(value):
        raise PublishError(
            "url 必须是小写英文、数字和连字符组成的 Handle，" f"当前值：{value}"
        )

    return value


def normalize_tags(tags: Any) -> list[str]:
    if tags is None:
        return []
    if isinstance(tags, str):
        return [tag.strip() for tag in tags.split(",") if tag.strip()]
    if isinstance(tags, list):
        return [str(tag).strip() for tag in tags if str(tag).strip()]
    raise PublishError("tags 必须是字符串或数组。")


def inject_related_products_placeholder(html: str) -> str:
    """在第三个 H2 章节结束后、第四个 H2 开始前插入产品占位符。

    H2 少于 4 个且正文没有现成占位符时**直接报错**（与脚本一致）。
    """
    if RELATED_PRODUCTS_PLACEHOLDER in html:
        return html

    h2_opening_tags = list(re.finditer(r"<h2\b[^>]*>", html, flags=re.IGNORECASE))

    if len(h2_opening_tags) < 4:
        raise PublishError(
            "html代码少于4个H2，无法在第三个H2章节结束后插入 related_products_1。"
        )

    insert_position = h2_opening_tags[3].start()

    return (
        html[:insert_position]
        + RELATED_PRODUCTS_PLACEHOLDER
        + "\n"
        + html[insert_position:]
    )


def filename_from_shopify_url(image_url: str) -> str:
    """从 Shopify CDN URL 中提取文件名，不含查询参数。"""
    parsed = urlparse(str(image_url))
    return unquote(Path(parsed.path).name)


def cover_slot_from_filename(filename: str) -> str | None:
    """把 Shopify 文件名映射到 COVER_IMAGE_NAMES 中的配置名称。

    1. 优先精确匹配文件主名称（不区分大小写）
    2. 兼容 Shopify 为重复上传附加的编号 / 哈希 / UUID 后缀
    3. 配置名称按长度倒序判断，避免 `Frame_3467245` 抢先匹配
       `Frame_3467245_1de55521-...` 这类更长名称
    """
    stem = Path(str(filename)).stem.strip()
    folded_stem = stem.casefold()

    exact_name_map = {name.casefold(): name for name in COVER_IMAGE_NAMES}
    exact_match = exact_name_map.get(folded_stem)
    if exact_match:
        return exact_match

    duplicate_suffix_pattern = re.compile(
        r"(?:\d+|[a-z0-9]{6,}(?:-[a-z0-9]+)*)$", flags=re.IGNORECASE
    )

    for configured_name in sorted(COVER_IMAGE_NAMES, key=len, reverse=True):
        prefix = configured_name.casefold() + "_"
        if not folded_stem.startswith(prefix):
            continue

        suffix = stem[len(configured_name) + 1:]
        if duplicate_suffix_pattern.fullmatch(suffix):
            return configured_name

    return None


def validate_article_html(html: str, shop_domain: str = "") -> list[str]:
    """博客文章的 HTML 规则。

    参考脚本 `publish_articles_random_covers_fixed.py` **不校验链接**，
    所以这一段是平台新增的：只做「外链安全标记」这一条最不容易误伤的规则
    （所有链接要有 title；第三方外链要 _blank + noopener + noreferrer + nofollow）。

    站内（shop.zimaspace.com）与自家域名（*.zimaspace.com）不强制新标签页，
    因此不会误伤既有文章。
    """
    domain = shop_domain or app_config.resolved_shop_domain() or STORE_DOMAIN
    return audit_external_links(html, shop_domain=domain)


def normalize_product_title(title: Any) -> str:
    return re.sub(
        r"\s+", " ", str(title).replace("–", "-").replace("—", "-").strip()
    ).casefold()


@dataclass
class PublishCandidate:
    """已归一化、可直接发布的一条内容。"""

    title: str
    handle: str
    meta_title: str
    meta_description: str
    summary: str
    html: str
    blog_name: str
    author: str
    reviewer: str
    related_product_title: str
    tags: list[str] = field(default_factory=list)
    source_index: int = 0
    source_file: str = ""
    publish_key: str = ""

    # 发布时填充
    cover_image_url: str | None = None
    cover_image_slot: str | None = None
    cover_image_filename: str | None = None


def normalize_article(
    raw_article: dict[str, Any],
    *,
    blog_name: str,
    default_author: str,
    reviewers: Sequence[str],
    product_titles: Sequence[str],
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """把 JSON 里的一篇文章归一化。

    与脚本 `normalize_article()` 行为一致：六个字段全部必填；
    reviewer 与关联产品在未指定时**随机**选取。
    """
    if not isinstance(raw_article, dict):
        raise PublishError("每篇文章必须是 JSON object。")

    required_fields = [
        "blog title",
        "url",
        "meta title",
        "meta description",
        "summary",
        "html代码",
    ]

    missing_fields = [
        field_name
        for field_name in required_fields
        if not str(raw_article.get(field_name, "")).strip()
    ]
    if missing_fields:
        raise PublishError("缺少字段：" + ", ".join(missing_fields))

    title = str(raw_article["blog title"]).strip()
    handle = normalize_handle(raw_article["url"])
    meta_title = str(raw_article["meta title"]).strip()
    meta_description = str(raw_article["meta description"]).strip()
    summary = str(raw_article["summary"]).strip()
    html = inject_related_products_placeholder(str(raw_article["html代码"]).strip())

    author = str(raw_article.get("author", default_author) or default_author).strip()

    reviewer = str(raw_article.get("reviewer", "") or "").strip()
    if not reviewer:
        if not reviewers:
            raise PublishError(
                "JSON 未指定 reviewer，且全局设置里没有默认审核人。"
                "请在全局设置里配置「默认审核人」，或在文章 JSON 里补 reviewer 字段。"
            )
        reviewer = (rng or random).choice(list(reviewers))

    # 脚本里始终随机取一个关联产品；这里保留「显式指定优先」的扩展，
    # 未指定时行为与脚本一致（随机取一个）。
    explicit_products = raw_article.get("related_products") or raw_article.get(
        "related products"
    )
    if isinstance(explicit_products, str) and explicit_products.strip():
        related_product_title = explicit_products.strip()
    elif isinstance(explicit_products, list) and explicit_products:
        related_product_title = str(explicit_products[0]).strip()
    else:
        if not product_titles:
            raise PublishError(
                "没有可用的关联产品。请在全局设置里配置「关联产品标题池」。"
            )
        related_product_title = (rng or random).choice(list(product_titles))

    tags = normalize_tags(raw_article.get("tags", []))

    if len(meta_description) > META_DESCRIPTION_MAX_LENGTH:
        raise PublishError(
            "meta description 超过160个字符，" f"当前长度：{len(meta_description)}"
        )
    if len(summary) > SUMMARY_MAX_LENGTH:
        raise PublishError("summary 超过160个字符，" f"当前长度：{len(summary)}")

    return {
        "title": title,
        "handle": handle,
        "meta_title": meta_title,
        "meta_description": meta_description,
        "summary": summary,
        "html": html,
        "author": author,
        "reviewer": reviewer,
        "related_product_title": related_product_title,
        "tags": tags,
        "blog_name": blog_name,
    }


class RandomCoverImagePool:
    """随机洗牌分配封面：一轮内不重复，全部用完后重新洗牌。"""

    def __init__(self, images: Sequence[dict[str, Any]]) -> None:
        if not images:
            raise PublishError("封面图列表不能为空。")
        self.images = list(images)
        self._deck: list[dict[str, Any]] = []

    def draw(self) -> dict[str, Any]:
        if not self._deck:
            self._deck = random.sample(self.images, k=len(self.images))
        return self._deck.pop()


# ---------------------------------------------------------------------------
# GraphQL 查询
# ---------------------------------------------------------------------------

BLOGS_QUERY = """
query ListBlogs {
  blogs(first: 100) {
    nodes { id title handle }
  }
}
"""

METAOBJECT_DEFINITIONS_QUERY = """
query {
  metaobjectDefinitions(first: 250) {
    nodes { id name type }
  }
}
"""

METAOBJECTS_QUERY = """
query GetAuthors($type: String!) {
  metaobjects(type: $type, first: 250) {
    nodes { id handle displayName }
  }
}
"""

PRODUCTS_QUERY = """
query FindProducts($query: String!) {
  products(first: 50, query: $query) {
    nodes { id title handle status }
  }
}
"""

COVER_SCAN_QUERY = """
query GetRecentCoverImages($first: Int!, $after: String, $query: String!) {
  files(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
    nodes {
      __typename
      id
      alt
      fileStatus
      updatedAt
      ... on MediaImage {
        image { url width height }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

COVER_FILENAME_QUERY = """
query FindCoverImageByFilename($query: String!) {
  files(first: 50, query: $query, sortKey: UPDATED_AT, reverse: true) {
    nodes {
      __typename
      id
      alt
      fileStatus
      updatedAt
      ... on MediaImage {
        image { url width height }
      }
    }
  }
}
"""

ARTICLE_CREATE_MUTATION = """
mutation CreateArticle($article: ArticleCreateInput!) {
  articleCreate(article: $article) {
    article { id title handle isPublished publishedAt }
    userErrors { code field message }
  }
}
"""


# ---------------------------------------------------------------------------
# 发布器
# ---------------------------------------------------------------------------


class BlogPublisher:
    """5 个博客栏目通用的发布器。

    一次 `publish()` 调用内会缓存 blog / person / product 的 GID 查询，
    避免同一批文章重复查询相同资源。
    """

    def __init__(self, client: ShopifyGraphQLClient | None = None) -> None:
        self._client = client or shopify_client
        self._blogs: list[dict[str, Any]] | None = None
        self._people: list[dict[str, Any]] | None = None
        # 缓存整条 blog（含 handle）：title 用来匹配，handle 用来拼 URL
        self._blog_cache: dict[str, dict[str, Any]] = {}
        self._person_cache: dict[str, str] = {}
        self._product_cache: dict[str, str] = {}
        self._cover_pool: RandomCoverImagePool | None = None

    # ---------------- 资源查询（带缓存） ----------------

    async def _load_blogs(self) -> list[dict[str, Any]]:
        if self._blogs is None:
            data = await self._client.execute(BLOGS_QUERY)
            self._blogs = (data.get("blogs") or {}).get("nodes") or []
        return self._blogs

    async def find_blog(self, blog_name: str) -> dict[str, Any]:
        """按**名称**查 Blog（casefold 精确匹配，与脚本一致）。

        返回整条记录而不只是 GID：**handle 和 title 是两回事**。
        `title` 用于匹配（用户/JSON 里写的是 "Tech & AI HUB"），
        而前台 URL 必须用 `handle`（`tech-ai-hub`）——
        用 title 拼出来是 `/blogs/Tech & AI HUB/xxx`，带空格和 `&`，点开是 404。
        """
        if blog_name in self._blog_cache:
            return self._blog_cache[blog_name]

        blogs = await self._load_blogs()
        expected = str(blog_name).strip().casefold()

        for blog in blogs:
            if str(blog.get("title", "")).strip().casefold() == expected:
                self._blog_cache[blog_name] = blog
                return blog

        available = "\n".join(f"- {blog.get('title')}" for blog in blogs)
        raise PublishError(
            f"找不到 Shopify Blog：{blog_name}\n当前 Blog：\n{available}"
        )

    async def find_blog_gid(self, blog_name: str) -> str:
        """按名称查 Blog GID（只需要 id 的调用方用这个）。"""
        return (await self.find_blog(blog_name))["id"]

    async def find_blog_handle(self, blog_name: str) -> str:
        """按名称查 Blog handle（拼前台 URL 用）。"""
        return str((await self.find_blog(blog_name)).get("handle") or "")

    async def _load_people(self) -> list[dict[str, Any]]:
        if self._people is None:
            data = await self._client.execute(METAOBJECT_DEFINITIONS_QUERY)
            definitions = (data.get("metaobjectDefinitions") or {}).get("nodes") or []

            expected = METAOBJECT_DEFINITION_NAME.casefold()
            metaobject_type = None
            for definition in definitions:
                if str(definition.get("name", "")).strip().casefold() == expected:
                    metaobject_type = definition["type"]
                    break

            if not metaobject_type:
                available = "\n".join(
                    f"- {item.get('name')} | {item.get('type')}" for item in definitions
                )
                raise PublishError(
                    f"找不到 Metaobject Definition：{METAOBJECT_DEFINITION_NAME}\n"
                    f"当前定义：\n{available or '- 空'}"
                )

            data = await self._client.execute(
                METAOBJECTS_QUERY, {"type": metaobject_type}
            )
            self._people = (data.get("metaobjects") or {}).get("nodes") or []

        return self._people

    async def find_person_gid(self, person_name: str) -> str:
        if person_name in self._person_cache:
            return self._person_cache[person_name]

        people = await self._load_people()
        expected = str(person_name).strip().casefold()

        for person in people:
            if str(person.get("displayName", "")).strip().casefold() == expected:
                self._person_cache[person_name] = person["id"]
                return person["id"]

        available = "\n".join(f"- {p.get('displayName')}" for p in people)
        raise PublishError(
            f"Blog Author Information 中找不到：{person_name}\n"
            f"当前条目：\n{available}"
        )

    async def find_product_gid(self, product_title: str) -> str:
        if product_title in self._product_cache:
            return self._product_cache[product_title]

        safe_title = str(product_title).replace('"', '\\"')
        data = await self._client.execute(
            PRODUCTS_QUERY, {"query": f'title:"{safe_title}"'}
        )
        products = (data.get("products") or {}).get("nodes") or []

        expected = normalize_product_title(product_title)
        for product in products:
            if normalize_product_title(product.get("title")) == expected:
                self._product_cache[product_title] = product["id"]
                return product["id"]

        available = "\n".join(
            f"- {item.get('title')} | {item.get('handle')}" for item in products
        )
        raise PublishError(
            f"找不到 Shopify 产品：{product_title}\n查询返回：\n{available or '- 空'}"
        )

    # ---------------- 封面图 ----------------

    async def load_cover_images(self) -> list[dict[str, Any]]:
        """读取后台封面图。

        1. 按 UPDATED_AT 倒序分页扫描（默认 ID 正序只会读到旧文件）
        2. 对扫描未命中的名称，用 filename 过滤精确补查
        3. 每个配置名称只保留 updatedAt 最新的一张
        """
        images_by_slot: dict[str, dict[str, Any]] = {}
        after_cursor: str | None = None
        pages_read = 0

        def keep_image(slot: str | None, node: dict[str, Any]) -> None:
            if not slot:
                return
            if node.get("__typename") != "MediaImage":
                return
            if node.get("fileStatus") != "READY":
                return

            image = node.get("image") or {}
            image_url = str(image.get("url") or "").strip()
            if not image_url:
                return

            current = {
                "slot": slot,
                "filename": filename_from_shopify_url(image_url),
                "url": image_url,
                "file_alt": str(node.get("alt") or "").strip(),
                "width": image.get("width"),
                "height": image.get("height"),
                "updated_at": str(node.get("updatedAt") or ""),
                "file_id": node.get("id"),
            }

            previous = images_by_slot.get(slot)
            if previous is None or current["updated_at"] > previous["updated_at"]:
                images_by_slot[slot] = current

        while pages_read < COVER_IMAGE_MAX_PAGES:
            data = await self._client.execute(
                COVER_SCAN_QUERY,
                {
                    "first": COVER_IMAGE_QUERY_LIMIT,
                    "after": after_cursor,
                    "query": "media_type:IMAGE",
                },
            )
            files_data = data.get("files") or {}
            nodes = files_data.get("nodes") or []
            page_info = files_data.get("pageInfo") or {}

            pages_read += 1

            for node in nodes:
                if node.get("__typename") != "MediaImage":
                    continue
                image = node.get("image") or {}
                image_url = str(image.get("url") or "").strip()
                if not image_url:
                    continue
                slot = cover_slot_from_filename(
                    filename_from_shopify_url(image_url)
                )
                keep_image(slot, node)

            if len(images_by_slot) == len(COVER_IMAGE_NAMES):
                break
            if not page_info.get("hasNextPage"):
                break

            after_cursor = page_info.get("endCursor")
            if not after_cursor:
                break

        missing_after_scan = [
            name for name in COVER_IMAGE_NAMES if name not in images_by_slot
        ]

        for configured_name in missing_after_scan:
            escaped_name = configured_name.replace("\\", "\\\\").replace('"', '\\"')
            data = await self._client.execute(
                COVER_FILENAME_QUERY,
                {"query": f'media_type:IMAGE filename:"{escaped_name}"'},
            )
            for node in (data.get("files") or {}).get("nodes") or []:
                if node.get("__typename") != "MediaImage":
                    continue
                image = node.get("image") or {}
                image_url = str(image.get("url") or "").strip()
                if not image_url:
                    continue

                detected_slot = cover_slot_from_filename(
                    filename_from_shopify_url(image_url)
                )
                keep_image(detected_slot or configured_name, node)

        found = [
            images_by_slot[name] for name in COVER_IMAGE_NAMES if name in images_by_slot
        ]
        missing = [
            name for name in COVER_IMAGE_NAMES if name not in images_by_slot
        ]

        if not found:
            raise PublishError(
                "Shopify 后台没有找到任何配置范围内的可用封面图。"
                "请检查 Content > Files 中的文件名、图片状态，"
                "并确认 Token 有 read_files 权限。"
            )

        if missing and REQUIRE_ALL_COVER_IMAGES:
            raise PublishError("封面图不完整，缺少：\n- " + "\n- ".join(missing))

        return found

    async def _get_cover_pool(self) -> RandomCoverImagePool:
        if self._cover_pool is None:
            self._cover_pool = RandomCoverImagePool(await self.load_cover_images())
        return self._cover_pool

    # ---------------- 创建文章 ----------------

    async def create_article(
        self,
        candidate: PublishCandidate,
        *,
        blog_gid: str,
        author_gid: str,
        reviewer_gid: str,
        related_product_gid: str,
        publish_datetime: datetime | None,
        is_published: bool,
    ) -> dict[str, Any]:
        """创建文章。

        - `is_published=False` + 未来 `publish_datetime` → Shopify 到点自动上线（定时发布）
        - `is_published=False` + 无 `publish_datetime` → 存为草稿
        - `is_published=True` → 立即发布

        注意：Shopify 要求**未来的 publishDate 必须与 isPublished=False 配合使用**。
        """
        image: dict[str, Any] = {}
        if candidate.cover_image_url:
            image = {
                "url": candidate.cover_image_url,
                # 用文章标题作为 alt，避免共用图片时 alt 过于泛化
                "altText": candidate.title,
            }

        article_input: dict[str, Any] = {
            "blogId": blog_gid,
            "title": candidate.title,
            "handle": candidate.handle,
            "body": candidate.html,
            "summary": candidate.summary,
            "author": {"name": candidate.author},
            "tags": candidate.tags,
            "isPublished": is_published,
            "metafields": [
                {
                    "namespace": "global",
                    "key": "title_tag",
                    "type": "single_line_text_field",
                    "value": candidate.meta_title,
                },
                {
                    "namespace": "global",
                    "key": "description_tag",
                    "type": "multi_line_text_field",
                    "value": candidate.meta_description,
                },
                {
                    "namespace": "custom",
                    "key": "summary_text",
                    "type": "single_line_text_field",
                    "value": candidate.summary,
                },
                {
                    "namespace": "custom",
                    "key": "author",
                    "type": "metaobject_reference",
                    "value": author_gid,
                },
                {
                    "namespace": "custom",
                    "key": "reviewer",
                    "type": "metaobject_reference",
                    "value": reviewer_gid,
                },
                {
                    "namespace": "custom",
                    "key": "related_products",
                    "type": "list.product_reference",
                    "value": json.dumps([related_product_gid]),
                },
            ],
        }

        if image:
            article_input["image"] = image

        if publish_datetime is not None:
            article_input["publishDate"] = publish_datetime.isoformat()

        data = await self._client.execute(
            ARTICLE_CREATE_MUTATION, {"article": article_input}
        )

        result = data.get("articleCreate") or {}

        user_errors = result.get("userErrors") or []
        if user_errors:
            raise PublishError(json.dumps(user_errors, ensure_ascii=False, indent=2))

        article = result.get("article")
        if not article:
            raise PublishError("Shopify 没有返回 Article。")

        return article


def record_publish_result(record: dict[str, Any]) -> None:
    """写入本地发布记录（jsonl），字段名与脚本一致。"""
    PUBLISH_HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        **record,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(PUBLISH_HISTORY_FILE, "a", encoding="utf-8") as file:
        file.write(json.dumps(payload, ensure_ascii=False) + "\n")
