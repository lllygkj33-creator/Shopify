"""页面发布器测试。

对照 `publish_community_pages.py` 的行为逐条写：handle 归一化、硬校验、
创建/更新分流、`metafieldsSet` 补写、写回校验。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from app.shopify.page_publisher import (
    PAGE_CHANNEL_SPECS,
    PagePayload,
    PagePublishError,
    PagePublisher,
    build_page_payload,
    full_page_url,
    get_page_spec,
    load_source,
    normalize_page_handle,
    page_metafields,
    parse_bool,
    validate_page_payload,
)

SPEC = get_page_spec("community-post")
assert SPEC is not None

GOOD_HTML = (
    "<div><h2>Overview</h2>"
    '<img src="a.png" alt="A photo" title="A photo">'
    # 第三方外链必须带 _blank + noopener + noreferrer + nofollow（平台外链规则）
    '<a href="https://example.com" title="Example" target="_blank" '
    'rel="nofollow noopener noreferrer">link</a>'
    "</div>"
)

SOURCE = {
    "title": "Prowlarr + Radarr on CasaOS",
    "url": "https://community.zimaspace.com/t/prowlarr-radarr-casaos/1234",
    "excerpt": "A short excerpt",
    "author_name": "someuser",
    "author_avatar_url": "https://community.zimaspace.com/user_avatar/x/45.png",
    "author_profile_url": "https://community.zimaspace.com/u/someuser",
}


def raw_page(**overrides):
    base = {
        "title": "Prowlarr + Radarr on CasaOS",
        "meta_title": "Prowlarr + Radarr on CasaOS",
        "meta_description": "How to run Prowlarr and Radarr on CasaOS.",
        "url": "/pages/001-prowlarr-radarr-casaos",
        "template": "community_post",
        "html": GOOD_HTML,
        "community_source": dict(SOURCE),
    }
    base.update(overrides)
    return base


def build(raw=None, **kwargs):
    return build_page_payload(
        raw if raw is not None else raw_page(), channel_id="community-post", spec=SPEC, **kwargs
    )


# ---------------------------------------------------------------------------
# handle 归一化：API 只接受裸 handle
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value,expected",
    [
        ("qwen3-8b-hardware-requirements", "qwen3-8b-hardware-requirements"),
        ("/pages/qwen3-8b-hardware-requirements", "qwen3-8b-hardware-requirements"),
        ("pages/qwen3-8b-hardware-requirements", "qwen3-8b-hardware-requirements"),
        ("/qwen3-8b-hardware-requirements/", "qwen3-8b-hardware-requirements"),
        (
            "https://shop.zimaspace.com/pages/qwen3-8b-hardware-requirements",
            "qwen3-8b-hardware-requirements",
        ),
        (
            "https://shop.zimaspace.com/pages/x-y?utm=1#frag",
            "x-y",
        ),
    ],
)
def test_normalize_page_handle_strips_pages_prefix(value, expected):
    """页面 API 用的是**裸 handle**，前端展示用的 /pages/xxx 必须剥掉。"""
    assert normalize_page_handle(value) == expected


@pytest.mark.parametrize("value", ["", "Bad-Handle", "has_underscore", "has space", "中文"])
def test_normalize_page_handle_rejects_invalid(value):
    with pytest.raises(PagePublishError):
        normalize_page_handle(value)


def test_full_page_url_uses_storefront_domain():
    assert full_page_url("x-y") == "https://shop.zimaspace.com/pages/x-y"


# ---------------------------------------------------------------------------
# 来源对象
# ---------------------------------------------------------------------------


def test_load_source_returns_normalized_fields():
    result = load_source({"community_source": SOURCE}, SPEC)
    assert result["author_name"] == "someuser"
    assert len(result) == 6


def test_load_source_accepts_json_string():
    result = load_source({"community_source": json.dumps(SOURCE)}, SPEC)
    assert result["title"] == SOURCE["title"]


def test_load_source_requires_every_field():
    incomplete = dict(SOURCE)
    incomplete.pop("excerpt")
    with pytest.raises(PagePublishError, match="缺少必需字段：excerpt"):
        load_source({"community_source": incomplete}, SPEC)


def test_load_source_rejects_empty_required_value():
    broken = dict(SOURCE, author_name="")
    with pytest.raises(PagePublishError, match="author_name 不能为空"):
        load_source({"community_source": broken}, SPEC)


def test_load_source_enforces_community_topic_url():
    broken = dict(SOURCE, url="https://example.com/t/x")
    with pytest.raises(PagePublishError, match="必须以 https://community.zimaspace.com/t/ 开头"):
        load_source({"community_source": broken}, SPEC)


def test_load_source_enforces_author_profile_url():
    broken = dict(SOURCE, author_profile_url="https://example.com/u/x")
    with pytest.raises(PagePublishError, match="必须以 https://community.zimaspace.com/u/ 开头"):
        load_source({"community_source": broken}, SPEC)


def test_source_is_empty_when_channel_has_no_source_metafield():
    """VS 没有来源 metafield，load_source 必须返回空字典而不是报错。"""
    vs = get_page_spec("vs")
    assert vs is not None and vs.source_key == ""

    assert load_source({"anything": "goes"}, vs) == {}


def test_build_accepts_documented_aliases():
    raw = {
        "page_title": "T",
        "meta title": "MT",
        "td": "MD",  # 脚本里 meta description 的首选键名
        "handle": "my-page",
        "html代码": GOOD_HTML,
        "community_source": SOURCE,
    }
    payload = build(raw)

    assert payload.title == "T"
    assert payload.meta_title == "MT"
    assert payload.meta_description == "MD"
    assert payload.handle == "my-page"
    # template 缺失时回落到栏目规格
    assert payload.template_suffix == "community_post"


def test_build_reads_html_from_external_file(tmp_path):
    html_file = tmp_path / "body.html"
    html_file.write_text(GOOD_HTML, encoding="utf-8")

    raw = raw_page()
    raw.pop("html")
    raw["html_file"] = "body.html"

    payload = build(raw, source_file=str(tmp_path / "page.json"))
    assert "<h2>" in payload.body_html


def test_build_reports_missing_html_file(tmp_path):
    raw = raw_page()
    raw.pop("html")
    raw["html_file"] = "missing.html"

    with pytest.raises(PagePublishError, match="找不到 HTML 文件"):
        build(raw, source_file=str(tmp_path / "page.json"))


def test_parse_bool_accepts_published_variants():
    assert parse_bool("published") is True
    assert parse_bool("draft") is False
    assert parse_bool(None, default=True) is True
    assert parse_bool("nonsense", default=False) is False


# ---------------------------------------------------------------------------
# metafields
# ---------------------------------------------------------------------------


def test_page_metafields_contains_seo_and_source_json():
    metafields = page_metafields(build(), SPEC)
    by_key = {item["key"]: item for item in metafields}

    assert set(by_key) == {"title_tag", "description_tag", "community_source"}
    assert by_key["community_source"]["namespace"] == "custom"
    assert by_key["community_source"]["type"] == "json"

    # 来源必须是可解析的 JSON，且保留非 ASCII
    payload = json.loads(by_key["community_source"]["value"])
    assert payload["author_name"] == "someuser"


def test_page_metafields_never_touches_related_products():
    """脚本刻意不写 related_products，否则会清掉已有商品列表 metafield。"""
    keys = {item["key"] for item in page_metafields(build(), SPEC)}
    assert "related_products" not in keys


# ---------------------------------------------------------------------------
# 发布流程（假客户端，不触网）
# ---------------------------------------------------------------------------


# 模拟 Shopify 的行为：立即发布时由服务端生成 publishedAt；
# 排期时回显请求的 publishDate；草稿则没有 publishedAt。
SHOPIFY_GENERATED_PUBLISHED_AT = "2026-08-01T12:00:00+00:00"


class FakePageClient:
    def __init__(self, *, existing=None, verify_override=None):
        self.existing = existing
        self.verify_override = verify_override or {}
        self.calls: list[str] = []
        self.last_create_input: dict | None = None
        self.last_update_input: dict | None = None
        self.last_metafields: list | None = None

    @staticmethod
    def _respond(page_input: dict, page_id: str) -> dict:
        publish_date = page_input.get("publishDate")
        is_published = page_input.get("isPublished")

        if publish_date is not None:
            pub, visible = publish_date, False
        elif is_published is True:
            pub, visible = SHOPIFY_GENERATED_PUBLISHED_AT, True
        else:
            pub, visible = None, False

        return {
            "id": page_id,
            "title": page_input["title"],
            "handle": page_input["handle"],
            "isPublished": visible,
            "publishedAt": pub,
            "templateSuffix": page_input["templateSuffix"],
        }

    async def execute(self, query, variables=None, **kwargs):
        if "FindPage" in query:
            self.calls.append("find")
            nodes = [self.existing] if self.existing else []
            return {"pages": {"nodes": nodes}}

        if "pageCreate" in query:
            self.calls.append("create")
            self.last_create_input = variables["page"]
            page = self._respond(variables["page"], "gid://shopify/Page/1")
            page.update(self.verify_override)
            return {"pageCreate": {"page": page, "userErrors": []}}

        if "pageUpdate" in query:
            self.calls.append("update")
            self.last_update_input = variables["page"]
            page = self._respond(variables["page"], variables["id"])
            page.update(self.verify_override)
            return {"pageUpdate": {"page": page, "userErrors": []}}

        if "metafieldsSet" in query:
            self.calls.append("metafieldsSet")
            self.last_metafields = variables["metafields"]
            return {"metafieldsSet": {"metafields": [], "userErrors": []}}

        raise AssertionError(f"未预期的查询：{query[:60]}")


SCHEDULED_AT = datetime(2026, 8, 31, 23, 59, tzinfo=timezone.utc)


async def test_creates_page_when_handle_missing():
    client = FakePageClient(existing=None)
    publisher = PagePublisher(client)

    page, action = await publisher.publish(
        build(), SPEC, mode="schedule", publish_at=SCHEDULED_AT
    )

    assert action == "created"
    assert client.calls == ["find", "create"]
    # 创建时可以带 metafields
    assert "metafields" in client.last_create_input
    assert client.last_create_input["templateSuffix"] == "community_post"
    assert client.last_create_input["handle"] == "001-prowlarr-radarr-casaos"


async def test_updates_existing_page_and_refreshes_metafields():
    """pageUpdate 不可靠地替换 metafield，所以必须再补一次 metafieldsSet。"""
    existing = {
        "id": "gid://shopify/Page/77",
        "title": "old",
        "handle": "001-prowlarr-radarr-casaos",
        "isPublished": True,
        "templateSuffix": "community_post",
    }
    client = FakePageClient(existing=existing)
    publisher = PagePublisher(client)

    page, action = await publisher.publish(
        build(), SPEC, mode="schedule", publish_at=SCHEDULED_AT
    )

    assert action == "updated"
    assert client.calls == ["find", "update", "metafieldsSet"]
    # 更新 input 里**不能**带 metafields
    assert "metafields" not in client.last_update_input
    assert client.last_metafields is not None
    assert {item["key"] for item in client.last_metafields} == {
        "title_tag",
        "description_tag",
        "community_source",
    }
    assert all(item["ownerId"] == "gid://shopify/Page/77" for item in client.last_metafields)


async def test_scheduled_input_carries_seconds_precision_publish_date():
    client = FakePageClient()
    publisher = PagePublisher(client)

    await publisher.publish(build(), SPEC, mode="schedule", publish_at=SCHEDULED_AT)

    assert client.last_create_input["publishDate"] == "2026-08-31T23:59:00+00:00"


async def test_draft_omits_publish_date_and_forces_unpublished():
    """草稿必须**显式**传 isPublished=false。

    schema 描述：isPublished "Defaults to true if no publish date is specified"——
    省略它会让页面立刻公开。
    """
    client = FakePageClient()
    publisher = PagePublisher(client)

    _, action = await publisher.publish(build(), SPEC, mode="draft")

    assert action == "created"
    assert "publishDate" not in client.last_create_input
    assert client.last_create_input["isPublished"] is False


async def test_immediate_publish_sets_is_published_and_no_date():
    client = FakePageClient()
    publisher = PagePublisher(client)

    _, action = await publisher.publish(build(), SPEC, mode="now")

    assert action == "created"
    assert client.last_create_input["isPublished"] is True
    assert "publishDate" not in client.last_create_input


async def test_scheduled_omits_is_published_so_date_governs():
    """排期保持脚本原行为：只给 publishDate，不传 isPublished。"""
    client = FakePageClient()
    publisher = PagePublisher(client)

    await publisher.publish(build(), SPEC, mode="schedule", publish_at=SCHEDULED_AT)

    assert client.last_create_input["publishDate"] == "2026-08-31T23:59:00+00:00"
    assert "isPublished" not in client.last_create_input


async def test_immediate_publish_verification_requires_visible_page():
    client = FakePageClient(verify_override={"isPublished": False, "publishedAt": None})
    publisher = PagePublisher(client)

    with pytest.raises(PagePublishError, match="仍处于未发布状态"):
        await publisher.publish(build(), SPEC, mode="now")


async def test_immediate_publish_accepts_shopify_generated_published_at():
    """立即发布时 publishedAt 由 Shopify 生成，不可能与请求时间相等。"""
    client = FakePageClient(verify_override={"isPublished": True})
    publisher = PagePublisher(client)

    page, action = await publisher.publish(build(), SPEC, mode="now")

    assert action == "created"
    assert page["isPublished"] is True


async def test_verify_rejects_mismatched_publish_time():
    client = FakePageClient(
        verify_override={"publishedAt": "2026-09-01T23:59:00+00:00"}
    )
    publisher = PagePublisher(client)

    with pytest.raises(PagePublishError, match="排期时间不一致"):
        await publisher.publish(build(), SPEC, mode="schedule", publish_at=SCHEDULED_AT)


async def test_verify_rejects_page_that_is_already_visible():
    """脚本会明确检查：页面必须仍处于排期状态，不能已经可见。"""
    client = FakePageClient(verify_override={"isPublished": True})
    publisher = PagePublisher(client)

    with pytest.raises(PagePublishError, match="已经可见"):
        await publisher.publish(build(), SPEC, mode="schedule", publish_at=SCHEDULED_AT)


async def test_verify_rejects_missing_published_at():
    client = FakePageClient(verify_override={"publishedAt": None})
    publisher = PagePublisher(client)

    with pytest.raises(PagePublishError, match="没有返回 publishedAt"):
        await publisher.publish(build(), SPEC, mode="schedule", publish_at=SCHEDULED_AT)


async def test_verify_rejects_wrong_template_roundtrip():
    client = FakePageClient(verify_override={"templateSuffix": "other"})
    publisher = PagePublisher(client)

    with pytest.raises(PagePublishError, match="templateSuffix 不一致"):
        await publisher.publish(build(), SPEC, mode="schedule", publish_at=SCHEDULED_AT)


async def test_user_errors_are_surfaced():
    class ErrorClient(FakePageClient):
        async def execute(self, query, variables=None, **kwargs):
            if "pageCreate" in query:
                return {
                    "pageCreate": {
                        "page": None,
                        "userErrors": [{"field": ["handle"], "message": "已被占用"}],
                    }
                }
            return await super().execute(query, variables, **kwargs)

    publisher = PagePublisher(ErrorClient())

    with pytest.raises(PagePublishError, match="已被占用"):
        await publisher.publish(build(), SPEC, mode="schedule", publish_at=SCHEDULED_AT)


# ---------------------------------------------------------------------------
# 栏目规格
# ---------------------------------------------------------------------------


def test_community_spec_is_marked_verified():
    assert SPEC.verified is True
    assert SPEC.template == "community_post"
    assert SPEC.source_key == "community_source"


def test_all_page_channels_have_verified_specs():
    """
    六个页面栏目的规格都已对照各自的发布脚本核对过。
    新增栏目时这个断言会提醒你：要么补齐规格，要么显式标记 verified=False。
    """
    for channel_id in ("community-post", "discord", "makerworld", "user-story", "vs"):
        spec = PAGE_CHANNEL_SPECS[channel_id]
        assert spec.verified is True, f"{channel_id} 的规格未核对"

    # VS 是唯一没有来源 metafield 的栏目
    assert PAGE_CHANNEL_SPECS["vs"].source_key == ""
    assert PAGE_CHANNEL_SPECS["vs"].template == "nas-a-vs-b"


# ---------------------------------------------------------------------------
# Discord 栏目：规则与社区**不同**（已对照 publish_discord_pages.py）
# ---------------------------------------------------------------------------

DISCORD_SPEC = get_page_spec("discord")
assert DISCORD_SPEC is not None

DISCORD_HTML_4H2 = (
    "<div><h2>A</h2><h3>a</h3><h2>B</h2><h3>b</h3>"
    "<h2>C</h2><h3>c</h3><h2>D</h2><h3>d</h3></div>"
)
DISCORD_META_DESCRIPTION = (
    "ZimaCube 1 runs its drives hot when airflow is restricted. This thread covers "
    "bay spacing, fan curves, and front-panel obstructions that keep temperatures safe."
)
DISCORD_SOURCE = {
    "title": "ZimaCube 1 HDD Temperature and Cooling",
    "url": "https://discord.com/channels/123456789/987654321/555555555",
    "excerpt": "A thread about drive temperatures and airflow.",
    "starter_name": "Eric Brown",
    "starter_avatar_url": "https://cdn.discordapp.com/avatars/1/abc.png",
    "channel_name": "#zimacube-general",
    "invite_url": "",
}


def raw_discord(**overrides):
    base = {
        "title": "ZimaCube 1 HDD Running Hot",
        "meta_title": "ZimaCube 1 HDD Temperature: Improve Cooling",
        "td": DISCORD_META_DESCRIPTION,
        "url": "/pages/zimacube-1-hdd-temperature-cooling-airflow",
        "template": "discord-page",
        "html": DISCORD_HTML_4H2,
        "discord_source": dict(DISCORD_SOURCE),
    }
    base.update(overrides)
    return base


def build_discord(raw=None, **kwargs):
    return build_page_payload(
        raw if raw is not None else raw_discord(),
        channel_id="discord",
        spec=DISCORD_SPEC,
        **kwargs,
    )


def test_discord_spec_is_verified_and_stricter_than_community():
    assert DISCORD_SPEC.verified is True
    assert DISCORD_SPEC.template == "discord-page"
    assert DISCORD_SPEC.source_key == "discord_source"

    # 与社区的关键差异
    assert DISCORD_SPEC.h2_min == 4
    assert SPEC.h2_min == 1
    assert DISCORD_SPEC.meta_title_max == 65
    assert (DISCORD_SPEC.meta_description_min, DISCORD_SPEC.meta_description_max) == (120, 170)
    assert SPEC.meta_title_max == 0
    assert SPEC.meta_description_min == 0


def test_discord_source_strips_hash_from_channel_name():
    payload = build_discord()
    assert payload.source["channel_name"] == "zimacube-general"


def test_discord_source_keeps_extra_keys():
    """Discord 脚本保留来源对象里的额外键（社区脚本只保留必需字段）。"""
    source = dict(DISCORD_SOURCE)
    payload = build_discord(raw_discord(discord_source=source))

    # 7 个必需字段都在
    for field_name in DISCORD_SPEC.source_fields:
        assert field_name in payload.source


def test_discord_invite_url_may_be_empty():
    payload = build_discord(raw_discord(discord_source={**DISCORD_SOURCE, "invite_url": ""}))
    assert payload.source["invite_url"] == ""
    assert validate_page_payload(payload, DISCORD_SPEC) == []


def test_discord_invite_url_must_be_url_when_present():
    with pytest.raises(PagePublishError, match="invite_url"):
        build_discord(
            raw_discord(discord_source={**DISCORD_SOURCE, "invite_url": "not-a-url"})
        )


def test_discord_url_must_be_a_message_link():
    """Discord 用正则校验消息链接，不是简单前缀。"""
    with pytest.raises(PagePublishError, match="格式不正确"):
        build_discord(
            raw_discord(
                discord_source={**DISCORD_SOURCE, "url": "https://discord.com/channels/1/2"}
            )
        )


def test_discord_source_requires_starter_fields():
    """Discord 用 starter_* / channel_name，而不是社区的 author_*。"""
    broken = {k: v for k, v in DISCORD_SOURCE.items() if k != "starter_name"}
    with pytest.raises(PagePublishError, match="starter_name"):
        build_discord(raw_discord(discord_source=broken))


def test_discord_requires_at_least_four_h2():
    payload = build_discord(raw_discord(html="<div><h2>A</h2><h2>B</h2></div>"))
    errors = validate_page_payload(payload, DISCORD_SPEC)

    assert any("至少包含 4 个 <h2>" in error for error in errors)


def test_discord_meta_title_length_is_capped():
    payload = build_discord(raw_discord(meta_title="x" * 66))
    errors = validate_page_payload(payload, DISCORD_SPEC)

    assert any("meta_title 应在 65" in error for error in errors)


def test_discord_meta_description_must_be_in_range():
    too_short = build_discord(raw_discord(td="too short"))
    errors = validate_page_payload(too_short, DISCORD_SPEC)
    assert any("120~170" in error for error in errors)

    too_long = build_discord(raw_discord(td="x" * 171))
    errors = validate_page_payload(too_long, DISCORD_SPEC)
    assert any("120~170" in error for error in errors)


def test_community_has_no_meta_length_rule():
    """社区脚本没有 meta 长度规则，短 description 不应报错。"""
    payload = build(raw_page())
    assert validate_page_payload(payload, SPEC) == []


def test_discord_template_must_be_discord_page():
    payload = build_discord(raw_discord(template="community_post"))
    errors = validate_page_payload(payload, DISCORD_SPEC)

    assert any("discord-page" in error for error in errors)


# ---------------------------------------------------------------------------
# 权限分档：两个脚本要求不同
# ---------------------------------------------------------------------------


def test_missing_scopes_splits_blocking_and_blog_only():
    from app.shopify.client import missing_scopes

    # 真实 token 的权限应有尽有
    real = [
        "read_files",
        "read_metaobject_definitions",
        "read_metaobjects",
        "read_products",
        "read_content",
        "write_content",
    ]
    assert missing_scopes(real) == ([], [])


def test_pages_only_token_is_not_blocked_by_blog_scopes():
    """只发页面的 token 不该被 metaobject / files 权限卡住。"""
    from app.shopify.client import missing_scopes

    blocking, blog_only = missing_scopes(["read_content", "write_content"])
    assert blocking == []
    assert "read_products" in blog_only


def test_online_store_pages_scope_family_is_accepted():
    """Discord 脚本接受 read/write_online_store_pages 这一族权限。"""
    from app.shopify.client import missing_scopes

    blocking, _ = missing_scopes(
        ["read_online_store_pages", "write_online_store_pages"]
    )
    assert blocking == []


def test_without_content_scopes_publishing_is_blocked():
    from app.shopify.client import missing_scopes

    blocking, _ = missing_scopes(["read_files", "read_products"])
    assert len(blocking) == 2


# ---------------------------------------------------------------------------
# MakerWorld 栏目：三个脚本里校验最严的一个
# ---------------------------------------------------------------------------

MAKER_SPEC = get_page_spec("makerworld")
assert MAKER_SPEC is not None

MAKER_SOURCE_URL = "https://makerworld.com/en/models/3034621-minimal-balmuda-style-nas-case"

MAKER_SOURCE = {
    "title": "Minimal BALMUDA Style ZimaBoard 2 NAS Case",
    "url": MAKER_SOURCE_URL,
    "excerpt": "A minimal BALMUDA-style case with dual 3.5-inch bays.",
    "creator_name": "ExampleCreator",
    "creator_avatar_url": "https://makerworld.com/avatar/1.png",
    "creator_profile_url": "https://makerworld.com/en/@examplecreator",
    "platform": "MakerWorld",
    "model_id": "3034621",
    "license": "BY-NC",
}

MAKER_META_DESCRIPTION = (
    "A minimal BALMUDA-style ZimaBoard 2 NAS case with dual 3.5-inch HDD bays, "
    "printed panels, and a quiet airflow path for a home server build."
)
MAKER_SUMMARY = (
    "This minimal BALMUDA-style enclosure holds a ZimaBoard 2 with two 3.5-inch drives, "
    "keeps cabling internal, and leaves the front panel clean."
)

# alt 必须落在 50~100 字符
MAKER_IMG_ALT = (
    "Front view of the printed BALMUDA style NAS case holding two 3.5 inch drives"
)


def maker_html(**overrides):
    src = overrides.get("source_url", MAKER_SOURCE_URL)
    return (
        "<div>"
        "<h2>Design goals</h2><p>Quiet and minimal.</p>"
        "<h2>Print settings</h2><p>PETG at 0.2mm.</p>"
        "<h2>Assembly</h2><p>Screw the bays in place.</p>"
        "<h2>Source model</h2>"
        f'<p><a href="{src}" title="Original MakerWorld model page" '
        'target="_blank" rel="noopener noreferrer nofollow">BALMUDA NAS case model</a></p>'
        f'<img src="https://cdn.shopify.com/a.png" alt="{MAKER_IMG_ALT}" '
        'title="Printed enclosure front view" loading="lazy">'
        "</div>"
    )


def raw_maker(**overrides):
    base = {
        "title": "Minimal BALMUDA-Style ZimaBoard 2 NAS Case with Dual HDD Bays",
        "meta_title": "ZimaBoard 2 NAS Case with Dual 3.5-Inch HDD Bays",
        "td": MAKER_META_DESCRIPTION,
        "summary": MAKER_SUMMARY,
        "url": "/pages/zimaboard-2-balmuda-style-nas-case-dual-hdd",
        "template": "makerworld-page",
        "html": maker_html(),
        "maker_source": dict(MAKER_SOURCE),
    }
    base.update(overrides)
    return base


def build_maker(raw=None, **kwargs):
    return build_page_payload(
        raw if raw is not None else raw_maker(),
        channel_id="makerworld",
        spec=MAKER_SPEC,
        **kwargs,
    )


def test_makerworld_spec_matches_script():
    assert MAKER_SPEC.verified is True
    assert MAKER_SPEC.template == "makerworld-page"
    # 脚本用的是 maker_source，不是 makerworld_source
    assert MAKER_SPEC.source_key == "maker_source"
    assert ("maker_summary", "multi_line_text_field", "summary") in MAKER_SPEC.extra_metafields
    assert MAKER_SPEC.h2_min == 4
    assert MAKER_SPEC.summary_min == 80


def test_makerworld_valid_payload_passes():
    payload = build_maker()
    assert validate_page_payload(payload, MAKER_SPEC) == []


def test_makerworld_requires_summary_of_at_least_80_chars():
    payload = build_maker(raw_maker(summary="Too thin."))
    errors = validate_page_payload(payload, MAKER_SPEC)

    assert any("summary 应至少 80" in error for error in errors)


def test_makerworld_requires_lazy_loading():
    html = maker_html().replace(' loading="lazy"', "")
    payload = build_maker(raw_maker(html=html))
    errors = validate_page_payload(payload, MAKER_SPEC)

    assert any('loading="lazy"' in error for error in errors)


def test_makerworld_enforces_alt_length_range():
    too_short = maker_html().replace(MAKER_IMG_ALT, "short alt")
    payload = build_maker(raw_maker(html=too_short))
    errors = validate_page_payload(payload, MAKER_SPEC)
    assert any("alt 应在 50~100" in error for error in errors)

    too_long = maker_html().replace(MAKER_IMG_ALT, "x" * 101)
    payload = build_maker(raw_maker(html=too_long))
    errors = validate_page_payload(payload, MAKER_SPEC)
    assert any("alt 应在 50~100" in error for error in errors)


def test_makerworld_rejects_forbidden_anchor_text():
    html = maker_html().replace("BALMUDA NAS case model", "click here")
    payload = build_maker(raw_maker(html=html))
    errors = validate_page_payload(payload, MAKER_SPEC)

    assert any("anchor 文本不合适" in error for error in errors)


def test_makerworld_requires_third_party_nofollow():
    html = maker_html().replace("noopener noreferrer nofollow", "noopener noreferrer")
    payload = build_maker(raw_maker(html=html))
    errors = validate_page_payload(payload, MAKER_SPEC)

    assert any("nofollow" in error for error in errors)


def test_makerworld_requires_external_target_blank_and_rel():
    html = maker_html().replace(' target="_blank" rel="noopener noreferrer nofollow"', "")
    payload = build_maker(raw_maker(html=html))
    errors = validate_page_payload(payload, MAKER_SPEC)

    assert any('target="_blank"' in error for error in errors)
    assert any("rel 令牌" in error for error in errors)


def test_makerworld_internal_link_must_not_use_blank():
    html = maker_html().replace(
        f'<a href="{MAKER_SOURCE_URL}" title="Original MakerWorld model page" '
        'target="_blank" rel="noopener noreferrer nofollow">BALMUDA NAS case model</a>',
        f'<a href="{MAKER_SOURCE_URL}" title="t" target="_blank" rel="noopener noreferrer nofollow">m</a>'
        '<a href="/collections/all" title="Collection page" target="_blank">collection</a>',
    )
    payload = build_maker(raw_maker(html=html))
    errors = validate_page_payload(payload, MAKER_SPEC)

    assert any("站内链接" in error for error in errors)


def test_makerworld_body_must_cite_source_url():
    html = maker_html().replace(MAKER_SOURCE_URL, "https://example.com/other")
    payload = build_maker(raw_maker(html=html))
    errors = validate_page_payload(payload, MAKER_SPEC)

    assert any("原始 MakerWorld 模型页" in error for error in errors)


def test_makerworld_source_url_must_be_makerworld_model_page():
    with pytest.raises(PagePublishError, match="必须指向 makerworld.com"):
        build_maker(
            raw_maker(maker_source={**MAKER_SOURCE, "url": "https://example.com/models/1"})
        )


def test_makerworld_platform_must_be_makerworld():
    with pytest.raises(PagePublishError, match="必须是 'makerworld'"):
        build_maker(
            raw_maker(maker_source={**MAKER_SOURCE, "platform": "Thingiverse"})
        )


def test_makerworld_model_id_must_be_digits():
    with pytest.raises(PagePublishError, match="只能包含数字"):
        build_maker(raw_maker(maker_source={**MAKER_SOURCE, "model_id": "abc123"}))


def test_makerworld_creator_profile_must_be_makerworld():
    with pytest.raises(PagePublishError, match="creator_profile_url"):
        build_maker(
            raw_maker(
                maker_source={**MAKER_SOURCE, "creator_profile_url": "https://example.com/u"}
            )
        )


def test_makerworld_metafields_include_maker_summary():
    metafields = page_metafields(build_maker(), MAKER_SPEC)
    by_key = {item["key"]: item for item in metafields}

    assert set(by_key) == {"title_tag", "description_tag", "maker_source", "maker_summary"}
    assert by_key["maker_summary"]["namespace"] == "custom"
    assert by_key["maker_summary"]["type"] == "multi_line_text_field"
    assert by_key["maker_summary"]["value"] == MAKER_SUMMARY
    # 依旧不碰 related_products
    assert "related_products" not in by_key


# ---------------------------------------------------------------------------
# 用户故事：来源叫 user_info，且正文必须包含两句固定文案
# ---------------------------------------------------------------------------

USER_SPEC = get_page_spec("user-story")
assert USER_SPEC is not None

USER_INFO = {
    "name": "ExampleBuilder",
    "handle": "example-builder",
    "avatar_url": "https://community.zimaspace.com/user_avatar/x/45.png",
    "profile_url": "https://community.zimaspace.com/u/example-builder",
}

USER_HTML = (
    "<div>"
    '<h2>A Note from Zima</h2><p>We asked how the build came together.</p>'
    "<h2>Starting small</h2><p>It began with a single bay.</p>"
    "<h2>Scaling to 350 TB</h2><p>Then it grew.</p>"
    "<h2>The Story Is Still Being Written</h2><p>More to come.</p>"
    "</div>"
)


def raw_user(**overrides):
    base = {
        "title": "How ExampleBuilder Built a 350 TB ZimaBoard 2 Array",
        "meta_title": "User Story: A 350 TB ZimaBoard 2 Array",
        "td": "A user story about scaling a ZimaBoard 2 build to 350 TB of storage.",
        "url": "/pages/001-example-builder-zimaboard2-350tb",
        "template": "user-story",
        "html": USER_HTML,
        "user_info": dict(USER_INFO),
    }
    base.update(overrides)
    return base


def build_user(raw=None, **kwargs):
    return build_page_payload(
        raw if raw is not None else raw_user(),
        channel_id="user-story",
        spec=USER_SPEC,
        **kwargs,
    )


def test_user_story_spec_matches_script():
    assert USER_SPEC.verified is True
    assert USER_SPEC.template == "user-story"
    # 脚本用的是 user_info，不是 user_source
    assert USER_SPEC.source_key == "user_info"
    assert USER_SPEC.h2_min == 4
    # 用户故事脚本没有 meta 长度规则
    assert USER_SPEC.meta_title_max == 0
    assert USER_SPEC.summary_min == 0


def test_user_story_valid_payload_passes():
    assert validate_page_payload(build_user(), USER_SPEC) == []


def test_user_story_requires_fixed_copy_in_body():
    html = USER_HTML.replace("A Note from Zima", "A note")
    payload = build_user(raw_user(html=html))
    errors = validate_page_payload(payload, USER_SPEC)

    assert any("A Note from Zima" in error for error in errors)


def test_user_story_requires_closing_line():
    html = USER_HTML.replace("The Story Is Still Being Written", "More soon")
    payload = build_user(raw_user(html=html))
    errors = validate_page_payload(payload, USER_SPEC)

    assert any("The Story Is Still Being Written" in error for error in errors)


def test_user_story_requires_four_h2():
    html = "<div><h2>A Note from Zima</h2><h2>The Story Is Still Being Written</h2></div>"
    payload = build_user(raw_user(html=html))
    errors = validate_page_payload(payload, USER_SPEC)

    assert any("至少包含 4 个 <h2>" in error for error in errors)


def test_user_info_requires_profile_url_and_name():
    broken = {k: v for k, v in USER_INFO.items() if k != "profile_url"}
    with pytest.raises(PagePublishError, match="profile_url"):
        build_user(raw_user(user_info=broken))


def test_user_info_avatar_may_be_blank():
    payload = build_user(raw_user(user_info={**USER_INFO, "avatar_url": ""}))
    assert payload.source["avatar_url"] == ""


def test_user_info_profile_url_must_be_complete_url():
    with pytest.raises(PagePublishError, match="profile_url"):
        build_user(
            raw_user(user_info={**USER_INFO, "profile_url": "community.zimaspace.com/u/x"})
        )


def test_user_story_metafields_use_user_info():
    metafields = page_metafields(build_user(), USER_SPEC)
    by_key = {item["key"]: item for item in metafields}

    assert set(by_key) == {"title_tag", "description_tag", "user_info"}
    assert by_key["user_info"]["namespace"] == "custom"
    assert by_key["user_info"]["type"] == "json"
    assert json.loads(by_key["user_info"]["value"])["handle"] == "example-builder"


# ---------------------------------------------------------------------------
# Custom 文章：模板自由、来源可选（平台新增的通用出口）
# ---------------------------------------------------------------------------


def test_custom_spec_allows_any_template():
    spec = PAGE_CHANNEL_SPECS["custom"]
    assert spec.verified is True
    assert spec.allow_any_template is True
    # 模板由 JSON 决定，所以不设 H2 要求
    assert spec.h2_min == 0
    # 来源可选，键名自动识别
    assert spec.source_key == ""
    assert spec.source_key_suffix == "_source"


def test_custom_accepts_arbitrary_template_name():
    raw = {
        "title": "Custom page",
        "meta_title": "MT",
        "meta_description": "MD" * 30,
        "url": "/pages/custom-page",
        "template": "some-brand-new-template-v9",
        "html": "<div><p>Anything goes.</p></div>",
    }
    spec = PAGE_CHANNEL_SPECS["custom"]
    payload = build_page_payload(
        raw, channel_id="custom", spec=spec, source_file="Custom/a.json"
    )

    assert payload.template_suffix == "some-brand-new-template-v9"
    # 模板任意 → 不要求 H2，也不套用栏目专属规则
    assert validate_page_payload(payload, spec) == []


def test_custom_requires_template_in_json():
    raw = {
        "title": "Custom page",
        "meta_title": "MT",
        "meta_description": "MD" * 30,
        "url": "/pages/custom-page",
        "html": "<div><p>x</p></div>",
    }
    spec = PAGE_CHANNEL_SPECS["custom"]
    payload = build_page_payload(
        raw, channel_id="custom", spec=spec, source_file="Custom/a.json"
    )

    assert any("template" in error for error in validate_page_payload(payload, spec))


def test_custom_auto_detects_source_metafield_key():
    spec = PAGE_CHANNEL_SPECS["custom"]
    raw = {
        "title": "Custom page",
        "meta_title": "MT",
        "meta_description": "MD" * 30,
        "url": "/pages/custom-page",
        "template": "tpl",
        "html": "<div><p>x</p></div>",
        "something_source": {"any": "shape"},
    }
    payload = build_page_payload(
        raw, channel_id="custom", spec=spec, source_file="Custom/a.json"
    )

    assert payload.source_key == "something_source"
    assert payload.source == {"any": "shape"}

    keys = {item["key"] for item in page_metafields(payload, spec)}
    assert keys == {"title_tag", "description_tag", "something_source"}


def test_custom_source_is_optional():
    spec = PAGE_CHANNEL_SPECS["custom"]
    raw = {
        "title": "Custom page",
        "meta_title": "MT",
        "meta_description": "MD" * 30,
        "url": "/pages/custom-page",
        "template": "tpl",
        "html": "<div><p>x</p></div>",
    }
    payload = build_page_payload(
        raw, channel_id="custom", spec=spec, source_file="Custom/a.json"
    )

    assert payload.source_key == ""
    keys = {item["key"] for item in page_metafields(payload, spec)}
    # 没有来源时只写两个 SEO
    assert keys == {"title_tag", "description_tag"}


def test_custom_still_enforces_universal_rules():
    """模板自由 ≠ 没有规则：禁 h1、外链安全标记仍然生效。"""
    spec = PAGE_CHANNEL_SPECS["custom"]
    raw = {
        "title": "Custom page",
        "meta_title": "MT",
        "meta_description": "MD" * 30,
        "url": "/pages/custom-page",
        "template": "tpl",
        "html": '<div><h1>Bad</h1><p><a href="https://example.com/x" title="t">link text</a></p></div>',
    }
    payload = build_page_payload(
        raw, channel_id="custom", spec=spec, source_file="Custom/a.json"
    )
    errors = validate_page_payload(payload, spec)

    assert any("<h1>" in error for error in errors)
    assert any('target="_blank"' in error for error in errors)
