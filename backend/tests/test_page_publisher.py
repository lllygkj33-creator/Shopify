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
    '<a href="https://example.com" title="Example">link</a>'
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
    with pytest.raises(PagePublishError, match="完整的社区主题链接"):
        load_source({"community_source": broken}, SPEC)


def test_load_source_enforces_author_profile_url():
    broken = dict(SOURCE, author_profile_url="https://example.com/u/x")
    with pytest.raises(PagePublishError, match="社区用户链接"):
        load_source({"community_source": broken}, SPEC)


def test_load_source_passes_through_for_unverified_channels():
    """未核对规格的栏目只做宽松处理。"""
    discord = get_page_spec("discord")
    assert discord is not None and discord.verified is False

    result = load_source({"discord_source": {"anything": "goes"}}, discord)
    assert result == {"anything": "goes"}


# ---------------------------------------------------------------------------
# 硬校验
# ---------------------------------------------------------------------------


def test_validation_passes_for_good_payload():
    assert validate_page_payload(build(), SPEC) == []


def test_validation_rejects_h1():
    payload = build(raw_page(html="<h1>T</h1>" + GOOD_HTML))
    errors = validate_page_payload(payload, SPEC)
    assert any("<h1>" in error for error in errors)


def test_validation_requires_h2():
    payload = build(raw_page(html='<div><img src="a" alt="a" title="t"></div>'))
    assert any("<h2>" in error for error in validate_page_payload(payload, SPEC))


def test_validation_requires_img_alt_and_title():
    payload = build(
        raw_page(html='<div><h2>x</h2><img src="a.png"></div>')
    )
    errors = validate_page_payload(payload, SPEC)
    assert any("alt" in error for error in errors)
    assert any("title" in error for error in errors)


def test_validation_requires_anchor_title():
    payload = build(
        raw_page(html='<div><h2>x</h2><a href="https://e.com">no title</a></div>')
    )
    assert any("链接缺少非空 title" in error for error in validate_page_payload(payload, SPEC))


def test_validation_rejects_wrong_template():
    payload = build(raw_page(template="discord-page"))
    errors = validate_page_payload(payload, SPEC)
    assert any("community_post" in error for error in errors)


# ---------------------------------------------------------------------------
# 字段别名
# ---------------------------------------------------------------------------


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


def test_other_page_channels_are_registered_but_unverified():
    """
    其余 4 个页面栏目的规格来自 PRD，尚未用真实脚本核对 —— 这里把状态钉住，
    等拿到各自脚本后收紧校验并把 verified 改成 True。
    """
    for channel_id in ("discord", "user-story", "vs", "makerworld"):
        spec = PAGE_CHANNEL_SPECS[channel_id]
        assert spec.verified is False
        assert spec.source_key.endswith("_source")

    assert PAGE_CHANNEL_SPECS["vs"].template == "nas-a-vs-b"
