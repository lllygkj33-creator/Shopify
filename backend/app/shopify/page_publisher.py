"""页面发布器（社区 / Discord / 用户故事 / VS / MakerWorld 等页面栏目）。

**移植来源**：`publish_community_pages.py`（社区文章的发布流程）。

## 与博客发布器的关键差异

| | 博客文章 | 页面 |
|---|---|---|
| mutation | `articleCreate` | `pageCreate` / `pageUpdate` |
| 已存在时 | 直接创建 | **按 handle 查，存在则 UPDATE + 重新排期** |
| 寻址 | `blogId` + `handle` | `handle`（**不带 `/pages/` 前缀**） |
| 模板 | 无 | `templateSuffix`（必须与栏目一致） |
| SEO | 6 个 metafield 一起随创建提交 | 2 个 SEO + 1 个来源，更新时要**单独 `metafieldsSet`** |
| 封面 | 随机分配 | 无（图片在正文里） |

## 从脚本原样保留的行为（不要"顺手优化"）

- `pageUpdate` **不可靠地替换 metafield**，所以更新后必须单独调 `metafieldsSet`
- 空 / 缺失的 `related_products` **故意跳过**，避免清掉已有的 product 列表 metafield
- 校验：正文**禁用 `<h1>`**（H1 由 `page.title` / Liquid 提供）、**必须含 `<h2>`**、
  每个 `<img>` 必须有非空 `alt` **和** `title`、每个 `<a>` 必须有非空 `title`
- `templateSuffix` 必须等于栏目要求的模板，不一致直接报错
- 写回校验：`title` / `handle` / `templateSuffix` 必须一致，
  且**返回的 publishedAt 与请求时间 UTC 必须完全相等**，`isPublished` 必须仍为 `False`
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .client import ShopifyError, ShopifyGraphQLClient, shopify_client

# 页面 URL 用的前台域名（与 Admin API 域名不同）
STORE_DOMAIN = "shop.zimaspace.com"

PAGE_FIELDS = """
  id
  title
  handle
  isPublished
  publishedAt
  templateSuffix
