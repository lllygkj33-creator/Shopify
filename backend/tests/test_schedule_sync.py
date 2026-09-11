"""排期同步测试：改期 / 取消排期推到 Shopify 侧。

重点覆盖**读回校验**这条设计：不假设 Shopify 接受了改动，而是读回来判断。
尤其是「取消排期」—— 如果 publishDate 清不掉，内容仍会到点上线，
必须报 warning 而不是谎报成功。
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.shopify.client import ShopifyError, ShopifyGraphQLError
from app.shopify.schedule_sync import ScheduleSync

NEW_TIME = datetime(2026, 12, 25, 15, 59, tzinfo=timezone.utc)


class FakeClient:
    """按 mutation 名分发，并记录收到的 payload。"""

    def __init__(self, *, node=None, user_errors=None, raise_error=None):
        self.node = node if node is not None else {}
        self.user_errors = user_errors or []
        self.raise_error = raise_error
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, query, variables=None, **kwargs):
        if self.raise_error:
            raise self.raise_error

        variables = variables or {}
        if "articleUpdate" in query:
            self.calls.append(("article", variables))
            return {
                "articleUpdate": {
                    "article": self.node or None,
                    "userErrors": self.user_errors,
                }
            }
        if "pageUpdate" in query:
            self.calls.append(("page", variables))
            return {
                "pageUpdate": {
                    "page": self.node or None,
                    "userErrors": self.user_errors,
                }
            }
        raise AssertionError(f"未预期的查询：{query[:60]}")


def scheduled_node(published_at="2026-12-25T15:59:00Z", is_published=False):
    return {"id": "gid://shopify/Page/1", "handle": "h", "isPublished": is_published, "publishedAt": published_at}


# ---------------------------------------------------------------------------
# 无需同步 / 未知类型
# ---------------------------------------------------------------------------


async def test_no_gid_skips_sync():
    client = FakeClient()
    result = await ScheduleSync(client).reschedule(
        gid="", kind="page", scheduled_at=NEW_TIME
    )

    assert result.attempted is False
    assert result.ok is True
    assert "没有 Shopify 对象" in (result.warning or "")
    assert client.calls == []


async def test_unknown_kind_is_rejected():
    client = FakeClient()
    result = await ScheduleSync(client).reschedule(
        gid="gid://shopify/Product/1", kind="product", scheduled_at=NEW_TIME
    )

    assert result.attempted is False
    assert result.ok is False
    assert "未知" in (result.error or "")


# ---------------------------------------------------------------------------
# 改期
# ---------------------------------------------------------------------------


async def test_reschedule_article_sends_publish_date_and_unpublished():
    client = FakeClient(node=scheduled_node())
    result = await ScheduleSync(client).reschedule(
        gid="gid://shopify/Article/1", kind="Article", scheduled_at=NEW_TIME
    )

    assert result.ok is True
    assert result.attempted is True
    kind, variables = client.calls[0]
    assert kind == "article"
    assert variables["article"]["publishDate"] == "2026-12-25T15:59:00+00:00"
    # 定时发布必须是「未发布 + 未来时间」，与各发布脚本一致
    assert variables["article"]["isPublished"] is False


async def test_reschedule_page_uses_page_update():
    client = FakeClient(node=scheduled_node())
    result = await ScheduleSync(client).reschedule(
        gid="gid://shopify/Page/1", kind="Page", scheduled_at=NEW_TIME
    )

    assert result.ok is True
    assert client.calls[0][0] == "page"
    assert client.calls[0][1]["page"]["publishDate"] == "2026-12-25T15:59:00+00:00"


async def test_reschedule_detects_time_mismatch():
    """Shopify 返回的时间与请求不一致 → 不能报成功。"""
    client = FakeClient(node=scheduled_node("2026-12-26T15:59:00Z"))
    result = await ScheduleSync(client).reschedule(
        gid="gid://shopify/Page/1", kind="Page", scheduled_at=NEW_TIME
    )

    assert result.ok is False
    assert "不一致" in (result.warning or "")


async def test_reschedule_warns_when_still_published():
    client = FakeClient(node=scheduled_node(is_published=True))
    result = await ScheduleSync(client).reschedule(
        gid="gid://shopify/Page/1", kind="Page", scheduled_at=NEW_TIME
    )

    assert result.ok is False
    assert "已发布状态" in (result.warning or "")


async def test_reschedule_warns_when_no_published_at_returned():
    client = FakeClient(node={"id": "x", "isPublished": False, "publishedAt": None})
    result = await ScheduleSync(client).reschedule(
        gid="gid://shopify/Page/1", kind="Page", scheduled_at=NEW_TIME
    )

    assert result.ok is False
    assert "无法确认" in (result.warning or "")


async def test_user_errors_are_surfaced():
    client = FakeClient(
        node=scheduled_node(),
        user_errors=[{"field": ["publishDate"], "message": "时间太远了"}],
    )
    result = await ScheduleSync(client).reschedule(
        gid="gid://shopify/Page/1", kind="Page", scheduled_at=NEW_TIME
    )

    assert result.ok is False
    assert "时间太远了" in (result.error or "")


async def test_shopify_error_is_surfaced():
    client = FakeClient(raise_error=ShopifyGraphQLError([{"message": "boom"}]))
    result = await ScheduleSync(client).reschedule(
        gid="gid://shopify/Page/1", kind="Page", scheduled_at=NEW_TIME
    )

    assert result.ok is False
    assert "boom" in (result.error or "")


# ---------------------------------------------------------------------------
# 取消排期（最危险的一条路径）
# ---------------------------------------------------------------------------


async def test_cancel_clears_publish_date():
    client = FakeClient(node={"id": "x", "isPublished": False, "publishedAt": None})
    result = await ScheduleSync(client).cancel_schedule(
        gid="gid://shopify/Page/1", kind="Page"
    )

    assert result.ok is True
    variables = client.calls[0][1]
    assert variables["page"]["publishDate"] is None
    assert variables["page"]["isPublished"] is False


async def test_cancel_warns_when_publish_date_survives():
    """⚠️ 最危险的情况：本地标草稿，但线上排期还在 → 到点照样上线。"""
    client = FakeClient(node=scheduled_node("2026-12-25T15:59:00Z"))
    result = await ScheduleSync(client).cancel_schedule(
        gid="gid://shopify/Page/1", kind="Page"
    )

    assert result.ok is False
    assert result.attempted is True
    assert "仍保留排期" in (result.warning or "")
    assert "到点上线" in (result.warning or "")


async def test_cancel_without_gid_skips():
    client = FakeClient()
    result = await ScheduleSync(client).cancel_schedule(gid="", kind="")

    assert result.attempted is False
    assert result.ok is True
    assert client.calls == []


async def test_result_serialises_for_api():
    client = FakeClient(node=scheduled_node())
    result = await ScheduleSync(client).reschedule(
        gid="gid://shopify/Page/1", kind="Page", scheduled_at=NEW_TIME
    )
    payload = result.to_dict()

    assert set(payload) == {
        "attempted",
        "ok",
        "action",
        "publishedAt",
        "isPublished",
        "error",
        "warning",
    }
    assert payload["action"] == "reschedule"
