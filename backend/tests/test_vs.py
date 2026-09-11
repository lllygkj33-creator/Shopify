"""VS 对比页测试：资源注入 + 该栏目特有的校验规则。

VS 是六个页面栏目里最特殊的一个：没有来源 metafield、禁止 H1/H2、
要求 8 对 COMPARE 标记、published 必须为 true、related_products 必须为空、
锚文本要 2~6 个英文单词，并且发布前会自动注入 3 个视频 + 3 篇文章。
"""

from __future__ import annotations

import random

import pytest

from app.shopify.page_publisher import (
    PagePublishError,
    build_page_payload,
    get_page_spec,
    page_metafields,
    validate_page_payload,
)
from app.shopify.vs_resources import (
    PENDING_COVER,
    RESOURCES_CLOSE_MARKER,
    RESOURCES_OPEN_MARKER,
    ResourceInjectionError,
    blog_card,
    build_resources_html,
    choose_resources,
    detect_zima_products,
    inject_resources,
    resource_allocation,
    youtube_card,
)

VS_SPEC = get_page_spec("vs")
assert VS_SPEC is not None

MARKERS = (
    "OVERVIEW",
    "SPECS",
    "CATEGORIES",
    "RECOMMENDATION",
    "SKU-FAMILY",
    "RESOURCES",
    "FAQ",
    "METHODOLOGY",
)


def marker_block(name: str, inner: str = "<p>Compare content.</p>") -> str:
    return f"<!-- COMPARE:{name} -->\n{inner}\n<!-- /COMPARE:{name} -->"


VS_META_DESCRIPTION = (
    "Compare ZimaBoard 2 and ZimaBlade for a small home server: expansion, "
    "storage options, noise, and which board fits a beginner build."
)


def vs_html(**overrides) -> str:
    blocks = []
    for name in MARKERS:
        if name == "RESOURCES":
            # 注意：RESOURCES 的这组 COMPARE 标记**本身就是注入目标**，
            # 所以只能出现一次，不能再套一层 marker_block
            blocks.append(f"{RESOURCES_OPEN_MARKER}\n{RESOURCES_CLOSE_MARKER}")
        else:
            blocks.append(marker_block(name))

    return (
        '<div class="zima-compare" data-zima-compare-meta="1">'
        + "".join(blocks)
        + '<p><a href="/collections/all" title="Browse all Zima hardware">'
        "browse all Zima hardware</a></p>"
        + '<p><a href="https://example.com/review" title="Third party review page" '
        'target="_blank" rel="nofollow noopener noreferrer">independent hardware review notes</a></p>'
        + "</div>"
    )


def raw_vs(**overrides):
    base = {
        "title": "ZimaBoard 2 vs ZimaBlade for a Compact Home Server",
        "meta_title": "ZimaBoard 2 vs ZimaBlade: Compact Server Pick",
        "td": VS_META_DESCRIPTION,
        "url": "zimaboard-2-vs-zimablade",
        "template": "nas-a-vs-b",
        "published": True,
        "related_products": [],
        "html": vs_html(),
    }
    base.update(overrides)
    return base