"""

PAGE_CREATE_MUTATION = f"""
mutation CreatePage($page: PageCreateInput!) {{
  pageCreate(page: $page) {{
    page {{ {PAGE_FIELDS} }}
    userErrors {{ field message code }}
  }}
}}
"""

PAGE_UPDATE_MUTATION = f"""
mutation UpdatePage($id: ID!, $page: PageUpdateInput!) {{
  pageUpdate(id: $id, page: $page) {{
    page {{ {PAGE_FIELDS} }}
    userErrors {{ field message code }}
  }}
}}
"""

METAFIELDS_SET_MUTATION = """
mutation SetPageMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key type value }
    userErrors { field message code }
  }
}
"""

FIND_PAGE_QUERY = """
query FindPage($query: String!) {
  pages(first: 10, query: $query) {
    nodes { id title handle isPublished templateSuffix }
  }
}
"""

SHOP_TIMEZONE_QUERY = """
query ShopTimezone {
  shop { ianaTimezone timezoneOffset timezoneOffsetMinutes }
}
"""

PAGE_HANDLE_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


class PagePublishError(RuntimeError):
    """页面发布失败（消息可直接展示给用户）。"""


# ---------------------------------------------------------------------------
# 栏目规格
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PageChannelSpec:
    """一个页面栏目的发布规格。

    这些规则**逐条对应各自的发布脚本**，所以栏目之间会不一样（例如社区只要求
    至少 1 个 H2，Discord 要求至少 4 个）。不要把规则写死在通用代码里。
    """

    template: str
    """要求的 templateSuffix（与 JSON 不一致时报错）。"""

    source_key: str
    """来源 metafield 的 key（namespace = custom）。"""

    source_fields: tuple[str, ...] = ()
    """来源对象里**必须存在**的字段。"""

    source_required_nonempty: tuple[str, ...] = ()
    """其中必须非空的字段（其余允许为空，如 Discord 的 invite_url）。"""

    source_field_prefixes: tuple[tuple[str, str], ...] = ()
    """字段 → 必需前缀，例如 url 必须 /t/ 开头。"""

    source_field_regexes: tuple[tuple[str, str], ...] = ()
    """字段 → 必须 fullmatch 的正则（Discord 的消息链接就是这种）。"""

    source_http_url_fields: tuple[str, ...] = ()
    """非空时必须是完整 http(s) URL 的字段。"""

    strip_hash_prefix: tuple[str, ...] = ()
    """需要去掉前导 `#` 的字段（Discord 的 channel_name）。"""

    h2_min: int = 1
    """正文至少需要多少个 <h2>。"""

    meta_title_max: int = 0
    """meta title 上限；0 表示不限制。"""

    meta_description_min: int = 0
    """meta description 下限；0 表示不限制（只有 Discord 脚本有区间要求）。"""

    meta_description_max: int = 0
    """meta description 上限；0 表示不限制。"""

    keep_source_extras: bool = False
    """是否保留来源对象里除必需字段外的其他键（Discord 脚本会保留）。"""

    verified: bool = False
    """规格是否已对照真实发布脚本核对过。未核对时只做宽松校验。"""


# Discord 消息链接：https://discord.com/channels/<guild>/<channel>/<message>
DISCORD_MESSAGE_URL_REGEX = (
    r"https://(?:www\.)?discord\.com/channels/\d+/\d+/\d+/?$"
)


PAGE_CHANNEL_SPECS: dict[str, PageChannelSpec] = {
    # ✅ 已对照 publish_community_pages.py 核对
    "community-post": PageChannelSpec(
        template="community_post",
        source_key="community_source",
        source_fields=(
            "title",
            "url",
            "excerpt",
            "author_name",
            "author_avatar_url",
            "author_profile_url",
        ),
        source_required_nonempty=("title", "url", "excerpt", "author_name"),
        source_field_prefixes=(
            ("url", "https://community.zimaspace.com/t/"),
            ("author_profile_url", "https://community.zimaspace.com/u/"),
        ),
        # 社区脚本只要求「至少一个 <h2>」，没有 meta 长度规则
        h2_min=1,
        verified=True,
    ),
    # ✅ 已对照 publish_discord_pages.py 核对
    #
    # 注意 Discord 比社区严得多：
    #   - H2 至少 **4** 个（社区只要 1 个）
    #   - meta_title ≤ 65
    #   - meta description 必须在 120~170 之间
    #   - url 必须是 Discord 消息链接（正则匹配，不是前缀）
    #   - 来源字段名不同：starter_name / starter_avatar_url / channel_name / invite_url
    #   - channel_name 要剥掉前导 '#'
    "discord": PageChannelSpec(
        template="discord-page",
        source_key="discord_source",
        source_fields=(
            "title",
            "url",
            "excerpt",
            "starter_name",
            "starter_avatar_url",
            "channel_name",
            "invite_url",
        ),
        source_required_nonempty=(
            "title",
            "url",
            "excerpt",
            "starter_name",
            "starter_avatar_url",
            "channel_name",
        ),
        source_field_regexes=(("url", DISCORD_MESSAGE_URL_REGEX),),
        source_http_url_fields=("url", "starter_avatar_url", "invite_url"),
        strip_hash_prefix=("channel_name",),
        # Discord 脚本保留来源对象里的额外键
        keep_source_extras=True,
        h2_min=4,
        meta_title_max=65,
        meta_description_min=120,
        meta_description_max=170,
        verified=True,
    ),
    # ⚠️ 以下 3 个规格来自 PRD §3.2，**尚未**用真实脚本核对：
    #    template 与来源键名按命名规律推断，来源字段不做强校验。
    #    拿到各自脚本后按上面两个栏目那样收紧。
    "user-story": PageChannelSpec(
        template="user-story",
        source_key="user_source",
    ),
    "vs": PageChannelSpec(
        template="nas-a-vs-b",
        source_key="vs_source",
    ),
    "makerworld": PageChannelSpec(
        template="makerworld-page",
        source_key="makerworld_source",
    ),
}


def get_page_spec(channel_id: str) -> PageChannelSpec | None:
    return PAGE_CHANNEL_SPECS.get(channel_id)


# ---------------------------------------------------------------------------
# 载荷
# ---------------------------------------------------------------------------


@dataclass
class PagePayload:
    channel_id: str
    title: str
    meta_title: str
    meta_description: str
    handle: str
    body_html: str
    template_suffix: str
    source: dict[str, str] = field(default_factory=dict)
    source_file: str = ""
    # 脚本解析了 published 但**没有**用进 create/update input；
    # 这里保留字段只是为了兼容 JSON，不参与请求构造。
    is_published_flag: bool = True


# ---------------------------------------------------------------------------
# 通用取值 / 校验（与脚本逐条对应）
# ---------------------------------------------------------------------------


def first_value(data: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    for key in keys:
        if key in data:
            value = data[key]
            if value is not None and value != "":
                return value
    return default


def require_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PagePublishError(f"{field_name} 必须是非空字符串")
    return value.strip()


def parse_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y", "published", "visible"}:
            return True
        if normalized in {"false", "0", "no", "n", "draft", "hidden"}:
            return False
    return default


def normalize_page_handle(value: Any) -> str:
    """把各种写法的页面 url 归一成 **不带 `/pages/` 前缀** 的 handle。

    接受：
        qwen3-8b-hardware-requirements
        /pages/qwen3-8b-hardware-requirements
        https://shop.zimaspace.com/pages/qwen3-8b-hardware-requirements
    返回：
        qwen3-8b-hardware-requirements

    注意：这与前端展示用的 `/pages/xxx` 路径不同——**API 只接受裸 handle**。
    """
    handle = str(value or "").strip()
    if not handle:
        raise PagePublishError("url / handle 不能为空")

    if handle.startswith(("http://", "https://")):
        from urllib.parse import urlparse

        handle = urlparse(handle).path

    handle = handle.split("?", 1)[0].split("#", 1)[0].strip("/")

    if handle.startswith("pages/"):
        handle = handle[len("pages/") :]

    handle = handle.strip("/")

    if not PAGE_HANDLE_PATTERN.fullmatch(handle):
        raise PagePublishError(
            "URL handle 只能包含小写字母、数字和连字符；" f"当前值：{handle!r}"
        )

    return handle


def full_page_url(handle: str) -> str:
    return f"https://{STORE_DOMAIN}/pages/{handle}"


def load_body_html(data: dict[str, Any], source_file: str) -> str:
    """正文：内联优先，其次外部文件（`html_file` / `body_file`）。"""
    inline = first_value(
        data, ["html", "html代码", "body", "body_html", "HTML", "content"]
    )
    if isinstance(inline, str) and inline.strip():
        return inline.strip()

    html_file = first_value(data, ["html_file", "body_file"])
    if html_file:
        html_path = Path(str(html_file))
        if not html_path.is_absolute():
            html_path = Path(source_file).parent / html_path
        if not html_path.exists():
            raise PagePublishError(f"找不到 HTML 文件：{html_path}")
        return html_path.read_text(encoding="utf-8-sig").strip()

    raise PagePublishError(
        "缺少正文 HTML。请在 JSON 里加 'html' / 'html代码'，或提供 'html_file'。"
    )


def load_source(data: dict[str, Any], spec: PageChannelSpec) -> dict[str, str]:
    """读取并归一化 `custom.<source_key>` 那个 JSON 对象。

    规则全部来自 spec（各栏目脚本的要求不同）。
    """
    source = first_value(data, [spec.source_key, f"custom.{spec.source_key}"])

    if isinstance(source, str):
        try:
            source = json.loads(source)
        except json.JSONDecodeError as error:
            raise PagePublishError(
                f"{spec.source_key} 是字符串但不是合法 JSON："
                f"第 {error.lineno} 行第 {error.colno} 列：{error.msg}"
            ) from error

    if not isinstance(source, dict):
        raise PagePublishError(f"{spec.source_key} 必须是 JSON 对象")

    # 规格未核对的栏目：原样透传字符串字段，不做强校验
    if not spec.source_fields:
        return {str(key): str(value).strip() for key, value in source.items()}

    for field_name in spec.source_fields:
        if field_name not in source:
            raise PagePublishError(f"{spec.source_key} 缺少必需字段：{field_name}")
        if not isinstance(source[field_name], str):
            raise PagePublishError(f"{spec.source_key}.{field_name} 必须是字符串")

    normalized: dict[str, str] = (
        {str(key): str(value).strip() for key, value in source.items()}
        if spec.keep_source_extras
        else {}
    )

    for field_name in spec.source_fields:
        normalized[field_name] = source[field_name].strip()

    # 需要剥掉前导 '#' 的字段（Discord 的 channel_name）
    for field_name in spec.strip_hash_prefix:
        normalized[field_name] = normalized[field_name].lstrip("#").strip()

    # 必须非空的字段
    for field_name in spec.source_required_nonempty:
        if not normalized.get(field_name):
            raise PagePublishError(f"{spec.source_key}.{field_name} 不能为空")

    # 字段 → 必需前缀
    for field_name, prefix in spec.source_field_prefixes:
        value = normalized.get(field_name, "")
        if value and not value.startswith(prefix):
            raise PagePublishError(
                f"{spec.source_key}.{field_name} 必须以 {prefix} 开头"
            )

    # 字段 → 必须 fullmatch 的正则
    for field_name, pattern in spec.source_field_regexes:
        value = normalized.get(field_name, "")
        if value and not re.fullmatch(pattern, value, flags=re.IGNORECASE):
            raise PagePublishError(
                f"{spec.source_key}.{field_name} 格式不正确：{value!r}"
            )

    # 非空时必须是完整 http(s) URL
    for field_name in spec.source_http_url_fields:
        value = normalized.get(field_name, "")
        if value and not _is_complete_http_url(value):
            raise PagePublishError(
                f"{spec.source_key}.{field_name} 必须是完整的 http(s) 链接"
            )

    return normalized


def _is_complete_http_url(value: str) -> bool:
    from urllib.parse import urlparse

    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def validate_page_payload(payload: PagePayload, spec: PageChannelSpec) -> list[str]:
    """与各栏目脚本 `validate_payload()` 对应的硬校验。

    注意规则**按栏目不同**：社区只要求 ≥1 个 H2，Discord 要求 ≥4 个，
    且 Discord 还有 meta 长度区间。
    """
    errors: list[str] = []
    html_lower = payload.body_html.lower()

    if "<h1" in html_lower:
        errors.append("正文包含 <h1>；H1 应由 page.title / Liquid 输出")

    h2_count = len(re.findall(r"<h2\b", payload.body_html, re.IGNORECASE))
    if h2_count < spec.h2_min:
        errors.append(
            f"正文必须至少包含 {spec.h2_min} 个 <h2> 章节；当前 {h2_count} 个"
        )

    if payload.template_suffix != spec.template:
        errors.append(
            f"template 必须是 {spec.template!r}；当前为 {payload.template_suffix!r}"
        )

    if spec.meta_title_max and len(payload.meta_title) > spec.meta_title_max:
        errors.append(
            f"meta_title 应在 {spec.meta_title_max} 个字符以内；当前 {len(payload.meta_title)}"
        )

    description_length = len(payload.meta_description)
    if spec.meta_description_min or spec.meta_description_max:
        if spec.meta_description_min and description_length < spec.meta_description_min:
            errors.append(
                f"meta description 应在 {spec.meta_description_min}"
                f"~{spec.meta_description_max} 字符之间；当前 {description_length}"
            )
        elif spec.meta_description_max and description_length > spec.meta_description_max:
            errors.append(
                f"meta description 应在 {spec.meta_description_min}"
                f"~{spec.meta_description_max} 字符之间；当前 {description_length}"
            )

    for index, image_tag in enumerate(
        re.findall(r"<img\b[^>]*>", payload.body_html, re.IGNORECASE), start=1
    ):
        if not re.search(r'\balt\s*=\s*["\'][^"\']+["\']', image_tag, re.IGNORECASE):
            errors.append(f"第 {index} 张图片缺少非空 alt 属性")
        if not re.search(r'\btitle\s*=\s*["\'][^"\']+["\']', image_tag, re.IGNORECASE):
            errors.append(f"第 {index} 张图片缺少非空 title 属性")

    for index, anchor_tag in enumerate(
        re.findall(r"<a\b[^>]*>", payload.body_html, re.IGNORECASE), start=1
    ):
        if not re.search(r'\btitle\s*=\s*["\'][^"\']+["\']', anchor_tag, re.IGNORECASE):
            errors.append(f"第 {index} 个链接缺少非空 title 属性")

    return errors


def build_page_payload(
    raw: dict[str, Any],
    *,
    channel_id: str,
    spec: PageChannelSpec,
    source_file: str = "",
) -> PagePayload:
    """从 JSON 对象构造页面载荷（字段别名与脚本一致）。"""
    if not isinstance(raw, dict):
        raise PagePublishError("顶层 JSON 必须是对象")

    title = require_text(
        first_value(raw, ["title", "page_title", "page title", "blog title"]),
        "title",
    )

    meta_title = require_text(
        first_value(raw, ["meta_title", "meta title", "seo_title", "seo title"]),
        "meta_title",
    )

    # 注意：脚本里 meta description 的首选键名是 'td'（历史遗留），保留以兼容既有 JSON
    meta_description = require_text(
        first_value(
            raw,
            [
                "td",
                "meta_description",
                "meta description",
                "seo_description",
                "seo description",
            ],
        ),
        "td",
    )

    handle = normalize_page_handle(
        first_value(raw, ["url", "handle", "page_url", "page url"])
    )

    template_suffix = (
        str(
            first_value(
                raw, ["template_suffix", "template", "templateSuffix"], spec.template
            )
        ).strip()
        or spec.template
    )

    return PagePayload(
        channel_id=channel_id,
        title=title,
        meta_title=meta_title,
        meta_description=meta_description,
        handle=handle,
        body_html=load_body_html(raw, source_file),
        template_suffix=template_suffix,
        source=load_source(raw, spec),
        source_file=source_file,
        is_published_flag=parse_bool(
            first_value(raw, ["published", "is_published", "isPublished"], True),
            default=True,
        ),
    )


# ---------------------------------------------------------------------------
# metafield 构造
# ---------------------------------------------------------------------------


def seo_metafields(meta_title: str, meta_description: str) -> list[dict[str, str]]:
    return [
        {
            "namespace": "global",
            "key": "title_tag",
            "type": "single_line_text_field",
            "value": meta_title,
        },
        {
            "namespace": "global",
            "key": "description_tag",
            "type": "multi_line_text_field",
            "value": meta_description,
        },
    ]


def page_metafields(payload: PagePayload, spec: PageChannelSpec) -> list[dict[str, str]]:
    """SEO 两个 + 来源 JSON 一个。

    刻意**不包含** `custom.related_products`：脚本里有这样一段注释——
    空或缺失的 related_products 要忽略，否则会把已有商品列表 metafield 清空。
    """
    return [
        *seo_metafields(payload.meta_title, payload.meta_description),
        {
            "namespace": "custom",
            "key": spec.source_key,
            "type": "json",
            "value": json.dumps(
                payload.source, ensure_ascii=False, separators=(",", ":")
            ),
        },
    ]


# 发布方式。页面与博客不同：页面靠 PageCreateInput 的 isPublished / publishDate 组合控制。
#
# 依据 **API schema 实测**（PageCreateInput，2026-04）：
#   isPublished  "Whether or not the page should be visible.
#                 Defaults to `true` if no publish date is specified."
#
# 由此推出三种组合（这是从 schema 描述推导的，不是猜的）：
#   schedule → publishDate = 未来时间，**不传 isPublished**（有 publishDate 时默认 false，
#              于是页面保持"已排期未上线"；脚本也是这么做的并校验 isPublished 为 False）
#   now      → isPublished = true 且**不带 publishDate**（立即可见）
#   draft    → isPublished = false 且**不带 publishDate**（必须显式传 false！）
#
# ⚠️ 关键：草稿**必须显式传 isPublished=false**。若省略，schema 会默认成 true，
#    页面会立刻公开——这是最容易踩的坑。
PUBLISH_MODE_NOW = "now"
PUBLISH_MODE_SCHEDULE = "schedule"
PUBLISH_MODE_DRAFT = "draft"
VALID_PUBLISH_MODES = (PUBLISH_MODE_NOW, PUBLISH_MODE_SCHEDULE, PUBLISH_MODE_DRAFT)


def build_page_input(
    payload: PagePayload,
    spec: PageChannelSpec,
    *,
    mode: str,
    publish_at: datetime | None,
    with_metafields: bool,
) -> dict[str, Any]:
    """按发布方式构造 pageCreate / pageUpdate 的 input。"""
    if mode not in VALID_PUBLISH_MODES:
        raise PagePublishError(f"未知的发布方式：{mode}")

    page_input: dict[str, Any] = {
        "title": payload.title,
        "handle": payload.handle,
        "body": payload.body_html,
        "templateSuffix": payload.template_suffix,
    }

    if mode == PUBLISH_MODE_SCHEDULE:
        if publish_at is None:
            raise PagePublishError("定时发布缺少发布时间")
        page_input["publishDate"] = publish_at.isoformat(timespec="seconds")
        # 刻意不传 isPublished：由 publishDate 推导（未来时间 → 不立即可见）

    elif mode == PUBLISH_MODE_NOW:
        page_input["isPublished"] = True

    else:  # draft
        page_input["isPublished"] = False

    if with_metafields:
        page_input["metafields"] = page_metafields(payload, spec)

    return page_input


# ---------------------------------------------------------------------------
# 发布器
# ---------------------------------------------------------------------------


class PagePublisher:
    """页面发布器：按 handle 判断创建 / 更新，并做写回校验。"""

    def __init__(self, client: ShopifyGraphQLClient | None = None) -> None:
        self._client = client or shopify_client

    async def get_shop_timezone(self) -> tuple[str, str, int]:
        """店铺时区。

        脚本用它把"日期"换算成 23:59 的绝对时间。平台里时间由用户在
        UI 直接指定，所以这个只用于提示/校验，不参与换算。
        """
        data = await self._client.execute(SHOP_TIMEZONE_QUERY)
        shop = data.get("shop") or {}

        iana = str(shop.get("ianaTimezone") or "").strip()
        offset = str(shop.get("timezoneOffset") or "").strip()
        offset_minutes = shop.get("timezoneOffsetMinutes")

        if not iana:
            raise PagePublishError("Shopify 没有返回 shop.ianaTimezone")
        if not isinstance(offset_minutes, int):
            raise PagePublishError("Shopify 没有返回 shop.timezoneOffsetMinutes")

        return iana, offset, offset_minutes

    async def find_page(self, handle: str) -> dict[str, Any] | None:
        data = await self._client.execute(FIND_PAGE_QUERY, {"query": f"handle:{handle}"})
        nodes = (data.get("pages") or {}).get("nodes") or []
        return next((page for page in nodes if page.get("handle") == handle), None)

    async def create_page(
        self,
        payload: PagePayload,
        spec: PageChannelSpec,
        *,
        mode: str,
        publish_at: datetime | None,
    ) -> dict[str, Any]:
        page_input = build_page_input(
            payload,
            spec,
            mode=mode,
            publish_at=publish_at,
            # 创建时可以带 metafields
            with_metafields=True,
        )

        data = await self._client.execute(PAGE_CREATE_MUTATION, {"page": page_input})
        result = data.get("pageCreate") or {}

        if result.get("userErrors"):
            raise PagePublishError(
                "pageCreate 失败：" + json.dumps(result["userErrors"], ensure_ascii=False)
            )
        if not result.get("page"):
            raise PagePublishError("pageCreate 没有返回 page")

        return result["page"]

    async def update_page(
        self,
        page_id: str,
        payload: PagePayload,
        spec: PageChannelSpec,
        *,
        mode: str,
        publish_at: datetime | None,
    ) -> dict[str, Any]:
        # 注意：更新**不带** metafields——虽然 schema 上 PageUpdateInput 有 metafields 字段，
        # 但实测它**不可靠地替换**metafield，所以随后单独调用 set_page_metafields()
        page_input = build_page_input(
            payload,
            spec,
            mode=mode,
            publish_at=publish_at,
            with_metafields=False,
        )

        data = await self._client.execute(
            PAGE_UPDATE_MUTATION, {"id": page_id, "page": page_input}
        )
        result = data.get("pageUpdate") or {}

        if result.get("userErrors"):
            raise PagePublishError(
                "pageUpdate 失败：" + json.dumps(result["userErrors"], ensure_ascii=False)
            )
        if not result.get("page"):
            raise PagePublishError("pageUpdate 没有返回 page")

        return result["page"]

    async def set_page_metafields(
        self, page_id: str, payload: PagePayload, spec: PageChannelSpec
    ) -> None:
        inputs = [
            {"ownerId": page_id, **metafield}
            for metafield in page_metafields(payload, spec)
        ]

        data = await self._client.execute(
            METAFIELDS_SET_MUTATION, {"metafields": inputs}
        )
        result = data.get("metafieldsSet") or {}

        if result.get("userErrors"):
            raise PagePublishError(
                "metafieldsSet 失败："
                + json.dumps(result["userErrors"], ensure_ascii=False)
            )

    def verify_page(
        self,
        page: dict[str, Any],
        payload: PagePayload,
        *,
        mode: str,
        publish_at: datetime | None,
    ) -> None:
        """写回校验。

        - `schedule`：脚本的原行为——publishedAt 与请求时间 **UTC 必须完全相等**，
          且 isPublished 必须仍为 False（否则说明它已经上线了）
        - `now`：必须 isPublished 为 True，且 Shopify 给出了 publishedAt
        - `draft`：必须 isPublished 为 False，且**没有** publishedAt
        """
        if page.get("title") != payload.title:
            raise PagePublishError("写回校验失败：title 不一致")

        if page.get("handle") != payload.handle:
            raise PagePublishError("写回校验失败：handle 不一致")

        if page.get("templateSuffix") != payload.template_suffix:
            raise PagePublishError("写回校验失败：templateSuffix 不一致")

        if mode == PUBLISH_MODE_DRAFT:
            if page.get("isPublished") is not False:
                raise PagePublishError(
                    "写回校验失败：草稿页面却是可见状态"
                    "（isPublished=false 没生效，页面可能已公开）"
                )
            if page.get("publishedAt"):
                raise PagePublishError(
                    "写回校验失败：草稿页面不应有 publishedAt"
                )
            return

        if mode == PUBLISH_MODE_NOW:
            if page.get("isPublished") is not True:
                raise PagePublishError(
                    "写回校验失败：要求立即发布，但页面仍处于未发布状态"
                )
            if not page.get("publishedAt"):
                raise PagePublishError(
                    "写回校验失败：立即发布后 Shopify 没有返回 publishedAt"
                )
            return

        # schedule
        if publish_at is None:
            raise PagePublishError("写回校验失败：定时发布缺少发布时间")

        returned = page.get("publishedAt")
        if not returned:
            raise PagePublishError("写回校验失败：Shopify 没有返回 publishedAt")

        try:
            normalized = str(returned)
            if normalized.endswith("Z"):
                normalized = normalized[:-1] + "+00:00"
            returned_dt = datetime.fromisoformat(normalized)
        except ValueError as error:
            raise PagePublishError(
                f"写回校验失败：publishedAt 不是合法时间 {returned!r}"
            ) from error

        if returned_dt.astimezone(timezone.utc) != publish_at.astimezone(timezone.utc):
            raise PagePublishError(
                "写回校验失败：排期时间不一致；"
                f"请求 {publish_at.isoformat(timespec='seconds')}，"
                f"Shopify 返回 {returned}"
            )

        if page.get("isPublished") is not False:
            raise PagePublishError(
                "写回校验失败：页面已经可见，而不是保持排期状态"
            )

    async def publish(
        self,
        payload: PagePayload,
        spec: PageChannelSpec,
        *,
        mode: str,
        publish_at: datetime | None = None,
    ) -> tuple[dict[str, Any], str]:
        """按 handle 判断创建或更新。返回 (page, 'created'|'updated')。"""
        existing = await self.find_page(payload.handle)

        if existing:
            page = await self.update_page(
                existing["id"], payload, spec, mode=mode, publish_at=publish_at
            )
            # pageUpdate 不可靠地替换 metafield，所以单独再设一次
            await self.set_page_metafields(page["id"], payload, spec)
            self.verify_page(page, payload, mode=mode, publish_at=publish_at)
            return page, "updated"

        page = await self.create_page(
            payload, spec, mode=mode, publish_at=publish_at
        )
        self.verify_page(page, payload, mode=mode, publish_at=publish_at)
        return page, "created"
