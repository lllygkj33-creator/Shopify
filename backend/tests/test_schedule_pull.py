"""拉取 Shopify 上的未来排期。

为什么这个模块值得单独测：它决定仪表盘的「排期全景」是否完整。

排期不是平台独有的事 —— 内容可能是在 Shopify 后台、或别的工具排上去的。
实测店铺里有 **172 条页面** + 2 篇文章已经排好期（`isPublished: false` +
未来 `publishedAt`），而平台一条都不知道。不拉进来的话，用户明明排了
100 多条，界面写 0。

重点覆盖：
  - **只拉未来**：草稿（未发布且没有未来时间）不能进来 ——
    用户要求「只存平台自己发布的 和未来的，过去的通通不记录」
  - 归属判断：文章看 blog handle、页面看 templateSuffix；认不出的报数不静默丢
  - **不给同一对象造两行**：平台自己发过的行用 `channel|file|index|handle`
    作 key，拉回来的行用 `shopify|...`，都指向线上同一个对象
  - 幂等：重复拉不产生重复行
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.shopify.channel_map import (
    BLOG_HANDLE_TO_CHANNEL,
    TEMPLATE_TO_CHANNEL,
    channel_mismatch_error,
    resolve_article_channel,
    resolve_page_channel,
)
from app.shopify.client import ShopifyError
from app.shopify.schedule_pull import REMOTE_SOURCE_TAG, SchedulePuller
from app.storage import ContentStore

NOW = datetime.now(timezone.utc)
FUTURE = (NOW + timedelta(days=2)).replace(microsecond=0).isoformat().replace(
    "+00:00", "Z"
)
PAST = (NOW - timedelta(days=30)).replace(microsecond=0).isoformat().replace(
    "+00:00", "Z"
)


@pytest.fixture()
def store(tmp_path) -> ContentStore:
    return ContentStore(tmp_path / "pull.db")


class FakeClient:
    """模拟 `published_status:unpublished` 查询（只返回未发布内容）。"""

    def __init__(self, articles=None, pages=None, raise_error=None):
        self.articles = articles or []
        self.pages = pages or []
        self.raise_error = raise_error
        self.queries: list[str] = []

    async def execute(self, query, variables=None, **kwargs):
        if self.raise_error:
            raise self.raise_error

        assert "published_status:unpublished" in query, (
            f"拉取只应查未发布内容（否则会拉回 2748 条历史）：{query[:80]}"
        )
        self.queries.append(query)

        return {
            "articles": {
                "nodes": self.articles,
                "pageInfo": {"hasNextPage": False, "endCursor": None},
            },
            "pages": {
                "nodes": self.pages,
                "pageInfo": {"hasNextPage": False, "endCursor": None},
            },
        }


def article(
    gid: str,
    *,
    blog_handle: str = "tech-ai-hub",
    handle: str = "some-article",
    title: str = "Some Article",
    published_at: str | None = FUTURE,
    is_published: bool = False,
) -> dict:
    return {
        "id": f"gid://shopify/Article/{gid}",
        "title": title,
        "handle": handle,
        "isPublished": is_published,
        "publishedAt": published_at,
        "blog": {"handle": blog_handle, "title": "Tech & AI HUB"},
    }


def page(
    gid: str,
    *,
    template: str | None = "community_post",
    handle: str = "some-page",
    title: str = "Some Page",
    published_at: str | None = FUTURE,
    is_published: bool = False,
) -> dict:
    return {
        "id": f"gid://shopify/Page/{gid}",
        "title": title,
        "handle": handle,
        "isPublished": is_published,
        "publishedAt": published_at,
        "templateSuffix": template,
    }


# ---------------------------------------------------------------------------
# 只拉未来
# ---------------------------------------------------------------------------


async def test_only_future_scheduled_items_are_pulled(store):
    """草稿（没有未来时间）不能进来。"""
    client = FakeClient(
        pages=[
            page("1", handle="future-one"),
            page("2", handle="draft-no-date", published_at=None),
            page("3", handle="draft-past-date", published_at=PAST),
        ]
    )

    report = await SchedulePuller(client=client, store=store).pull()

    assert report.pages_scanned == 3
    assert report.scheduled_found == 1  # 只有未来那条算「排期」
    assert report.upserted == 1
    handles = [row["handle"] for row in store.list_contents()]
    assert handles == ["future-one"]


async def test_published_items_are_never_asked_for(store):
    """查询必须带 published_status 过滤 —— 否则会把 2748 条历史一起拉回来。"""
    client = FakeClient(pages=[page("1")])
    await SchedulePuller(client=client, store=store).pull()

    assert len(client.queries) == 1


async def test_pull_maps_pages_and_articles_to_channels(store):
    client = FakeClient(
        articles=[article("1", blog_handle="tech-ai-hub", handle="a1")],
        pages=[
            page("2", template="community_post", handle="p1"),
            page("3", template="discord-page", handle="p2"),
        ],
    )

    report = await SchedulePuller(client=client, store=store).pull()

    assert report.upserted == 3
    assert report.by_channel == {
        "tech-ai-hub": 1,
        "community-post": 1,
        "discord": 1,
    }

    rows = {row["channel_id"]: row for row in store.list_contents()}
    assert rows["community-post"]["status"] == "scheduled"
    assert rows["community-post"]["content_type"] == "page"
    assert rows["tech-ai-hub"]["content_type"] == "blog_article"
    assert rows["tech-ai-hub"]["published_url"] == "/blogs/tech-ai-hub/a1"
    # 拉回来的都是排期，published_at 必须留空，否则时间轴会显示成「已发布」
    assert rows["tech-ai-hub"]["published_at"] is None


async def test_items_outside_platform_channels_are_reported(store):
    """实测有 2 篇排期文章在 zima-campaign-hub 博客里，不属于平台栏目。"""
    client = FakeClient(
        articles=[
            article("1", blog_handle="zima-campaign-hub"),
            article("2", blog_handle="zima-campaign-hub"),
        ],
        pages=[page("3", template="app-hardware-requirements")],
    )

    report = await SchedulePuller(client=client, store=store).pull()

    assert report.upserted == 0
    assert report.scheduled_found == 3
    assert report.skipped["博客 zima-campaign-hub 不在平台栏目内"] == 2
    # 排除原因里的栏目名取自站点配置的 hidden 栏目（不再写死 "APP"）
    from app.site_config import site

    hidden_names = [
        str(channel["name"]) for channel in site.channels if channel.get("hidden")
    ]
    assert any(
        any(name in reason for name in hidden_names) for reason in report.skipped
    )
    assert store.list_contents() == []


# ---------------------------------------------------------------------------
# 不给同一对象造两行
# ---------------------------------------------------------------------------


async def test_pull_updates_platform_created_row_instead_of_duplicating(store):
    """平台自己排过期的对象，拉取要更新那一行，不能新增一行。"""
    store.upsert(
        {
            "channel_id": "discord",
            "content_type": "page",
            "title": "平台排的 Discord 页",
            "handle": "discord",
            "status": "scheduled",
            "scheduled_at": (NOW + timedelta(days=1)).isoformat(),
            "publish_key": "discord|d.json|0|discord",
            "source_file": "discord/d.json",
            "source_index": 0,
            "shopify_gid": "gid://shopify/Page/9",
            "shopify_kind": "Page",
        }
    )

    client = FakeClient(pages=[page("9", handle="discord", title="线上改过的标题")])
    report = await SchedulePuller(client=client, store=store).pull()

    assert report.upserted == 1
    rows = store.list_contents()
    assert len(rows) == 1, "同一个线上对象不能出现两行"
    assert rows[0]["title"] == "线上改过的标题"
    # 平台自己的来源信息要保留（哪个 JSON 的第几条）
    assert rows[0]["publish_key"] == "discord|d.json|0|discord"
    assert rows[0]["source_file"] == "discord/d.json"


async def test_pull_is_idempotent(store):
    client = FakeClient(pages=[page("1"), page("2")])
    puller = SchedulePuller(client=client, store=store)

    await puller.pull()
    await puller.pull()

    assert len(store.list_contents()) == 2


async def test_pull_uses_synthetic_publish_key_for_new_rows(store):
    client = FakeClient(pages=[page("77")])
    await SchedulePuller(client=client, store=store).pull()

    row = store.list_contents()[0]
    assert row["publish_key"] == f"{REMOTE_SOURCE_TAG}|Page|gid://shopify/Page/77"
    assert row["shopify_gid"] == "gid://shopify/Page/77"


async def test_pull_surfaces_api_error_without_writing(store):
    client = FakeClient(raise_error=ShopifyError("店铺鉴权失败"))
    report = await SchedulePuller(client=client, store=store).pull()

    assert report.error == "店铺鉴权失败"
    assert report.upserted == 0
    assert store.list_contents() == []


# ---------------------------------------------------------------------------
# 归属映射（与前端栏目配置交叉校验）
# ---------------------------------------------------------------------------


def test_channel_mismatch_error_names_both_channels():
    """JSON 自报的栏目与目标栏目不一致时要给出可执行的错误。

    只说「template 必须是 'community_post'」用户不知道该去哪儿改；
    要说清「这份属于哪个栏目」。
    """
    message = channel_mismatch_error("community-post", "discord")

    assert message is not None
    assert "discord" in message  # 这份 JSON 属于哪
    assert "community-post" in message  # 现在在哪个栏目


def test_channel_mismatch_error_is_none_when_consistent_or_unknown():
    # 一致 → 不报
    assert channel_mismatch_error("discord", "discord") is None
    # 认不出归属是「不认识」，不是「属于别处」，不能拦
    assert channel_mismatch_error("discord", None) is None
    assert channel_mismatch_error("discord", "") is None


def test_blog_handles_map_to_platform_channels():
    assert resolve_article_channel("tech-ai-hub").channel_id == "tech-ai-hub"
    assert (
        resolve_article_channel("product-comparisons").channel_id
        == "product-comparison"
    )
    assert not resolve_article_channel("zima-campaign-hub").resolved
    assert not resolve_article_channel(None).resolved


def test_page_templates_map_to_platform_channels():
    """用店铺里真实的 templateSuffix。

    community-post 栏目的模板后缀是下划线的 `community_post`（栏目 id 才是连字符），
    实测拉到了 156 条这个后缀的排期页面。
    """
    assert resolve_page_channel("community_post").channel_id == "community-post"
    assert resolve_page_channel("discord-page").channel_id == "discord"
    assert resolve_page_channel("nas-a-vs-b").channel_id == "vs"
    assert not resolve_page_channel(None).resolved
    assert "默认模板" in resolve_page_channel(None).reason


def test_template_mapping_is_derived_from_publish_specs():
    """不能手写第二份模板表 —— 必须从发布规格推导。"""
    from app.shopify.page_publisher import PAGE_CHANNEL_SPECS

    expected = {
        spec.template: channel_id
        for channel_id, spec in PAGE_CHANNEL_SPECS.items()
        if spec.template
    }
    assert TEMPLATE_TO_CHANNEL == expected


def test_blog_mapping_covers_the_five_platform_blogs():
    assert set(BLOG_HANDLE_TO_CHANNEL.values()) == {
        "tech-ai-hub",
        "support-tips",
        "nas-server-setup",
        "buying-guide",
        "product-comparison",
    }


def test_blog_mapping_is_derived_from_site_config():
    """博客映射必须**从站点配置推导**，不能手写第二份。

    原来这条用例读前端 `channels.ts` 做交叉校验。那份文件现在也不再写字面量了 ——
    两边都从 site.config.json 构建 —— 所以漂移在结构上已经不可能发生。
    这条用例钉住「确实是推导出来的」，免得某天又被手写回去。
    """
    from app.site_config import site

    expected = {
        str(channel["blogHandle"]): str(channel["id"])
        for channel in site.channels
        if channel.get("blogHandle")
    }

    assert expected == BLOG_HANDLE_TO_CHANNEL
