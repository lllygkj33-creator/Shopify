"""博客反链测试（来自 publish_user_stories.py 的可选功能）。

重点是**幂等**：重复运行不能把同一段反链追加两次。
"""

from __future__ import annotations

import pytest

from app.shopify.backlink import (
    BacklinkConfig,
    BacklinkError,
    BacklinkRunner,
    backlink_marker,
    build_backlink_block,
    load_backlink,
    parse_blog_article_url,
)

PAGE_HANDLE = "001-example-builder-zimaboard2-350tb"
PAGE_URL = f"https://shop.zimaspace.com/pages/{PAGE_HANDLE}"

CONFIG = BacklinkConfig(
    enabled=True,
    article_url="https://shop.zimaspace.com/blogs/tech-ai-hub/user-builds-so-far",
    blog_handle="tech-ai-hub",
    article_handle="user-builds-so-far",
    lead_in="Read the full build story:",
    anchor_text="a 350 TB ZimaBoard 2 array",
)


class FakeClient:
    def __init__(self, *, article=None, user_errors=None):
        self.article = article
        self.user_errors = user_errors or []
        self.calls: list[str] = []
        self.updated_body: str | None = None

    async def execute(self, query, variables=None, **kwargs):
        if "FindBacklinkArticle" in query:
            self.calls.append("find")
            nodes = [self.article] if self.article else []
            return {"articles": {"nodes": nodes}}

        if "articleUpdate" in query:
            self.calls.append("update")
            self.updated_body = variables["article"]["body"]
            if self.user_errors:
                return {
                    "articleUpdate": {"article": None, "userErrors": self.user_errors}
                }
            return {
                "articleUpdate": {
                    "article": {
                        "id": variables["id"],
                        "handle": "user-builds-so-far",
                        "body": self.updated_body,
                        "blog": {"handle": "tech-ai-hub"},
                    },
                    "userErrors": [],
                }
            }

        raise AssertionError(f"未预期的查询：{query[:50]}")


def article_with(body: str, *, blog_handle: str = "tech-ai-hub"):
    return {
        "id": "gid://shopify/Article/1",
        "title": "User builds so far",
        "handle": "user-builds-so-far",
        "body": body,
        "blog": {"handle": blog_handle},
    }


# ---------------------------------------------------------------------------
# 解析
# ---------------------------------------------------------------------------


def test_parse_blog_article_url():
    blog, article = parse_blog_article_url(
        "https://shop.zimaspace.com/blogs/buying-guide/is-one-nvme-slot-enough"
    )
    assert (blog, article) == ("buying-guide", "is-one-nvme-slot-enough")


def test_parse_blog_article_url_rejects_other_shapes():
    with pytest.raises(BacklinkError, match="backlink.article_url"):
        parse_blog_article_url("https://shop.zimaspace.com/pages/some-page")


def test_load_backlink_returns_none_when_absent():
    assert load_backlink({}) is None


def test_load_backlink_honours_disabled_flag():
    config = load_backlink({"backlink": {"enabled": False}})
    assert config is not None and config.enabled is False


def test_load_backlink_requires_all_three_fields():
    with pytest.raises(BacklinkError, match="lead_in"):
        load_backlink(
            {
                "backlink": {
                    "article_url": "https://shop.zimaspace.com/blogs/a/b",
                    "anchor_text": "x",
                }
            }
        )


def test_load_backlink_accepts_json_string():
    config = load_backlink(
        {
            "backlink": (
                '{"article_url":"https://shop.zimaspace.com/blogs/a/b",'
                '"lead_in":"Read:","anchor_text":"story"}'
            )
        }
    )
    assert config is not None
    assert (config.blog_handle, config.article_handle) == ("a", "b")


# ---------------------------------------------------------------------------
# 块构造
# ---------------------------------------------------------------------------


def test_backlink_block_contains_marker_and_data_attribute():
    block = build_backlink_block(PAGE_HANDLE, PAGE_URL, CONFIG)

    assert backlink_marker(PAGE_HANDLE) in block
    assert f'data-zima-user-story-backlink="{PAGE_HANDLE}"' in block
    assert f'href="{PAGE_URL}"' in block
    assert CONFIG.anchor_text in block