def build_vs(raw=None, **kwargs):
    return build_page_payload(
        raw if raw is not None else raw_vs(),
        channel_id="vs",
        spec=VS_SPEC,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# 规格
# ---------------------------------------------------------------------------


def test_vs_spec_matches_script():
    assert VS_SPEC.verified is True
    # 脚本常量与硬校验都是 nas-a-vs-b
    assert VS_SPEC.template == "nas-a-vs-b"
    # 唯一没有来源 metafield 的栏目
    assert VS_SPEC.source_key == ""
    assert VS_SPEC.forbid_h2 is True
    assert len(VS_SPEC.required_marker_pairs) == 8
    assert VS_SPEC.require_published_true is True
    assert VS_SPEC.require_empty_related_products is True
    assert (VS_SPEC.anchor_word_min, VS_SPEC.anchor_word_max) == (2, 6)


def test_vs_metafields_contain_only_seo():
    """VS 没有来源 metafield，只写两个 SEO。"""
    metafields = page_metafields(build_vs(), VS_SPEC)
    by_key = {item["key"] for item in metafields}

    assert by_key == {"title_tag", "description_tag"}


# ---------------------------------------------------------------------------
# 校验规则
# ---------------------------------------------------------------------------


def test_valid_vs_payload_passes_after_placeholder_resources():
    assert validate_page_payload(build_vs(), VS_SPEC) == []


def test_vs_forbids_h1_and_h2():
    h1 = build_vs(raw_vs(html=vs_html().replace("<p>Compare content.</p>", "<h1>T</h1>")))
    assert any("<h1>" in error for error in validate_page_payload(h1, VS_SPEC))

    h2 = build_vs(raw_vs(html=vs_html().replace("<p>Compare content.</p>", "<h2>T</h2>")))
    errors = validate_page_payload(h2, VS_SPEC)
    assert any("H2 标题必须由 VS Liquid 模板输出" in error for error in errors)


def test_vs_requires_compare_meta_attribute():
    html = vs_html().replace(' data-zima-compare-meta="1"', "")
    errors = validate_page_payload(build_vs(raw_vs(html=html)), VS_SPEC)

    assert any("data-zima-compare-meta" in error for error in errors)


def test_vs_requires_each_marker_exactly_once():
    html = vs_html().replace("<!-- COMPARE:FAQ -->", "")
    errors = validate_page_payload(build_vs(raw_vs(html=html)), VS_SPEC)

    assert any("FAQ" in error and "开标记" in error for error in errors)


def test_vs_rejects_duplicate_markers():
    html = vs_html() + marker_block("SPECS")
    errors = validate_page_payload(build_vs(raw_vs(html=html)), VS_SPEC)

    assert any("SPECS" in error for error in errors)


def test_vs_rejects_placeholder_strings():
    html = vs_html().replace("<p>Compare content.</p>", "<p>YOUTUBE_URL_1</p>")
    errors = validate_page_payload(build_vs(raw_vs(html=html)), VS_SPEC)

    assert any("占位串" in error for error in errors)


def test_vs_requires_published_true():
    errors = validate_page_payload(
        build_vs(raw_vs(published=False)), VS_SPEC
    )
    assert any("published 必须为 true" in error for error in errors)


def test_vs_requires_empty_related_products():
    errors = validate_page_payload(
        build_vs(raw_vs(related_products=["gid://shopify/Product/1"])), VS_SPEC
    )
    assert any("related_products 必须为空数组" in error for error in errors)


def test_vs_meta_lengths():
    long_title = build_vs(raw_vs(meta_title="x" * 66))
    assert any(
        "meta_title" in error for error in validate_page_payload(long_title, VS_SPEC)
    )

    short_td = build_vs(raw_vs(td="too short"))
    assert any(
        "meta description" in error
        for error in validate_page_payload(short_td, VS_SPEC)
    )


def test_vs_inline_anchor_must_be_two_to_six_words():
    html = vs_html().replace("browse all Zima hardware", "hardware")
    errors = validate_page_payload(build_vs(raw_vs(html=html)), VS_SPEC)

    assert any("2~6 个英文单词" in error for error in errors)


def test_vs_rejects_forbidden_anchor_phrases():
    html = vs_html().replace("browse all Zima hardware", "click here")
    errors = validate_page_payload(build_vs(raw_vs(html=html)), VS_SPEC)

    assert any("禁止的 anchor 短语" in error for error in errors)


def test_vs_internal_link_must_not_open_new_tab():
    html = vs_html().replace(
        '<a href="/collections/all" title="Browse all Zima hardware">',
        '<a href="/collections/all" title="Browse all Zima hardware" target="_blank">',
    )
    errors = validate_page_payload(build_vs(raw_vs(html=html)), VS_SPEC)

    assert any("站内链接" in error for error in errors)


def test_vs_third_party_link_requires_nofollow():
    html = vs_html().replace("nofollow noopener noreferrer", "noopener noreferrer")
    errors = validate_page_payload(build_vs(raw_vs(html=html)), VS_SPEC)

    assert any("nofollow" in error for error in errors)


def test_vs_image_requires_lazy_and_async():
    html = vs_html().replace(
        "</div>",
        '<img src="https://x/a.png" alt="A photo of the board" title="Board photo">'
        "</div>",
    )
    errors = validate_page_payload(build_vs(raw_vs(html=html)), VS_SPEC)

    assert any('loading="lazy"' in error for error in errors)
    assert any('decoding="async"' in error for error in errors)


# ---------------------------------------------------------------------------
# 资源识别与分配
# ---------------------------------------------------------------------------


def test_detect_one_two_and_three_products():
    assert detect_zima_products("ZimaBoard 2 vs ZimaBlade") == [
        "zimaboard-2",
        "zimablade",
    ]
    assert detect_zima_products("ZimaCube 2 deep dive") == ["zimacube-2"]
    assert detect_zima_products(
        "ZimaCube 2 vs ZimaBoard 2 vs ZimaBlade"
    ) == ["zimacube-2", "zimaboard-2", "zimablade"]


def test_detect_products_falls_back_to_body():
    assert detect_zima_products("A tiny server", "<p>Built on ZimaBlade.</p>") == [
        "zimablade"
    ]


def test_no_product_detected_blocks_allocation():
    """识别不到产品时 detect 返回空，由分配阶段报出可读错误。"""
    assert detect_zima_products("Some unrelated comparison", "<p>Nothing here.</p>") == []

    with pytest.raises(ResourceInjectionError, match="无法从标题里识别"):
        resource_allocation([])


def test_allocation_rules():
    assert resource_allocation(["zimaboard-2"]) == {"zimaboard-2": 3}
    assert resource_allocation(["zimaboard-2", "zimablade"]) == {
        "zimaboard-2": 2,
        "zimablade": 1,
    }
    assert resource_allocation(
        ["zimacube-2", "zimaboard-2", "zimablade"]
    ) == {"zimacube-2": 1, "zimaboard-2": 1, "zimablade": 1}


def test_choose_resources_returns_requested_counts():
    rng = random.Random(7)
    youtube = choose_resources(["zimaboard-2", "zimablade"], "youtube", rng)
    blog = choose_resources(["zimaboard-2", "zimablade"], "blog", rng)

    assert len(youtube) == 3
    assert len(blog) == 3
    # 2 + 1 的分配
    assert sum(1 for item in youtube if item["product_key"] == "zimaboard-2") == 2
    assert sum(1 for item in youtube if item["product_key"] == "zimablade") == 1


def test_youtube_card_opens_new_tab_with_safe_rel():
    card = youtube_card(
        {
            "title": "ZimaBoard 2 Review",
            "url": "https://www.youtube.com/watch?v=abc",
            "video_id": "abc",
            "creator": "Someone",
            "product_label": "ZimaBoard 2",
        }
    )

    assert 'target="_blank"' in card
    assert "nofollow noopener noreferrer" in card
    assert 'loading="lazy"' in card
    assert 'decoding="async"' in card
    assert "i.ytimg.com/vi/abc/maxresdefault.jpg" in card


def test_blog_card_stays_in_same_tab():
    """博客卡片是站内链接，不能 target=_blank。"""
    card = blog_card(
        {
            "title": "A creator story",
            "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/x",
            "creator": "Someone",
            "product_label": "ZimaBlade",
        },
        "https://cdn.shopify.com/cover.png",
    )

    assert "target=" not in card
    assert "zima-compare__media-item" in card


async def test_inject_resources_replaces_block_and_keeps_one_marker_pair():
    html, note = await inject_resources(
        "ZimaBoard 2 vs ZimaBlade",
        vs_html(),
        fetch_covers=False,
        rng=random.Random(3),
    )

    assert html.count(RESOURCES_OPEN_MARKER) == 1
    assert html.count(RESOURCES_CLOSE_MARKER) == 1
    # 3 个视频 + 3 篇文章
    assert html.count("zima-compare__media-item") == 6
    assert PENDING_COVER in html
    assert "YouTube [" in note and "Blogs [" in note


async def test_injected_html_passes_validation():
    """注入后的 HTML 必须能通过全部 VS 校验（含 2~6 词锚文本与图片属性）。"""
    html, _ = await inject_resources(
        "ZimaBoard 2 vs ZimaBlade",
        vs_html(),
        fetch_covers=False,
        rng=random.Random(11),
    )
    payload = build_vs(raw_vs(html=html))

    assert validate_page_payload(payload, VS_SPEC) == []


async def test_injection_requires_exactly_one_marker_pair():
    html = vs_html().replace(RESOURCES_OPEN_MARKER, "")
    with pytest.raises(ResourceInjectionError, match="恰好包含一对"):
        await inject_resources(
            "ZimaBoard 2 vs ZimaBlade", html, fetch_covers=False
        )


async def test_cover_fetch_failure_surfaces():
    async def failing_fetcher(_url: str) -> str:
        raise ResourceInjectionError("og:image 缺失")

    with pytest.raises(ResourceInjectionError, match="og:image"):
        await build_resources_html(
            "ZimaBoard 2 vs ZimaBlade",
            vs_html(),
            fetch_covers=True,
            rng=random.Random(1),
            cover_fetcher=failing_fetcher,
        )


async def test_cover_fetcher_is_used_when_fetching():
    calls: list[str] = []

    async def fetcher(url: str) -> str:
        calls.append(url)
        return "https://cdn.shopify.com/cover.png"

    html, _ = await build_resources_html(
        "ZimaBoard 2 vs ZimaBlade",
        vs_html(),
        fetch_covers=True,
        rng=random.Random(5),
        cover_fetcher=fetcher,
    )

    assert len(calls) == 3
    assert "https://cdn.shopify.com/cover.png" in html


async def test_build_page_payload_rejects_bad_related_products_type():
    with pytest.raises(PagePublishError, match="related_products 必须是数组"):
        build_vs(raw_vs(related_products={"a": 1}))
