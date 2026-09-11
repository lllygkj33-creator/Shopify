"""「Shopify 对象 → 平台栏目」映射测试。

这个映射是导入和对账的判断依据：认错了就会把内容归到错的栏目，
认不出来就会静默丢掉（实测 514 条内容不属于平台任何栏目）。

最要紧的一条：后端的 5 条博客映射和前端 `src/config/channels.ts` 的
`blogHandle` 是**两份副本**，改了一处忘了另一处，导入就会漏。
所以这里直接读前端的 TS 文件做交叉校验。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.channel_map import (
    BLOG_HANDLE_TO_CHANNEL,
    EXCLUDED_TEMPLATES,
    TEMPLATE_TO_CHANNEL,
    resolve_article_channel,
    resolve_page_channel,
)
from app.shopify.page_publisher import PAGE_CHANNEL_SPECS

CHANNELS_TS = Path(__file__).resolve().parents[2] / "src" / "config" / "channels.ts"


# ---------------------------------------------------------------------------
# 博客 handle → 栏目
# ---------------------------------------------------------------------------


def test_known_blogs_resolve():
    assert resolve_article_channel("tech-ai-hub").channel_id == "tech-ai-hub"
    assert resolve_article_channel("support-tips").channel_id == "support-tips"
    assert resolve_article_channel("nas-server-setup").channel_id == "nas-server-setup"
    assert resolve_article_channel("buying-guide").channel_id == "buying-guide"
    assert (
        resolve_article_channel("product-comparisons").channel_id
        == "product-comparison"
    )


def test_blog_outside_platform_is_reported_with_reason():
    resolution = resolve_article_channel("zima-campaign-hub")

    assert not resolution.resolved
    # 报数时用这个原因分组，不能是空的
    assert "zima-campaign-hub" in resolution.reason


def test_missing_blog_handle_is_reported():
    assert not resolve_article_channel(None).resolved
    assert not resolve_article_channel("").resolved


def parse_frontend_channels(source: str) -> dict[str, str | None]:
    """从 channels.ts 里读出 栏目 id → blogHandle。

    按「下一个 id: 之前」切块，而不是用一条跨行的宽松正则 ——
    后者会串到相邻条目上，把 handle 和 id 配错。
    """
    marks = list(re.finditer(r"^\s{2,}id:\s*'([^']+)'", source, re.M))
    result: dict[str, str | None] = {}

    for index, mark in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(source)
        block = source[mark.end() : end]
        handle = re.search(r"blogHandle:\s*'([^']*)'", block)
        result[mark.group(1)] = handle.group(1) if handle else None

    return result


@pytest.mark.skipif(not CHANNELS_TS.exists(), reason="前端配置不在预期位置")
def test_blog_mapping_matches_frontend_channel_config():
    """后端映射必须和前端栏目配置一致（防止两份副本漂移）。

    只比对真正绑定博客的栏目：页面类栏目的 blogHandle 是空的。
    """
    frontend = {
        channel_id: handle
        for channel_id, handle in parse_frontend_channels(
            CHANNELS_TS.read_text(encoding="utf-8")
        ).items()
        if handle
    }

    assert frontend == {
        channel_id: handle for handle, channel_id in BLOG_HANDLE_TO_CHANNEL.items()
    }


@pytest.mark.skipif(not CHANNELS_TS.exists(), reason="前端配置不在预期位置")
def test_every_frontend_channel_is_known_to_the_backend():
    """前端栏目要么能导入（博客/模板），要么在排除名单里 —— 不能有第三种。"""
    known = set(BLOG_HANDLE_TO_CHANNEL.values()) | set(TEMPLATE_TO_CHANNEL.values())
    excluded = {"local-ai-model-hardware", "app-hardware-requirements", "custom"}

    unknown = {
        channel_id
        for channel_id, handle in parse_frontend_channels(
            CHANNELS_TS.read_text(encoding="utf-8")
        ).items()
        if channel_id not in known and channel_id not in excluded
    }

    assert not unknown, f"前端有后端不认识的栏目：{sorted(unknown)}"


# ---------------------------------------------------------------------------
# 页面模板 → 栏目
# ---------------------------------------------------------------------------


def test_template_mapping_is_derived_from_publish_specs():
    """不能手写第二份模板表 —— 必须从发布规格推导。"""
    expected = {
        spec.template: channel_id
        for channel_id, spec in PAGE_CHANNEL_SPECS.items()
        if spec.template
    }

    assert TEMPLATE_TO_CHANNEL == expected


def test_known_templates_resolve():
    """用**店铺里真实的 templateSuffix**（不是栏目 id）。

    注意 community-post 栏目的模板后缀是下划线的 `community_post`：
    导入实测命中了 548 个页面，说明店铺里确实是下划线写法。
    """
    assert resolve_page_channel("community_post").channel_id == "community-post"
    assert resolve_page_channel("discord-page").channel_id == "discord"
    assert resolve_page_channel("nas-a-vs-b").channel_id == "vs"
    assert resolve_page_channel("user-story").channel_id == "user-story"
    assert resolve_page_channel("makerworld-page").channel_id == "makerworld"


def test_blank_template_channel_is_not_a_page_mapping():
    """custom 栏目没有固定模板（模板由 JSON 指定），不能进模板映射表。"""
    assert resolve_page_channel("").channel_id is None
    assert "" not in TEMPLATE_TO_CHANNEL


@pytest.mark.parametrize("template", sorted(EXCLUDED_TEMPLATES))
def test_excluded_templates_are_not_imported_but_labelled(template):
    resolution = resolve_page_channel(template)

    assert not resolution.resolved
    # 被排除的也要有可读原因，导入报告里要按这个分组报数
    assert EXCLUDED_TEMPLATES[template] in resolution.reason


@pytest.mark.parametrize(
    "template, expected_fragment",
    [
        (None, "默认模板"),
        ("", "默认模板"),
        ("some-unknown-template", "不在平台栏目内"),
    ],
)
def test_unmapped_templates_explain_why(template, expected_fragment):
    resolution = resolve_page_channel(template)

    assert not resolution.resolved
    assert expected_fragment in resolution.reason


def test_excluded_and_mapped_do_not_overlap():
    """一个模板不能既被排除又算栏目内。"""
    assert not (set(EXCLUDED_TEMPLATES) & set(TEMPLATE_TO_CHANNEL))
