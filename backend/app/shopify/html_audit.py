"""HTML 链接审计（所有栏目共用的「外链规则」）。

## 为什么单独一个模块

链接规则要在**两处**使用：页面发布器（`page_publisher`）和博客发布器（`publisher`）。
放在一个没有依赖的小模块里，两边都引用同一份实现，避免两套规则各自漂移。

## 站内 / 自家 / 外部的划分

| 类别 | 判定 | 要求 |
|---|---|---|
| 相对路径 | `/...`、`#...` | 只要求非空 `title` |
| 站内 | host == 店铺域名（`shop.zimaspace.com`） | 只要求非空 `title` |
| 自家域名 | host ∈ `*.zimaspace.com` | 只要求非空 `title`（不需要 nofollow） |
| **外部/第三方** | 其余 http(s) 链接 | 必须有 `target="_blank"` + `rel` 含 `noopener`、`noreferrer`、`nofollow` |

注意「自家域名」与「外部」的区分：`www.zimaspace.com/docs/...` 这类自家文档站
按站内处理（不强制新标签页），只有真正跳出 zimaspace 站群的链接才加 `nofollow`。

MakerWorld / VS 有各自更严格的规则（例如「站内链接不得开新标签页」），
那部分由各自的 spec 控制，不走这里。
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Iterable
from ..site_config import site

# 自家域名（豁免 nofollow，且不强制新标签页）
DEFAULT_FIRST_PARTY_SUFFIXES = site.first_party_suffixes


class _AnchorParser(HTMLParser):
    """收集所有 <a> 标签的属性和文本。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: list[dict[str, object]] = []
        self._stack: list[dict[str, object]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attr_map = {key.lower(): (value or "") for key, value in attrs}
        self._stack.append({"attrs": attr_map, "text_parts": []})

    def handle_data(self, data: str) -> None:
        if self._stack:
            parts = self._stack[-1]["text_parts"]
            assert isinstance(parts, list)
            parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or not self._stack:
            return
        item = self._stack.pop()
        parts = item["text_parts"]
        assert isinstance(parts, list)
        item["text"] = " ".join(part.strip() for part in parts if part.strip()).strip()
        self.anchors.append(item)


def parse_anchors(html: str) -> list[dict[str, object]]:
    parser = _AnchorParser()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:
        # HTML 本身坏掉时不在这里报错，交给别的校验
        return []
    return parser.anchors


def rel_tokens(value: str) -> set[str]:
    return {token.strip().lower() for token in re.split(r"\s+", value or "") if token.strip()}


def is_first_party(host: str, suffixes: Iterable[str]) -> bool:
    host = (host or "").lower().strip(".")
    return any(host == suffix or host.endswith("." + suffix) for suffix in suffixes)


def is_internal(host: str, shop_domain: str, first_party_suffixes: Iterable[str]) -> bool:
    """站内或自家域名 → 不强制新标签页。"""
    host = (host or "").lower()
    return host == (shop_domain or "").lower() or is_first_party(host, first_party_suffixes)


def audit_external_links(
    html: str,
    *,
    shop_domain: str,
    first_party_suffixes: Iterable[str] = DEFAULT_FIRST_PARTY_SUFFIXES,
) -> list[str]:
    """外链规则审计。返回错误消息列表（空表示通过）。

    规则：
      1. 每个 `<a>` 必须有 `href` 和非空 `title`
      2. 外部/第三方链接必须有 `target="_blank"`
      3. 外部/第三方链接的 `rel` 必须含 `noopener`、`noreferrer`
      4. 第三方（非自家域名）还必须含 `nofollow`

    站内与自家域名只要求第 1 条。
    """
    errors: list[str] = []
    from urllib.parse import urlparse

    for index, item in enumerate(parse_anchors(html), start=1):
        attrs = item["attrs"]
        assert isinstance(attrs, dict)

        href = str(attrs.get("href", "")).strip()
        title = str(attrs.get("title", "")).strip()
        anchor_text = str(item.get("text", "")).strip()

        if not href:
            errors.append(f"第 {index} 个链接缺少 href")
            continue

        if not title:
            errors.append(f"第 {index} 个链接缺少非空 title 属性")

        # 相对路径 / 页内锚点
        if href.startswith(("/", "#")):
            continue

        if not href.startswith(("http://", "https://")):
            continue

        parsed = urlparse(href)
        host = (parsed.hostname or "").lower()

        if is_internal(host, shop_domain, first_party_suffixes):
            continue

        label = anchor_text or href
        target = str(attrs.get("target", "")).lower()
        rel = rel_tokens(str(attrs.get("rel", "")))

        if target != "_blank":
            errors.append(
                f'第 {index} 个链接是外部链接，必须使用 target="_blank"：{label}'
            )

        missing = {"noopener", "noreferrer"} - rel
        if missing:
            errors.append(
                f"第 {index} 个外部链接的 rel 缺少 {sorted(missing)}：{label}"
            )

        if "nofollow" not in rel:
            errors.append(f"第 {index} 个第三方链接必须包含 nofollow：{label}")

    return errors


__all__ = [
    "DEFAULT_FIRST_PARTY_SUFFIXES",
    "audit_external_links",
    "is_first_party",
    "is_internal",
    "parse_anchors",
    "rel_tokens",
]