def test_backlink_block_escapes_html():
    config = BacklinkConfig(
        enabled=True,
        article_url="https://shop.zimaspace.com/blogs/a/b",
        blog_handle="a",
        article_handle="b",
        lead_in='Lead <b>in</b> & more',
        # 锚文本里带双引号：它会同时出现在文本与 title 属性里，
        # 文本上下文保留字面引号，属性上下文必须转义
        anchor_text='anchor "quoted" & text',
    )
    block = build_backlink_block(PAGE_HANDLE, PAGE_URL, config)

    # 文本里的尖括号不能变成真标签，& 必须转义
    assert "<b>" not in block
    assert "&lt;b&gt;" in block
    assert "&amp;" in block
    # 属性上下文里的双引号必须被转义（否则会把 title 属性截断）
    assert "&quot;quoted&quot;" in block
    assert 'title="anchor &quot;quoted&quot; &amp; text"' in block


# ---------------------------------------------------------------------------
# 执行（幂等是重点）
# ---------------------------------------------------------------------------


async def test_appends_backlink_when_absent():
    client = FakeClient(article=article_with("<p>existing body</p>"))
    runner = BacklinkRunner(client)

    result = await runner.ensure(
        page_handle=PAGE_HANDLE, page_url=PAGE_URL, backlink=CONFIG
    )

    assert result == "ADDED"
    assert client.calls == ["find", "update"]
    assert "<p>existing body</p>" in (client.updated_body or "")
    assert backlink_marker(PAGE_HANDLE) in (client.updated_body or "")


async def test_skips_when_marker_already_present():
    """重复运行不能追加两次。"""
    body = f"<p>existing</p>\n<!-- {backlink_marker(PAGE_HANDLE)} -->\n<p>...</p>"
    client = FakeClient(article=article_with(body))
    runner = BacklinkRunner(client)

    result = await runner.ensure(
        page_handle=PAGE_HANDLE, page_url=PAGE_URL, backlink=CONFIG
    )

    assert result == "ALREADY PRESENT"
    assert client.calls == ["find"]


async def test_skips_when_page_url_already_linked():
    """就算没有 marker，正文里已经有这条页面 URL 也不重复加。"""
    client = FakeClient(article=article_with(f'<p>see <a href="{PAGE_URL}">it</a></p>'))
    runner = BacklinkRunner(client)

    result = await runner.ensure(
        page_handle=PAGE_HANDLE, page_url=PAGE_URL, backlink=CONFIG
    )

    assert result == "ALREADY PRESENT"
    assert client.calls == ["find"]


async def test_raises_when_article_missing():
    client = FakeClient(article=None)
    runner = BacklinkRunner(client)

    with pytest.raises(BacklinkError, match="找不到要挂反链的博客文章"):
        await runner.ensure(
            page_handle=PAGE_HANDLE, page_url=PAGE_URL, backlink=CONFIG
        )


async def test_ignores_article_from_another_blog():
    """同一 handle 但不在目标博客下，不算命中。"""
    client = FakeClient(article=article_with("<p>x</p>", blog_handle="support-tips"))
    runner = BacklinkRunner(client)

    with pytest.raises(BacklinkError, match="找不到"):
        await runner.ensure(
            page_handle=PAGE_HANDLE, page_url=PAGE_URL, backlink=CONFIG
        )


async def test_disabled_backlink_is_a_noop():
    client = FakeClient(article=article_with("<p>x</p>"))
    runner = BacklinkRunner(client)

    result = await runner.ensure(
        page_handle=PAGE_HANDLE,
        page_url=PAGE_URL,
        backlink=BacklinkConfig(enabled=False),
    )

    assert result is None
    assert client.calls == []


async def test_user_errors_are_surfaced():
    client = FakeClient(
        article=article_with("<p>x</p>"),
        user_errors=[{"field": ["body"], "message": "正文过长"}],
    )
    runner = BacklinkRunner(client)

    with pytest.raises(BacklinkError, match="正文过长"):
        await runner.ensure(
            page_handle=PAGE_HANDLE, page_url=PAGE_URL, backlink=CONFIG
        )
