"""把 Shopify 上的**真实状态**对回本地记录。

## 为什么要对账

平台发布定时内容用的是 Shopify 原生机制：创建时就给一个未来的 `publishDate`
并且 `isPublished: false`，到点由 Shopify 自己把它上线。

好处是本地不需要定时任务，服务没开也不会漏发。代价是：**到点那一刻
Shopify 不会通知我们**，本地记录的 `status` 会一直停在 `scheduled`。
不对账的话，用户看到的是「内容还没发」，而线上其实早就发出去了。

对账还要覆盖人在 Shopify 后台做的改动：改发布时间、改标题、改 handle、
以及最要紧的 —— **删掉一个还没到点的对象**。最后这种如果本地不知道，
用户会以为它还会按时上线。

## 只对账「平台自己碰过的对象」

本地库只记平台自己排期/发布的内容（`shopify_gid` 非空的行）。
店铺里平台上线之前就存在的历史内容**不入库** —— 用户明确要求
「只存平台自己发布的 和未来的，过去的通通不记录」。

所以历史内容不需要导入，也不需要维护一份镜像，自然也不存在
「本地和线上对不上」这种漂移问题。

## 为什么按 GID 直查，不拉全量

拉全量要 12 次分页请求（实测 1961 篇文章 + 787 个页面），而本地要核对的
通常只有几条到几十条。`nodes(ids:)` 一次能查 250 个，正好：

  - 1 次请求搞定，不随店铺历史增长而变慢
  - 对象已被删除时返回 `null` —— 这就是「gone」的信号，不需要额外接口
  - 没有额外权限要求
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..storage import ContentStore, store as default_store
from .client import ShopifyError, ShopifyGraphQLClient, shopify_client

# nodes(ids:) 单次上限
MAX_IDS_PER_QUERY = 250

NODES_QUERY = """
query ReconcileNodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    id
    ... on Article { title handle isPublished publishedAt }
    ... on Page { title handle isPublished publishedAt }
  }
}
"""


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


def normalize_iso(value: Any) -> str | None:
    """把时间统一成同一种写法再比较。

    为什么需要：Shopify 回的是 `...Z`，而本地有时存的是 `+00:00`。
    直接比字符串会把「本来就一致」的行算成有改动 —— 用户会看到
    「修正了 1 条」而实际上什么都没变。首次对账时必然发生一次。
    """
    parsed = _parse_iso(value)
    return parsed.isoformat() if parsed else None


def derive_status(
    is_published: bool, published_at: datetime | None, now: datetime
) -> str:
    """把 Shopify 的状态映射成平台的状态。

    - 已发布 → published
    - 未发布但 publishDate 在未来 → scheduled（这就是我们的排期）
    - 其余（未发布且没有未来时间）→ draft
    """
    if is_published:
        return "published"
    if published_at is not None and published_at > now:
        return "scheduled"
    return "draft"


@dataclass
class ReconcileReport:
    """对账结果。字段都是「用户要能够据此判断要不要管」的量。"""

    checked: int = 0
    """参与对账的本地行数（有 GID 的行）"""

    matched: int = 0
    """在线上还找得到的行数"""

    updated: int = 0
    """状态 / 时间 / 标题与线上不一致、已被修正的行数"""

    gone: int = 0
    """线上已不存在（后台被删）的行数"""

    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "checked": self.checked,
            "matched": self.matched,
            "updated": self.updated,
            "gone": self.gone,
            "error": self.error,
        }


class ShopifyReconciler:
    def __init__(
        self,
        client: ShopifyGraphQLClient | None = None,
        store: ContentStore | None = None,
    ) -> None:
        self._client = client or shopify_client
        self._store = store or default_store

    async def _fetch_nodes(self, gids: list[str]) -> dict[str, dict[str, Any]]:
        """按 GID 批量取回线上状态。已删除的对象不会出现在结果里。"""
        found: dict[str, dict[str, Any]] = {}

        for start in range(0, len(gids), MAX_IDS_PER_QUERY):
            chunk = gids[start : start + MAX_IDS_PER_QUERY]
            data = await self._client.execute(NODES_QUERY, {"ids": chunk})

            for node in data.get("nodes") or []:
                # 对象不存在时 Shopify 返回 null，跳过即可
                if not node or not node.get("id"):
                    continue
                found[str(node["id"])] = node

        return found

    async def reconcile(self) -> ReconcileReport:
        report = ReconcileReport()
        now = datetime.now(timezone.utc)

        local_rows = self._store.list_with_gid()
        report.checked = len(local_rows)

        if not local_rows:
            # 本地还没有平台发布过的东西：不用打接口
            return report

        gids = [str(row["shopify_gid"]) for row in local_rows]

        try:
            remote = await self._fetch_nodes(gids)
        except ShopifyError as error:
            report.error = str(error)
            return report

        gone_gids: list[str] = []

        for row in local_rows:
            gid = str(row["shopify_gid"])
            node = remote.get(gid)

            if node is None:
                gone_gids.append(gid)
                report.gone += 1
                continue

            report.matched += 1

            published_at_dt = _parse_iso(node.get("publishedAt"))
            status = derive_status(
                bool(node.get("isPublished")), published_at_dt, now
            )
            # `published_at` 与 `scheduled_at` 是两个字段，各管各的：
            #   - 排期中的项，Shopify 也会返回一个**未来**的 publishedAt，
            #     但它还没真的发布 —— 写进 published_at 会让时间轴把它显示成
            #     「已发布」，而且会与拉取写入的 None 冲突、被判成反复有更新
            #   - 已发布的项不该再留 scheduled_at，否则时间轴同时显示两条
            published_at = (
                published_at_dt.isoformat()
                if status == "published" and published_at_dt
                else None
            )
            scheduled_at = (
                published_at_dt.isoformat()
                if status == "scheduled" and published_at_dt
                else None
            )

            # 时间要归一化后再比，不然 `...Z` 和 `+00:00` 会被判成不一致
            changed = (
                row.get("status") != status
                or normalize_iso(row.get("published_at")) != published_at
                or normalize_iso(row.get("scheduled_at")) != scheduled_at
                or (row.get("title") or None) != (node.get("title") or None)
                or (row.get("handle") or None) != (node.get("handle") or None)
            )

            if changed:
                self._store.apply_shopify_state(
                    gid,
                    status=status,
                    published_at=published_at,
                    scheduled_at=scheduled_at,
                    handle=node.get("handle"),
                    title=node.get("title"),
                )
                report.updated += 1

        if gone_gids:
            # 本地留痕而不是删行：用户需要知道「这条我在后台删掉了」，
            # 静默消失比显示一个错误更让人困惑
            self._store.mark_gone(
                gone_gids, "对账时在 Shopify 上未找到该对象（可能已在后台删除）"
            )

        return report


shopify_reconciler = ShopifyReconciler()

__all__ = [
    "MAX_IDS_PER_QUERY",
    "NODES_QUERY",
    "ReconcileReport",
    "ShopifyReconciler",
    "derive_status",
    "normalize_iso",
    "shopify_reconciler",
]
