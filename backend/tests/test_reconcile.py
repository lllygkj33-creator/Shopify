"""对账：把 Shopify 上的真实状态对回本地记录。

为什么这个模块值得单独测：它决定本地显示的「待发布 / 已发布」是不是真的。

平台发定时内容用的是 Shopify 原生机制（`isPublished: false` + 未来
`publishDate`），到点由 Shopify 自己上线 —— 本地没有定时任务，所以
**线上发生的事本地不会自动知道**。不对账，用户在界面上看到的状态就是假的：

  - 内容早发了，界面还写「待发布」
  - 人在后台把还没到点的对象删了，界面以为它还会发
  - 人在后台改了时间/标题，界面显示旧的

只对账「平台自己发过的对象」（有 GID 的行）。店铺里平台上线之前的
历史内容不入库 —— 用户要求「只存平台自己发布的 和未来的，过去的通通不记录」。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.shopify.client import ShopifyError
from app.shopify.reconcile import (
    MAX_IDS_PER_QUERY,
    ShopifyReconciler,
    derive_status,
)
from app.storage import ContentStore

NOW = datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc)


@pytest.fixture()
def store(tmp_path) -> ContentStore:
    return ContentStore(tmp_path / "reconcile.db")


class FakeClient:
    """按 GID 返回节点，模拟 Shopify 的 `nodes(ids:)`。

    记录每次请求收到的 ids —— 用来钉住「按 GID 直查、不拉全量」这条设计，
    以及分批上限。
    """

    def __init__(self, nodes=None, raise_error=None):
        self.nodes = nodes or {}
        self.raise_error = raise_error
        self.requests: list[list[str]] = []

    async def execute(self, query, variables=None, **kwargs):
        if self.raise_error:
            raise self.raise_error

        assert "nodes(ids:" in query, f"只应对账查询用 nodes(ids:)：{query[:60]}"
        ids = list((variables or {}).get("ids") or [])
        self.requests.append(ids)

        return {"nodes": [self.nodes[gid] for gid in ids if gid in self.nodes]}


def node(
    gid: str,
    *,
    is_published: bool = True,
    published_at: str | None = "2026-09-10T15:59:00Z",
    handle: str = "some-page",
    title: str = "Some Page",
) -> dict:
    return {
        "id": gid,
        "handle": handle,
        "title": title,
        "isPublished": is_published,
        "publishedAt": published_at,
    }


def platform_row(**overrides) -> dict:
    """平台自己排期的一行（GID 是发布时写回的）。"""
    base = {
        "channel_id": "discord",
        "content_type": "page",
        "title": "Discord 社群页",
        "handle": "discord",
        "status": "scheduled",
        "scheduled_at": "2026-09-11T13:00:00+00:00",
        "publish_key": "discord|d.json|0|discord",
        "source_file": "discord/d.json",
        "shopify_gid": "gid://shopify/Page/9",
        "shopify_kind": "Page",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 状态推导
# ---------------------------------------------------------------------------


def test_published_stays_published():
    assert derive_status(True, NOW - timedelta(days=1), NOW) == "published"


def test_unpublished_with_future_date_is_scheduled():
    """这就是我们做定时发布的方式：不发布 + 未来时间。"""
    assert derive_status(False, NOW + timedelta(days=3), NOW) == "scheduled"


def test_unpublished_without_future_date_is_draft():
    assert derive_status(False, None, NOW) == "draft"
    assert derive_status(False, NOW - timedelta(days=1), NOW) == "draft"


# ---------------------------------------------------------------------------
# 不做无谓的请求
# ---------------------------------------------------------------------------


async def test_no_local_rows_skips_api(store):
    """本地还没有平台发过的东西时，不该打接口。"""
    client = FakeClient()
    report = await ShopifyReconciler(client=client, store=store).reconcile()

    assert report.checked == 0
    assert client.requests == []
    assert report.error is None


async def test_only_tracked_gids_are_queried(store):
    """只查本地跟踪的对象，不拉全量历史 —— 店铺有 2748 条也不影响。"""
    store.upsert(platform_row())
    client = FakeClient(nodes={"gid://shopify/Page/9": node("gid://shopify/Page/9")})

    await ShopifyReconciler(client=client, store=store).reconcile()

    assert client.requests == [["gid://shopify/Page/9"]]


async def test_gids_are_batched_at_the_api_limit(store):
    """超过 250 个要分批，否则 Shopify 会拒（nodes 单次上限 250）。"""
    total = MAX_IDS_PER_QUERY + 7
    for index in range(total):
        store.upsert(
            platform_row(
                publish_key=f"discord|d.json|{index}|discord-{index}",
                shopify_gid=f"gid://shopify/Page/{index}",
            )
        )

    nodes = {
        f"gid://shopify/Page/{index}": node(f"gid://shopify/Page/{index}")
        for index in range(total)
    }
    client = FakeClient(nodes=nodes)
    report = await ShopifyReconciler(client=client, store=store).reconcile()

    assert report.checked == total
    assert len(client.requests) == 2
    assert len(client.requests[0]) == MAX_IDS_PER_QUERY
    assert len(client.requests[1]) == 7


# ---------------------------------------------------------------------------
# 三种偏差
# ---------------------------------------------------------------------------


async def test_排期到点后本地跟上已发布(store):
    """最重要的一条：Shopify 到点自己上线了，本地必须从 scheduled 翻成 published。"""
    store.upsert(platform_row())
    assert store.list_contents()[0]["status"] == "scheduled"

    client = FakeClient(
        nodes={
            "gid://shopify/Page/9": node(
                "gid://shopify/Page/9",
                is_published=True,
                published_at="2026-09-11T13:00:05Z",
            )
        }
    )
    report = await ShopifyReconciler(client=client, store=store).reconcile()

    assert report.checked == 1
    assert report.matched == 1
    assert report.updated == 1

    row = store.list_contents()[0]
    assert row["status"] == "published"
    # 已发布就不该再留着排期时间，否则时间轴会同时显示两条
    assert row["scheduled_at"] is None
    assert row["published_at"] is not None


async def test_后台删除的对象本地留痕不静默消失(store):
    store.upsert(platform_row())
    client = FakeClient(nodes={})  # 全部返回 null

    report = await ShopifyReconciler(client=client, store=store).reconcile()

    assert report.gone == 1
    assert report.matched == 0
    assert report.updated == 0

    row = store.list_contents()[0]
    assert "对账时在 Shopify 上未找到" in row["error"]
    # 不删行：用户需要看到「这条被删了」，而不是它莫名消失
    assert row["status"] == "scheduled"


async def test_后台改标题和handle会同步回来(store):
    store.upsert(platform_row())
    client = FakeClient(
        nodes={
            "gid://shopify/Page/9": node(
                "gid://shopify/Page/9", handle="discord-updated", title="新标题"
            )
        }
    )

    report = await ShopifyReconciler(client=client, store=store).reconcile()

    assert report.updated == 1
    row = store.list_contents()[0]
    assert row["title"] == "新标题"
    assert row["handle"] == "discord-updated"


# ---------------------------------------------------------------------------
# 幂等与容错
# ---------------------------------------------------------------------------


async def test_一致时不写库(store):
    """状态本来就对的行不能被算成「更新过」—— 否则用户以为一直有漂移。"""
    store.upsert(
        platform_row(
            status="published",
            scheduled_at=None,
            published_at="2026-09-10T15:59:00Z",
            title="Some Page",
            handle="some-page",
        )
    )
    client = FakeClient(
        nodes={
            "gid://shopify/Page/9": node(
                "gid://shopify/Page/9",
                handle="some-page",
                title="Some Page",
                published_at="2026-09-10T15:59:00Z",
            )
        }
    )

    report = await ShopifyReconciler(client=client, store=store).reconcile()

    assert report.matched == 1
    assert report.updated == 0
    assert report.gone == 0


async def test_重复对账第二次不再有更新(store):
    store.upsert(platform_row())
    nodes = {
        "gid://shopify/Page/9": node(
            "gid://shopify/Page/9", is_published=True, published_at="2026-09-11T13:00:05Z"
        )
    }

    first = await ShopifyReconciler(
        client=FakeClient(nodes=nodes), store=store
    ).reconcile()
    second = await ShopifyReconciler(
        client=FakeClient(nodes=nodes), store=store
    ).reconcile()

    assert first.updated == 1
    assert second.updated == 0


async def test_接口报错时如实上报且不动本地数据(store):
    store.upsert(platform_row())
    client = FakeClient(raise_error=ShopifyError("限流"))

    report = await ShopifyReconciler(client=client, store=store).reconcile()

    assert report.error == "限流"
    assert report.checked == 1
    assert report.updated == 0
    assert store.list_contents()[0]["status"] == "scheduled"


async def test_null节点算已删除而不是崩掉(store):
    """Shopify 对不存在的 id 在数组里返回 null —— 这就是「线上没有」。"""
    store.upsert(platform_row())
    client = FakeClient()
    client.nodes = {"gid://shopify/Page/9": None}

    report = await ShopifyReconciler(client=client, store=store).reconcile()

    assert report.gone == 1
    assert report.matched == 0
    assert report.updated == 0


def test_时间格式不同不算改动():
    """`...Z` 和 `+00:00` 是同一时刻，不能因此报「有更新」。"""
    from app.shopify.reconcile import normalize_iso

    assert normalize_iso("2026-09-10T15:59:00Z") == normalize_iso(
        "2026-09-10T15:59:00+00:00"
    )
    assert normalize_iso(None) is None
    assert normalize_iso("") is None


def test_report_dict_shape():
    from app.shopify.reconcile import ReconcileReport

    assert ReconcileReport(checked=3, matched=2, updated=1, gone=1).to_dict() == {
        "checked": 3,
        "matched": 2,
        "updated": 1,
        "gone": 1,
        "error": None,
    }
