"""从 Shopify 导入既有内容 + 定时对账。

## 为什么需要

平台的本地库是**平台自己做过什么**的记录。但店铺里已经有大量历史内容
（实测 2748 条：1961 篇文章 + 787 个页面），如果不导入：

- 仪表盘第一天是空的，看不出任何排期全景
- 每个栏目的历史记录里没有既有的已发布内容
- 对账没有基线

## 两种操作

| | 作用 | 何时用 |
|---|---|---|
| **导入** | 把 Shopify 侧既有内容拉进本地库 | 一次性（或补历史） |
| **对账** | 用 Shopify 的真实状态修正本地记录 | 定时 / 手动 |

对账要解决的具体问题：到点后 Shopify 会自己把 `isPublished` 翻成 true
（我们的定时发布就是这么设计的），本地必须跟上；还有人在后台改了时间、
删了页面、改了 handle 的情况。

## 幂等

导入的行用合成 `publish_key`：`shopify|<kind>|<gid>`。
所以重复导入只会更新，不会产生重复行；也不会覆盖平台自己发布的那条记录
（那种记录的 publish_key 是 `channel|file|index|handle`）。

## 不在平台栏目内的内容

实测店铺里有 `zima-campaign-hub`(288 篇)、`news`(1 篇)、
`app-hardware-requirements`(118 个)、`local-ai-model-hardware`(50 个) 等
不属于平台 11 个栏目的内容。这些**跳过但报数**，让用户知道什么没进来。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .channel_map import resolve_article_channel, resolve_page_channel
from .shopify.client import ShopifyError, ShopifyGraphQLClient, shopify_client
from .storage import ContentStore, store as default_store

# 复用发布器里的前台域名（页面 URL 展示用）
STORE_DOMAIN = "shop.zimaspace.com"

ARTICLES_QUERY = """
query ImportArticles($after: String) {
  articles(first: 250, after: $after, sortKey: PUBLISHED_AT, reverse: true) {
    nodes {
      id
      title
      handle
      isPublished
      publishedAt
      createdAt
      blog { handle title }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

PAGES_QUERY = """
query ImportPages($after: String) {
  pages(first: 250, after: $after, sortKey: PUBLISHED_AT, reverse: true) {
    nodes {
      id
      title
      handle
      isPublished
      publishedAt
      createdAt
      templateSuffix
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

# 安全上限：避免异常情况下无限翻页（实测文章 8 页、页面 4 页）
MAX_PAGES = 40

IMPORT_SOURCE_TAG = "shopify-import"


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


def derive_status(
    is_published: bool, published_at: datetime | None, now: datetime
) -> str:
    """把 Shopify 的状态映射成平台的状态。

    - 已发布 → published
    - 未发布但 publishedAt 在未来 → scheduled（这就是 Shopify 的排期）
    - 其余（未发布且无未来时间）→ draft
    """
    if is_published:
        return "published"
    if published_at is not None and published_at > now:
        return "scheduled"
    return "draft"


@dataclass
class ImportReport:
    articles_scanned: int = 0
    pages_scanned: int = 0
    imported: int = 0
    by_channel: dict[str, int] = field(default_factory=dict)
    by_status: dict[str, int] = field(default_factory=dict)
    skipped: dict[str, int] = field(default_factory=dict)
    """未导入的归属 → 数量（让用户知道什么没进来）。"""
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "articlesScanned": self.articles_scanned,
            "pagesScanned": self.pages_scanned,
            "imported": self.imported,
            "byChannel": dict(sorted(self.by_channel.items(), key=lambda kv: -kv[1])),
            "byStatus": self.by_status,
            "skipped": dict(sorted(self.skipped.items(), key=lambda kv: -kv[1])),
            "error": self.error,
        }


@dataclass
class ReconcileReport:
    checked: int = 0
    """本地有 GID 的行数"""
    matched: int = 0
    updated: int = 0
    gone: int = 0
    remote_total: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "checked": self.checked,
            "matched": self.matched,
            "updated": self.updated,
            "gone": self.gone,
            "remoteTotal": self.remote_total,
            "error": self.error,
        }


class ShopifyImporter:
    def __init__(
        self,
        client: ShopifyGraphQLClient | None = None,
        store: ContentStore | None = None,
    ) -> None:
        self._client = client or shopify_client
        self._store = store or default_store

    # ---------------- 抓取 ----------------

    async def _fetch_all(self, query: str, key: str) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        after: str | None = None
        pages_read = 0

        while pages_read < MAX_PAGES:
            data = await self._client.execute(query, {"after": after})
            connection = data.get(key) or {}
            nodes.extend(connection.get("nodes") or [])
            pages_read += 1

            page_info = connection.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                break
            after = page_info.get("endCursor")
            if not after:
                break

        return nodes

    # ---------------- 导入 ----------------

    async def import_all(self) -> ImportReport:
        report = ImportReport()
        now = datetime.now(timezone.utc)

        try:
            articles = await self._fetch_all(ARTICLES_QUERY, "articles")
            pages = await self._fetch_all(PAGES_QUERY, "pages")
        except ShopifyError as error:
            report.error = str(error)
            return report

        report.articles_scanned = len(articles)
        report.pages_scanned = len(pages)

        records: list[dict[str, Any]] = []
        skipped: dict[str, int] = {}

        for article in articles:
            blog = article.get("blog") or {}
            resolution = resolve_article_channel(blog.get("handle"))

            if not resolution.resolved:
                label = resolution.reason or "未知"
                skipped[label] = skipped.get(label, 0) + 1
                continue

            blog_handle = str(blog.get("handle") or "")
            handle = str(article.get("handle") or "")
            published_at = _parse_iso(article.get("publishedAt"))
            status = derive_status(bool(article.get("isPublished")), published_at, now)

            records.append(
                {
                    "channel_id": resolution.channel_id,
                    "content_type": "blog_article",
                    "title": str(article.get("title") or ""),
                    "handle": handle,
                    "blog_name": str(blog.get("title") or ""),
                    "status": status,
                    "scheduled_at": (
                        published_at.isoformat()
                        if status == "scheduled" and published_at
                        else None
                    ),
                    "published_at": published_at.isoformat() if published_at else None,
                    "published_url": (
                        f"/blogs/{blog_handle}/{handle}" if published_at else None
                    ),
                    "shopify_gid": str(article.get("id") or ""),
                    "shopify_kind": "Article",
                    "publish_key": f"{IMPORT_SOURCE_TAG}|Article|{article.get('id')}",
                    "source_file": IMPORT_SOURCE_TAG,
                }
            )

        for page in pages:
            resolution = resolve_page_channel(page.get("templateSuffix"))

            if not resolution.resolved:
                label = resolution.reason or "未知"
                skipped[label] = skipped.get(label, 0) + 1
                continue

            handle = str(page.get("handle") or "")
            published_at = _parse_iso(page.get("publishedAt"))
            status = derive_status(bool(page.get("isPublished")), published_at, now)

            records.append(
                {
                    "channel_id": resolution.channel_id,
                    "content_type": "page",
                    "title": str(page.get("title") or ""),
                    "handle": handle,
                    "template": page.get("templateSuffix"),
                    "status": status,
                    "scheduled_at": (
                        published_at.isoformat()
                        if status == "scheduled" and published_at
                        else None
                    ),
                    "published_at": published_at.isoformat() if published_at else None,
                    "published_url": (
                        f"https://{STORE_DOMAIN}/pages/{handle}" if published_at else None
                    ),
                    "shopify_gid": str(page.get("id") or ""),
                    "shopify_kind": "Page",
                    "publish_key": f"{IMPORT_SOURCE_TAG}|Page|{page.get('id')}",
                    "source_file": IMPORT_SOURCE_TAG,
                }
            )

        self._store.upsert_many(records)

        report.imported = len(records)
        report.skipped = skipped

        for record in records:
            channel_id = record["channel_id"]
            report.by_channel[channel_id] = report.by_channel.get(channel_id, 0) + 1
            status = record["status"]
            report.by_status[status] = report.by_status.get(status, 0) + 1

        return report

    # ---------------- 对账 ----------------

    async def reconcile(self) -> ReconcileReport:
        report = ReconcileReport()
        now = datetime.now(timezone.utc)

        local_rows = self._store.list_with_gid()
        report.checked = len(local_rows)

        if not local_rows:
            return report

        try:
            articles = await self._fetch_all(ARTICLES_QUERY, "articles")
            pages = await self._fetch_all(PAGES_QUERY, "pages")
        except ShopifyError as error:
            report.error = str(error)
            return report

        report.remote_total = len(articles) + len(pages)

        remote: dict[str, dict[str, Any]] = {}
        for article in articles:
            remote[str(article.get("id") or "")] = {
                "kind": "Article",
                "isPublished": bool(article.get("isPublished")),
                "publishedAt": _parse_iso(article.get("publishedAt")),
                "handle": article.get("handle"),
                "title": article.get("title"),
            }
        for page in pages:
            remote[str(page.get("id") or "")] = {
                "kind": "Page",
                "isPublished": bool(page.get("isPublished")),
                "publishedAt": _parse_iso(page.get("publishedAt")),
                "handle": page.get("handle"),
                "title": page.get("title"),
            }

        gone_gids: list[str] = []

        for row in local_rows:
            gid = str(row.get("shopify_gid") or "")
            node = remote.get(gid)

            if node is None:
                gone_gids.append(gid)
                report.gone += 1
                continue

            report.matched += 1

            status = derive_status(node["isPublished"], node["publishedAt"], now)
            published_at = (
                node["publishedAt"].isoformat() if node["publishedAt"] else None
            )
            # 未发布且没有未来时间 → 清掉本地排期（线上已不是排期状态）
            scheduled_at = (
                published_at if status == "scheduled" else None
            )

            changed = (
                row.get("status") != status
                or (row.get("published_at") or None) != published_at
                or (row.get("scheduled_at") or None) != scheduled_at
            )

            if changed:
                self._store.apply_shopify_state(
                    gid,
                    status=status,
                    published_at=published_at,
                    scheduled_at=scheduled_at,
                    handle=node["handle"],
                    title=node["title"],
                )
                report.updated += 1

        if gone_gids:
            self._store.mark_gone(
                gone_gids, "对账时在 Shopify 上未找到该对象（可能已在后台删除）"
            )

        return report


shopify_importer = ShopifyImporter()

__all__ = [
    "ARTICLES_QUERY",
    "IMPORT_SOURCE_TAG",
    "ImportReport",
    "PAGES_QUERY",
    "ReconcileReport",
    "ShopifyImporter",
    "derive_status",
    "shopify_importer",
]
