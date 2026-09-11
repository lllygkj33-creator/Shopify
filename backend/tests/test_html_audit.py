"""外链规则测试（所有栏目共用）。

规则：所有链接要有非空 title；第三方外链要 target=_blank + rel 含
noopener / noreferrer / nofollow；站内与自家域名只要求 title（域名来自站点配置）。
"""

from __future__ import annotations

from app.site_config import site

FIRST_PARTY = site.first_party_suffixes[0]
from app.shopify.html_audit import audit_external_links, is_first_party, is_internal

SHOP = site.storefront_domain


def audit(html: str) -> list[str]:
    return audit_external_links(html, shop_domain=SHOP)


def link(href: str, *, title: str = "Some link text", target: str = "", rel: str = "") -> str:
    parts = [f'href="{href}"']
    if title:
        parts.append(f'title="{title}"')
    if target:
        parts.append(f'target="{target}"')
    if rel:
        parts.append(f'rel="{rel}"')
    return f"<p><a {' '.join(parts)}>anchor text here</a></p>"


SAFE_EXTERNAL = 'target="_blank" rel="nofollow noopener noreferrer"'


# ---------------------------------------------------------------------------
# 通过的情况
# ---------------------------------------------------------------------------


def test_empty_html_is_fine():
    assert audit("") == []


def test_no_links_is_fine():
    assert audit("<p>No links at all.</p>") == []


def test_relative_link_only_needs_title():
    assert audit(link("/pages/some-page")) == []
    assert audit(link("#section")) == []


def test_shop_link_only_needs_title():
    """站内链接不强制新标签页，也不要求 nofollow。"""
    assert audit(link(f"https://{SHOP}/pages/some-page")) == []
    assert audit(link(f"https://{SHOP}/pages/x", target="_blank", rel="noopener noreferrer")) == []


def test_first_party_docs_link_only_needs_title():
    """自家域名按站内处理，不强制 _blank（域名来自站点配置）。"""
    assert audit(link(f"https://www.{FIRST_PARTY}/docs/zimaos/features")) == []
    assert audit(link(f"https://{FIRST_PARTY}/docs/x")) == []


def test_compliant_third_party_link_passes():
    assert audit(
        link(
            "https://hub.docker.com/_/mysql",
            target="_blank",
            rel="nofollow noopener noreferrer",
        )
    ) == []


def test_rel_token_order_does_not_matter():
    assert audit(
        link("https://example.com/x", target="_blank", rel="noreferrer nofollow noopener")
    ) == []


# ---------------------------------------------------------------------------
# 拦截的情况
# ---------------------------------------------------------------------------


def test_missing_title_is_flagged():
    errors = audit(link("https://example.com/x", title="", target="_blank", rel="nofollow noopener noreferrer"))
    assert any("title" in error for error in errors)


def test_missing_href_is_flagged():
    errors = audit('<p><a title="t">anchor</a></p>')
    assert any("href" in error for error in errors)


def test_third_party_without_target_blank_is_flagged():
    errors = audit(link("https://example.com/x", rel="nofollow noopener noreferrer"))
    assert any('target="_blank"' in error for error in errors)


def test_third_party_without_rel_is_flagged():
    errors = audit(link("https://example.com/x", target="_blank"))
    assert any("noopener" in error for error in errors)
    assert any("noreferrer" in error for error in errors)
    assert any("nofollow" in error for error in errors)


def test_third_party_missing_only_nofollow_is_flagged():
    errors = audit(link("https://example.com/x", target="_blank", rel="noopener noreferrer"))
    assert len(errors) == 1
    assert "nofollow" in errors[0]


def test_www_first_party_link_is_not_third_party():
    """自家域名不该被要求 nofollow。"""
    assert audit(link(f"https://www.{FIRST_PARTY}/docs/x", target="_blank", rel="noopener noreferrer")) == []


def test_multiple_links_report_by_index():
    html = (
        link("https://a.example.com/x")
        + link("https://b.example.com/y")
    )
    errors = audit(html)
    assert any("第 1 个" in error for error in errors)
    assert any("第 2 个" in error for error in errors)


# ---------------------------------------------------------------------------
# 辅助判定
# ---------------------------------------------------------------------------


def test_is_first_party():
    assert is_first_party("zimaspace.com", ("zimaspace.com",)) is True
    assert is_first_party("www.zimaspace.com", ("zimaspace.com",)) is True
    assert is_first_party("shop.zimaspace.com", ("zimaspace.com",)) is True
    assert is_first_party("notzimaspace.com", ("zimaspace.com",)) is False
    assert is_first_party("example.com", ("zimaspace.com",)) is False


def test_is_internal_covers_shop_and_first_party():
    assert is_internal("shop.zimaspace.com", SHOP, ("zimaspace.com",)) is True
    assert is_internal("www.zimaspace.com", SHOP, ("zimaspace.com",)) is True
    assert is_internal("example.com", SHOP, ("zimaspace.com",)) is False
