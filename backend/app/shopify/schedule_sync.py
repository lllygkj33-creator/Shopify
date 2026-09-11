"""把本地排期变更同步到 Shopify 侧已创建的对象。

## 为什么需要它

「改期」和「取消排期」只改本地记录是**不够的**，而且后者更危险：

- **改期**：Shopify 侧对象的 `publishDate` 还是旧时间 → 内容会按旧时间上线，
  与仪表盘显示的不一致。
- **取消排期**：本地标成草稿了，但 Shopify 侧 `publishDate` 仍在未来 →
  **到点照样自动上线**，用户以为取消成功了，其实没有。

## 做法

按 GID 的类型分发到 `articleUpdate` / `pageUpdate`（两个 input 的
`publishDate` 与 `isPublished` 都是可空的，Introspection 已确认）。

关键点：**改完立刻用 mutation 的返回值做读回校验**。
因为「传 `null` 能否清空 `publishDate`」这种行为没法在不碰真实内容的前提下预先验证，
所以这里不假设它成功 —— 而是读回来判断，把真实结果如实报给调用方。
校验不通过时不会谎报成功，而是给出 `warning`。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .client import ShopifyError, ShopifyGraphQLClient, shopify_client

ARTICLE_UPDATE = """
mutation SyncArticleSchedule($id: ID!, $article: ArticleUpdateInput!) {
  articleUpdate(id: $id, article: $article) {
    article { id handle isPublished publishedAt }
    userErrors { field message code }
  }
}
"""

PAGE_UPDATE = """
mutation SyncPageSchedule($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) {
    page { id handle isPublished publishedAt }
    userErrors { field message code }
  }
}
"""


@dataclass
class SyncResult:
    """同步结果。`attempted=False` 表示本地没有 Shopify 对象，无需同步。"""

    attempted: bool
    ok: bool
    action: str  # reschedule | cancel
    published_at: str | None = None
    is_published: bool | None = None
    error: str | None = None
    warning: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "attempted": self.attempted,
            "ok": self.ok,
            "action": self.action,
            "publishedAt": self.published_at,
            "isPublished": self.is_published,
            "error": self.error,
            "warning": self.warning,
        }


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


class ScheduleSync:
    def __init__(self, client: ShopifyGraphQLClient | None = None) -> None:
        self._client = client or shopify_client

    # ---------------- 改期 ----------------

    async def reschedule(
        self, *, gid: str, kind: str, scheduled_at: datetime
    ) -> SyncResult:
        """把 `publishDate` 推到新时间，并确保 keep 未发布（由 Shopify 到点上线）。"""
        return await self._update(
            gid=gid,
            kind=kind,
            action="reschedule",
            # 定时发布：isPublished=false + 未来 publishDate，与各发布脚本一致
            payload={
                "publishDate": scheduled_at.isoformat(timespec="seconds"),
                "isPublished": False,
            },
            expect_published_at=scheduled_at,
        )

    # ---------------- 取消排期 ----------------

    async def cancel_schedule(self, *, gid: str, kind: str) -> SyncResult:
        """尽量撤销 Shopify 侧的排期。

        做法：`isPublished=false` + `publishDate=null`。若 Shopify 不接受清空
        （读回后 `publishedAt` 仍有值），如实返回 warning —— 因为这种情况下
        内容仍会到点上线，用户必须知道。
        """
        return await self._update(
            gid=gid,
            kind=kind,
            action="cancel",
            payload={"isPublished": False, "publishDate": None},
            expect_published_at=None,
        )

    # ---------------- 内部 ----------------

    async def _update(
        self,
        *,
        gid: str,
        kind: str,
        action: str,
        payload: dict[str, Any],
        expect_published_at: datetime | None,
    ) -> SyncResult:
        if not gid:
            return SyncResult(
                attempted=False,
                ok=True,
                action=action,
                warning="本地没有 Shopify 对象 GID，跳过同步",
            )

        kind_lower = (kind or "").lower()
        if kind_lower == "article":
            mutation, key, field = ARTICLE_UPDATE, "articleUpdate", "article"
        elif kind_lower == "page":
            mutation, key, field = PAGE_UPDATE, "pageUpdate", "page"
        else:
            return SyncResult(
                attempted=False,
                ok=False,
                action=action,
                error=f"未知的 Shopify 对象类型：{kind}",
            )

        try:
            data = await self._client.execute(
                mutation, {"id": gid, field: payload}
            )
        except ShopifyError as error:
            return SyncResult(
                attempted=True, ok=False, action=action, error=str(error)
            )

        result = data.get(key) or {}

        user_errors = result.get("userErrors") or []
        if user_errors:
            return SyncResult(
                attempted=True,
                ok=False,
                action=action,
                error=json.dumps(user_errors, ensure_ascii=False),
            )

        node = result.get(field) or {}
        returned_published_at = node.get("publishedAt")
        returned_is_published = node.get("isPublished")

        # 读回校验：不假设 Shopify 接受了我们的改动
        returned_dt = _parse_iso(returned_published_at)

        if action == "cancel":
            if returned_dt is not None:
                return SyncResult(
                    attempted=True,
                    ok=False,
                    action=action,
                    published_at=str(returned_published_at),
                    is_published=returned_is_published,
                    warning=(
                        "Shopify 侧仍保留排期时间（publishDate 未能清空），"
                        "内容可能仍会到点上线；请到 Shopify 后台确认或手动改为草稿"
                    ),
                )
            return SyncResult(
                attempted=True,
                ok=True,
                action=action,
                published_at=None,
                is_published=returned_is_published,
            )

        # reschedule
        if returned_dt is None:
            return SyncResult(
                attempted=True,
                ok=False,
                action=action,
                is_published=returned_is_published,
                warning="Shopify 没有返回 publishedAt，无法确认改期是否生效",
            )

        assert expect_published_at is not None
        if returned_dt.astimezone(timezone.utc) != expect_published_at.astimezone(
            timezone.utc
        ):
            return SyncResult(
                attempted=True,
                ok=False,
                action=action,
                published_at=str(returned_published_at),
                is_published=returned_is_published,
                warning=(
                    "Shopify 返回的 publishedAt 与请求时间不一致："
                    f"请求 {expect_published_at.isoformat(timespec='seconds')}，"
                    f"返回 {returned_published_at}"
                ),
            )

        if returned_is_published is not False:
            return SyncResult(
                attempted=True,
                ok=False,
                action=action,
                published_at=str(returned_published_at),
                is_published=returned_is_published,
                warning="页面/文章在 Shopify 侧是已发布状态，排期可能不会按预期生效",
            )

        return SyncResult(
            attempted=True,
            ok=True,
            action=action,
            published_at=str(returned_published_at),
            is_published=returned_is_published,
        )


schedule_sync = ScheduleSync()

__all__ = ["ARTICLE_UPDATE", "PAGE_UPDATE", "ScheduleSync", "SyncResult", "schedule_sync"]
