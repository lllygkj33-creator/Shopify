"""本地存储层测试。

重点：publish_key 幂等、时间轴过滤、统计口径、改期/取消排期。
"""

from __future__ import annotations

import pytest

from app.storage import ContentStore


@pytest.fixture()
def store(tmp_path) -> ContentStore:
    return ContentStore(tmp_path / "test.db")


def make_record(**overrides):
    base = {
        "channel_id": "buying-guide",
        "content_type": "blog_article",
        "title": "Is One NVMe Slot Enough?",
        "handle": "is-one-nvme-slot-enough",
        "blog_name": "Buying Guide",
        "status": "scheduled",
        "scheduled_at": "2026-09-15T14:30:00+00:00",
        "publish_key": "buying-guide|batch.json|0|is-one-nvme-slot-enough",
        "source_file": "buying-guide/batch.json",
        "source_index": 0,
        "mode": "schedule",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 幂等
# ---------------------------------------------------------------------------


def test_upsert_creates_row(store):
    row = store.upsert(make_record())

    assert row["id"] == 1
    assert row["status"] == "scheduled"
    assert row["channel_id"] == "buying-guide"


def test_same_publish_key_updates_instead_of_inserting(store):
    store.upsert(make_record())
    row = store.upsert(make_record(status="published", published_at="2026-09-15T14:30:05+00:00"))

    assert row["id"] == 1
    assert len(store.list_contents()) == 1
    assert row["status"] == "published"


def test_failure_then_retry_updates_same_row(store):
    store.upsert(make_record(status="failed", error="正文少于 4 个 H2"))
    row = store.upsert(make_record(status="scheduled", error=None))

    assert row["id"] == 1
    assert row["error"] is None
    assert len(store.list_contents()) == 1


def test_missing_publish_key_falls_back_to_channel_and_handle(store):
    first = store.upsert(make_record(publish_key=""))
    second = store.upsert(make_record(publish_key="", title="Changed"))

    assert first["id"] == second["id"]
    assert second["title"] == "Changed"


def test_created_at_is_preserved_on_update(store):
    first = store.upsert(make_record())
    second = store.upsert(make_record(status="published"))

    assert first["created_at"] == second["created_at"]


def test_lists_round_trip(store):
    row = store.upsert(
        make_record(related_products=["ZimaCube 2"], tags=["nas", "storage"])
    )

    assert row["related_products"] == ["ZimaCube 2"]
    assert row["tags"] == ["nas", "storage"]


# ---------------------------------------------------------------------------
# 时间轴
# ---------------------------------------------------------------------------


def test_timeline_excludes_rows_without_any_time(store):
    store.upsert(make_record(handle="a", publish_key="k1"))
    store.upsert(
        make_record(
            handle="b",
            publish_key="k2",
            status="draft",
            scheduled_at=None,
            published_at=None,
        )
    )

    bars = store.timeline()
    assert [bar["handle"] for bar in bars] == ["a"]


def test_timeline_sorted_ascending(store):
    store.upsert(
        make_record(handle="late", publish_key="k2", scheduled_at="2026-10-01T00:00:00+00:00")
    )
    store.upsert(
        make_record(handle="early", publish_key="k1", scheduled_at="2026-09-01T00:00:00+00:00")
    )

    assert [bar["handle"] for bar in store.timeline()] == ["early", "late"]


def test_timeline_window_filter(store):
    store.upsert(
        make_record(handle="sep", publish_key="k1", scheduled_at="2026-09-15T00:00:00+00:00")
    )
    store.upsert(
        make_record(handle="oct", publish_key="k2", scheduled_at="2026-10-15T00:00:00+00:00")
    )

    bars = store.timeline(start="2026-09-01", end="2026-10-01")
    assert [bar["handle"] for bar in bars] == ["sep"]


def test_timeline_falls_back_to_published_at(store):
    store.upsert(
        make_record(
            handle="published-only",
            publish_key="k1",
            status="published",
            scheduled_at=None,
            published_at="2026-09-10T00:00:00+00:00",
        )
    )

    assert len(store.timeline()) == 1


# ---------------------------------------------------------------------------
# 统计
# ---------------------------------------------------------------------------


def test_stats_counts_by_status(store):
    store.upsert(make_record(handle="a", publish_key="k1", status="scheduled"))
    store.upsert(make_record(handle="b", publish_key="k2", status="scheduled"))
    store.upsert(make_record(handle="c", publish_key="k3", status="published"))
    store.upsert(make_record(handle="d", publish_key="k4", status="failed"))
    store.upsert(make_record(handle="e", publish_key="k5", status="draft"))

    assert store.stats() == {
        "scheduledCount": 2,
        "publishedCount": 1,
        "failedCount": 1,
        "draftCount": 1,
    }


def test_stats_on_empty_db(store):
    assert store.stats() == {
        "scheduledCount": 0,
        "publishedCount": 0,
        "failedCount": 0,
        "draftCount": 0,
    }


# ---------------------------------------------------------------------------
# 历史
# ---------------------------------------------------------------------------


def test_history_excludes_drafts(store):
    store.upsert(make_record(handle="a", publish_key="k1", status="scheduled"))
    store.upsert(make_record(handle="b", publish_key="k2", status="draft"))

    assert [row["handle"] for row in store.history()] == ["a"]


def test_history_filters_by_channel(store):
    store.upsert(make_record(handle="a", publish_key="k1", channel_id="buying-guide"))
    store.upsert(make_record(handle="b", publish_key="k2", channel_id="support-tips"))

    assert [row["handle"] for row in store.history(channel_id="support-tips")] == ["b"]


# ---------------------------------------------------------------------------
# 改期 / 取消排期
# ---------------------------------------------------------------------------


def test_update_schedule_moves_time_and_clears_error(store):
    row = store.upsert(make_record(status="failed", error="失败了"))
    updated = store.update_schedule(row["id"], "2026-12-01T00:00:00+00:00")

    assert updated is not None
    assert updated["scheduled_at"] == "2026-12-01T00:00:00+00:00"
    assert updated["status"] == "scheduled"
    assert updated["error"] is None


def test_cancel_schedule_returns_to_draft(store):
    row = store.upsert(make_record())
    cancelled = store.cancel_schedule(row["id"])

    assert cancelled is not None
    assert cancelled["status"] == "draft"
    assert cancelled["scheduled_at"] is None
    # 记录本身保留，只是退回草稿
    assert store.get(row["id"]) is not None


def test_update_schedule_on_missing_row_returns_none(store):
    assert store.update_schedule(999, "2026-12-01T00:00:00+00:00") is None
    assert store.cancel_schedule(999) is None


def test_update_schedule_keeps_status_when_asked(store):
    """没有 Shopify 对象时不能把它标成「待发布」，否则状态是假的。"""
    row = store.upsert(make_record(status="failed", error="失败了"))
    updated = store.update_schedule(
        row["id"], "2026-12-01T00:00:00+00:00", mark_scheduled=False
    )

    assert updated is not None
    assert updated["scheduled_at"] == "2026-12-01T00:00:00+00:00"
    # 状态与错误都保持原样
    assert updated["status"] == "failed"
    assert updated["error"] == "失败了"
