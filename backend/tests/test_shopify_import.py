"""从 Shopify 导入既有内容 + 对账。

为什么这个模块值得单独测：它决定**本地库和线上店铺是否一致**。
错了会有两种后果 —— 要么把内容归错栏目，要么把用户在后台的改动
（改时间、删页面、到点自动上线）当成不存在，本地显示的状态就是假的。

所以重点覆盖：
  - 归属判断（认识的进、不认识的分组报数、不静默丢）
  - 幂等（重复导入不产生重复行）
  - 不覆盖平台自己发布的记录
  - 对账的三种结果：状态翻新 / 对象消失 / 接口报错
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.shopify.client import ShopifyError
from app.shopify_import import (
    IMPORT_SOURCE_TAG,
    ShopifyImporter,
    derive_status,
)
from app.storage import ContentStore

NOW = datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc)


@pytest.fixture()
def store(tmp_path) -> ContentStore:
    return ContentStore(tmp_path / "import.db")


class FakeClient:
    """按查询名分发文章/页面，并允许模拟报错。"""

    def __init__(self, articles=None, pages=None, raise_error=None):
        self.articles = articles or []
        self.pages = pages or []
        self.raise_error = raise_error
        self.calls: list[str] = []

    async def execute(self, query, variables=None, **kwargs):
        if self.raise_error:
            raise self.raise_error

        variables = variables or {}
        if "articles(" in query:
            self.calls.append("articles")
            # 只支持单页：够用，且能测出翻页逻辑没被误触发
            assert variables.get("after") is None
            return {
                "articles": {
                    "nodes": self.articles,
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                }
            }
        if "pages(" in query:
            self.calls.append("pages")
            return {
                "pages": {
                    "nodes": self.pages,
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                }
            }
        raise AssertionError(f"未预期的查询：{query[:60]}")


def article(
    gid: str,
    *,
    blog_handle: str = "tech-ai-hub",
    handle: str = "some-article",
    title: str = "Some Article",
    is_published: bool = True,
    published_at: str | None = "2026-08-01T10:00:00Z",
) -> dict:
    return {
        "id": f"gid://shopify/Article/{gid}",
        "title": title,
        "handle": handle,
        "isPublished": is_published,
        "publishedAt": published_at,
        "createdAt": "2026-07-01T10:00:00Z",
        "blog": {"handle": blog_handle, "title": "Tech & AI HUB"},
    }


def page(
    gid: str,
    *,
    template: str | None = "community_post",
    handle: str = "some-page",
    title: str = "Some Page",
    is_published: bool = True,
    published_at: str | None = "2026-08-02T10:00:00Z",
) -> dict:
    return {
        "id": f"gid://shopify/Page/{gid}",
        "title": title,
        "handle": handle,
        "isPublished": is_published,
        "publishedAt": published_at,
        "createdAt": "2026-07-01T10:00:00Z",
        "templateSuffix": template,
    }


# ---------------------------------------------------------------------------
# 状态推导
# ---------------------------------------------------------------------------


def test_published_stays_published():
    assert derive_status(True, NOW - timedelta(days=1), NOW) == "published"


def test_unpublished_with_future_date_is_scheduled():
    """这就是我们做定时发布的方式：不发布 + 未来时间，到点 Shopify 自己上线。"""
    assert derive_status(False, NOW + timedelta(days=3), NOW) == "scheduled"


def test_unpublished_without_future_date_is_draft():
    assert derive_status(False, None, NOW) == "draft"
    assert derive_status(False, NOW - timedelta(days=1), NOW) == "draft"


# ---------------------------------------------------------------------------
# 导入
# ---------------------------------------------------------------------------


async def test_import_maps_articles_and_pages_to_channels(store):
    client = FakeClient(
        articles=[article("1", blog_handle="tech-ai-hub", handle="a1")],
        pages=[page("2", template="discord-page", handle="p1")],
    )
    importer = ShopifyImporter(client=client, store=store)

    report = await importer.import_all()

    assert report.articles_scanned == 1
    assert report.pages_scanned == 1
    assert report.imported == 2
    assert report.by_channel == {"tech-ai-hub": 1, "discord": 1}
    assert report.by_status == {"published": 2}

    rows = {row["channel_id"]: row for row in store.list_contents()}
    assert rows["tech-ai-hub"]["content_type"] == "blog_article"
    assert rows["tech-ai-hub"]["published_url"] == "/blogs/tech-ai-hub/a1"
    assert rows["discord"]["content_type"] == "page"
    assert rows["discord"]["template"] == "discord-page"


async def test_import_reports_what_it_skipped(store):
    """不认识的内容不能静默丢弃 —— 要按原因报数。"""
    client = FakeClient(
        articles=[
            article("1"),
            article("2", blog_handle="zima-campaign-hub"),
            article("3", blog_handle="zima-campaign-hub"),
            article("4", blog_handle="news"),
        ],
        pages=[
            page("5", template="app-hardware-requirements"),
            page("6", template=None),
        ],
    )
    importer = ShopifyImporter(client=client, store=store)

    report = await importer.import_all()

    assert report.imported == 1
    skipped = report.skipped
    assert skipped["博客 zima-campaign-hub 不在平台栏目内"] == 2
    assert skipped["博客 news 不在平台栏目内"] == 1
    assert any("APP" in reason for reason in skipped)
    assert any("默认模板" in reason for reason in skipped)


async def test_import_uses_synthetic_publish_key(store):
    client = FakeClient(articles=[article("123")])
    importer = ShopifyImporter(client=client, store=store)

    await importer.import_all()

    row = store.list_contents()[0]
    assert row["shopify_gid"] == "gid://shopify/Article/123"
    assert row["shopify_kind"] == "Article"
    assert row["publish_key"] == f"{IMPORT_SOURCE_TAG}|Article|gid://shopify/Article/123"


async def test_import_is_idempotent(store):
    client = FakeClient(articles=[article("1"), article("2")])
    importer = ShopifyImporter(client=client, store=store)

    await importer.import_all()
    await importer.import_all()

    assert len(store.list_contents()) == 2


async def test_import_updates_a_changed_remote_title(store):
    importer = ShopifyImporter(
        client=FakeClient(articles=[article("1", title="旧标题")]), store=store
    )
    await importer.import_all()

    importer._client = FakeClient(articles=[article("1", title="新标题")])
    await importer.import_all()

    rows = store.list_contents()
    assert len(rows) == 1
    assert rows[0]["title"] == "新标题"


async def test_import_does_not_touch_platform_published_rows(store):
    """平台自己发布的行用另一种 publish_key，导入不能把它覆盖掉。"""
    store.upsert(
        {
            "channel_id": "tech-ai-hub",
            "content_type": "blog_article",
            "title": "平台排期的文章",
            "handle": "a1",
            "status": "scheduled",
            "scheduled_at": "2026-12-01T10:00:00+00:00",
            "publish_key": "tech-ai-hub|batch.json|0|a1",
            "source_file": "tech-ai-hub/batch.json",
        }
    )

    importer = ShopifyImporter(
        client=FakeClient(articles=[article("1", handle="a1")]), store=store
    )
    await importer.import_all()

    rows = store.list_contents()
    assert len(rows) == 2
    scheduled = [row for row in rows if row["status"] == "scheduled"]
    assert len(scheduled) == 1
    assert scheduled[0]["title"] == "平台排期的文章"


async def test_import_surfaces_api_error(store):
    client = FakeClient(raise_error=ShopifyError("店铺鉴权失败"))
    importer = ShopifyImporter(client=client, store=store)

    report = await importer.import_all()

    assert report.error == "店铺鉴权失败"
    assert report.imported == 0
    assert store.list_contents() == []


# ---------------------------------------------------------------------------
# 对账
# ---------------------------------------------------------------------------


async def test_reconcile_without_local_rows_skips_api(store):
    client = FakeClient(articles=[article("1")])
    importer = ShopifyImporter(client=client, store=store)

    report = await importer.reconcile()

    assert report.checked == 0
    assert client.calls == []
    assert report.error is None


async def test_reconcile_flips_scheduled_to_published(store):
    """到点后 Shopify 自己上线 —— 本地必须跟上，否则仪表盘一直显示"待发布"。"""
    scheduled_at = "2026-09-11T13:00:00Z"
    importer = ShopifyImporter(
        client=FakeClient(articles=[article("1", is_published=False, published_at=scheduled_at)]),
        store=store,
    )
    await importer.import_all()
    assert store.list_contents()[0]["status"] == "scheduled"

    # 过了那个时间点，线上已发布
    importer._client = FakeClient(
        articles=[article("1", is_published=True, published_at=scheduled_at)]
    )
    report = await importer.reconcile()

    assert report.checked == 1
    assert report.matched == 1
    assert report.updated == 1
    row = store.list_contents()[0]
    assert row["status"] == "published"
    assert row["scheduled_at"] is None


async def test_reconcile_reports_gone_objects(store):
    importer = ShopifyImporter(client=FakeClient(articles=[article("1")]), store=store)
    await importer.import_all()

    # 人在后台把文章删了
    importer._client = FakeClient(articles=[])
    report = await importer.reconcile()

    assert report.gone == 1
    assert report.matched == 0
    row = store.list_contents()[0]
    assert "对账时在 Shopify 上未找到" in row["error"]
    # 消失的对象状态不动，靠 error 留痕（不假装它还在线上）
    assert row["published_at"] is not None


async def test_reconcile_no_change_reports_zero_updates(store):
    importer = ShopifyImporter(client=FakeClient(articles=[article("1")]), store=store)
    await importer.import_all()

    report = await importer.reconcile()

    assert report.matched == 1
    assert report.updated == 0
    assert report.gone == 0


async def test_reconcile_surfaces_api_error(store):
    importer = ShopifyImporter(client=FakeClient(articles=[article("1")]), store=store)
    await importer.import_all()

    importer._client = FakeClient(raise_error=ShopifyError("限流"))
    report = await importer.reconcile()

    assert report.error == "限流"
    assert report.checked == 1
    assert report.updated == 0


async def test_reconcile_reads_back_platform_published_rows_too(store):
    """带 GID 的行都参与对账，不只导入的行（平台发布的也会写回 GID）。"""
    store.upsert(
        {
            "channel_id": "discord",
            "content_type": "page",
            "title": "平台建的 Discord 页",
            "handle": "discord",
            "status": "scheduled",
            "scheduled_at": "2026-09-11T13:00:00+00:00",
            "publish_key": "discord|d.json|0|discord",
            "source_file": "discord/d.json",
            "shopify_gid": "gid://shopify/Page/9",
            "shopify_kind": "Page",
        }
    )

    importer = ShopifyImporter(
        client=FakeClient(
            pages=[page("9", handle="discord", is_published=True, published_at="2026-09-11T13:00:00Z")]
        ),
        store=store,
    )
    report = await importer.reconcile()

    assert report.checked == 1
    assert report.updated == 1
    assert store.list_contents()[0]["status"] == "published"


def test_report_dicts_are_sorted_by_count_desc():
    """报数要按数量倒序 —— 一眼看到大头（例如 288 篇 campaign-hub）。"""
    from app.shopify_import import ImportReport

    report = ImportReport(skipped={"少": 1, "多": 288})
    assert list(report.to_dict()["skipped"]) == ["多", "少"]
