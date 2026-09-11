"""VS 对比页的资源注入（来自 `publish_vs_pages.py`）。

## 它做什么

VS 对比页正文里的 `<!-- COMPARE:RESOURCES --> … <!-- /COMPARE:RESOURCES -->`
是一个占位区块。发布器会：

1. 从**标题**里识别涉及哪些 Zima 产品（ZimaCube 2 / ZimaBoard 2 / ZimaBlade）
2. 按分配规则从维护好的资源库里抽 **3 个 YouTube 视频 + 3 篇博客**
3. 生成统一的卡片 HTML，替换掉标记之间的内容

分配规则：

    识别到 1 个产品 → 该产品 3 个
    识别到 2 个产品 → 第一个 2 个 + 第二个 1 个
    识别到 3 个产品 → 各 1 个

YouTube 与博客各自**独立随机**。

## 博客封面

封面不是写死的，而是**实时抓取**每篇博客当前的 `og:image`。
这样才能跟上文章换封面的情况。代价是发布时会有网络请求，
所以 `fetch_covers=False` 时用占位 URL 走结构校验（上传阶段），
真正的抓取只在发布时做。
"""

from __future__ import annotations

import html as html_lib
import random
import re
from html.parser import HTMLParser
from typing import Any, Awaitable, Callable, Iterable

import httpx

# ---------------------------------------------------------------------------
# 产品识别
# ---------------------------------------------------------------------------

PRODUCT_ALIASES: dict[str, tuple[str, ...]] = {
    "zimacube-2": ("zimacube 2", "zimacube2"),
    "zimaboard-2": ("zimaboard 2", "zimaboard2"),
    "zimablade": ("zimablade", "zima blade"),
}

PRODUCT_LABELS: dict[str, str] = {
    "zimacube-2": "ZimaCube 2",
    "zimaboard-2": "ZimaBoard 2",
    "zimablade": "ZimaBlade",
}

# ---------------------------------------------------------------------------
# 维护中的资源库（与脚本保持一致）
# ---------------------------------------------------------------------------

PRODUCT_RESOURCE_LIBRARY: dict[str, dict[str, list[dict[str, str]]]] = {
    "zimacube-2": {
        "youtube": [
            {
                "title": "ZimaCube 2 First Look - The Value Is Insane",
                "url": "https://www.youtube.com/watch?v=3lpoIns7WUE",
                "video_id": "3lpoIns7WUE",
                "creator": "Learn To HomeLab",
            },
            {
                "title": "This One Device Replaced My Entire Cloud (And Added AI)",
                "url": "https://www.youtube.com/watch?v=p0Ve70od8pw",
                "video_id": "p0Ve70od8pw",
                "creator": "Alpha Nerd Tech",
            },
            {
                "title": "【未来】NASにAIを入れたら“脳”になったwww",
                "url": "https://www.youtube.com/watch?v=5QV-oxdh6rc",
                "video_id": "5QV-oxdh6rc",
                "creator": "野市 零 / Zero Noichi",
            },
        ],
        "blog": [
            {
                "title": "ZimaCube 2 First Look — The Value Is Insane for a 6-Bay NAS",
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/zimacube-2-standard-nas-review",
                "creator": "Learn To HomeLab",
            },
            {
                "title": "Build Your Own Cloud with ZimaCube 2",
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/zimacube-2-self-hosting-powerhouse",
                "creator": "Alpha Nerd Tech",
            },
            {
                "title": "Surprising Thing ZimaCube 2’s AI NAS Can Really Do",
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/zimacube-2-ai-nas-workflow",
                "creator": "Zero Noichi",
            },
            {
                "title": (
                    "Local AI on the ZimaCube 2 — PCIe Expansion, Ollama, "
                    "and Future-Proofing Your Homelab"
                ),
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/zimacube-2-local-ai-homelab-review",
                "creator": "Michael Luckenbill",
            },
        ],
    },
    "zimaboard-2": {
        "youtube": [
            {
                "title": "ZimaBoard 2 Review - THE ULTIMATE HOME SERVER",
                "url": "https://www.youtube.com/watch?v=w_aARXB7K28",
                "video_id": "w_aARXB7K28",
                "creator": "TechteamGB",
            },
            {
                "title": (
                    "The Zimaboard 2 1664 hardware review. "
                    "Who is this board well-suited for?"
                ),
                "url": "https://www.youtube.com/watch?v=eTalCoGcWUQ",
                "video_id": "eTalCoGcWUQ",
                "creator": "Raspberry Pi Cloud",
            },
            {
                "title": (
                    "ON TEST ZIMA OS ! L’INTERFACE QUI ACCOMPAGNE VOTRE "
                    "ZIMABOARD PARTOUT DANS LE MONDE ! ✅"
                ),
                "url": "https://www.youtube.com/watch?v=ekJISMRrut4",
                "video_id": "ekJISMRrut4",
                "creator": "YOTECH",
            },
            {
                "title": "Tiny Server That Can Also Game",
                "url": "https://www.youtube.com/watch?v=u5G84ExpQZc",
                "video_id": "u5G84ExpQZc",
                "creator": "schvabek",
            },
            {
                "title": "This Tiny Board Runs My Entire Home Network",
                "url": "https://www.youtube.com/watch?v=v9V6ZgRVY6s",
                "video_id": "v9V6ZgRVY6s",
                "creator": "Hobby Support International",
            },
        ],
        "blog": [
            {
                "title": "How YOTECH Evaluates ZimaBoard 2 as a Compact Home Server",
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/yotech-zimaboard-2-home-server-review",
                "creator": "YOTECH",
            },
            {
                "title": (
                    "How schvabek Turns ZimaBoard 2 Into a Tiny Server "
                    "That Can Also Game"
                ),
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/schvabek-zimaboard-2-tiny-gaming-server",
                "creator": "schvabek",
            },
            {
                "title": "1 Tiny Board, Endless Power: Why the ZimaBoard 2 1664 Shocked Us",
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/home-lab-server-zimaboard-review",
                "creator": "Tech with Gerard",
            },
            {
                "title": "Can ZimaBoard 2 Run a Local AI Assistant?",
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/zimaboard-2-local-ai-assistant",
                "creator": "Core Works Lab",
            },
            {
                "title": "How Jake Simmons Explores the Possibilities of ZimaBoard 2",
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/jake-simmons-explores-zimaboard-2",
                "creator": "Jake Simmons",
            },
            {
                "title": "How Mart Tests ZimaBoard 2 as a Compact Gaming PC",
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/mart-tests-gaming-on-zimaboard-2",
                "creator": "Mart",
            },
        ],
    },
    "zimablade": {
        "youtube": [
            {
                "title": (
                    "Setting Up My Own Home Server! ZimaBlade 7700 - "
                    "Running Windows, Linux"
                ),
                "url": "https://www.youtube.com/watch?v=YAtmQnVLcuA",
                "video_id": "YAtmQnVLcuA",
                "creator": "Adi 4 u",
            },
            {
                "title": (
                    "Tiny NAS! ZimaBlade NAS Kit Review - Jellyfin Install, "
                    "Linux/CasaOS, & 2 NAS HDDs"
                ),
                "url": "https://www.youtube.com/watch?v=2eP0ff2nmIM",
                "video_id": "2eP0ff2nmIM",
                "creator": "Tek Syndicate",
            },
            {
                "title": "BEST Budget NAS? ZimaBlade Review",
                "url": "https://www.youtube.com/watch?v=ps-NGEe55NM",
                "video_id": "ps-NGEe55NM",
                "creator": "Michael Leen",
            },
        ],
        "blog": [
            {
                "title": (
                    "How SjslTech Unboxes and Prepares the ZimaBlade 7700 Mini Server"
                ),
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/sjsltech-zimablade-7700-unboxing",
                "creator": "SjslTech",
            },
            {
                "title": (
                    "From Sparcstation to ZimaBlade: A 57-Year-Old Geek’s "
                    "Self-Hosting Journey"
                ),
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/zimablade-backup-server-build",
                "creator": "Julien",
            },
            {
                "title": "Zima Member Day: What’s in Your Stack?",
                "url": "https://shop.zimaspace.com/blogs/zima-campaign-hub/zima-member-day-sept-2025-whats-in-your-stack",
                "creator": "Zima Community",
            },
        ],
    },
}

RESOURCES_OPEN_MARKER = "<!-- COMPARE:RESOURCES -->"
RESOURCES_CLOSE_MARKER = "<!-- /COMPARE:RESOURCES -->"

# 结构校验用的占位封面（真正发布时才去抓 og:image）。
#
# 注意 URL 里不能出现 VS 校验禁止的占位串（PLACEHOLDER / TODO 等），
# 否则结构校验会把它当成「未替换的占位串」而误报。
PENDING_COVER = "https://shop.zimaspace.com/cdn/cover-image-pending.png"

_rng = random.SystemRandom()


class ResourceInjectionError(RuntimeError):
    """资源注入失败（消息可直接展示）。"""


# ---------------------------------------------------------------------------
# 产品识别与分配
# ---------------------------------------------------------------------------


def detect_zima_products(title: str, body_html: str = "") -> list[str]:
    """从标题（找不到再看正文）里识别涉及的产品，按出现顺序返回。"""
    title_lower = (title or "").lower()
    found: list[tuple[int, str]] = []

    for product_key, aliases in PRODUCT_ALIASES.items():
        positions = [
            title_lower.find(alias) for alias in aliases if title_lower.find(alias) >= 0
        ]
        if positions:
            found.append((min(positions), product_key))

    if found:
        found.sort(key=lambda item: item[0])
        return [key for _, key in found]

    body_lower = (body_html or "").lower()
    return [
        product_key
        for product_key, aliases in PRODUCT_ALIASES.items()
        if any(alias in body_lower for alias in aliases)
    ]


def resource_allocation(product_keys: Iterable[str]) -> dict[str, int]:
    """1 个产品取 3 个；2 个取 2+1；3 个取 1+1+1。"""
    unique_keys: list[str] = []
    for key in product_keys:
        if key not in unique_keys:
            unique_keys.append(key)

    if not unique_keys:
        raise ResourceInjectionError(
            "无法从标题里识别出 ZimaCube 2 / ZimaBoard 2 / ZimaBlade，"
            "无法选择配套资源"
        )
    if len(unique_keys) == 1:
        return {unique_keys[0]: 3}
    if len(unique_keys) == 2:
        return {unique_keys[0]: 2, unique_keys[1]: 1}
    return {unique_keys[0]: 1, unique_keys[1]: 1, unique_keys[2]: 1}


def choose_resources(
    product_keys: Iterable[str],
    resource_type: str,
    rng: random.Random | None = None,
) -> list[dict[str, str]]:
    allocation = resource_allocation(product_keys)
    chooser = rng or _rng
    selected: list[dict[str, str]] = []

    for product_key, count in allocation.items():
        library = PRODUCT_RESOURCE_LIBRARY.get(product_key, {}).get(resource_type, [])
        if len(library) < count:
            label = PRODUCT_LABELS.get(product_key, product_key)
            raise ResourceInjectionError(
                f"资源库中 {label} 至少需要 {count} 个 {resource_type} 条目，"
                f"当前只有 {len(library)} 个"
            )
        for item in chooser.sample(library, count):
            selected.append(
                {
                    **item,
                    "product_key": product_key,
                    "product_label": PRODUCT_LABELS[product_key],
                }
            )

    return selected


# ---------------------------------------------------------------------------
# 卡片 HTML
# ---------------------------------------------------------------------------


def youtube_card(item: dict[str, str]) -> str:
    video_id = item["video_id"]
    title = item["title"]
    creator = item["creator"]
    product_label = item["product_label"]
    thumbnail = f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
    alt_text = (
        f"Creator video showing {product_label} hardware, setup, "
        "and real-world home server use"
    )

    return f"""<a
  class="zima-compare__media-item"
  href="{html_lib.escape(item['url'], quote=True)}"
  title="{html_lib.escape(title, quote=True)}"
  target="_blank"
  rel="nofollow noopener noreferrer"
>
  <span class="zima-compare__media-visual">
    <img src="{html_lib.escape(thumbnail, quote=True)}" alt="{html_lib.escape(alt_text, quote=True)}" title="{html_lib.escape(title, quote=True)}" loading="lazy" decoding="async">
    <span class="zima-compare__play" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7l8 5-8 5V7z" fill="currentColor"></path></svg></span>
  </span>
  <span class="zima-compare__media-type">YouTube</span>
  <strong class="zima-compare__media-title">{html_lib.escape(title)}</strong>
  <span class="zima-compare__media-meta">{html_lib.escape(creator)} · {html_lib.escape(product_label)}</span>
</a>"""


def blog_card(item: dict[str, str], cover_url: str) -> str:
    title = item["title"]
    creator = item["creator"]
    product_label = item["product_label"]
    alt_text = (
        f"ZimaSpace creator story about {product_label} hardware "
        "and a practical home server project"
    )

    return f"""<a
  class="zima-compare__media-item"
  href="{html_lib.escape(item['url'], quote=True)}"
  title="{html_lib.escape(title, quote=True)}"
>
  <span class="zima-compare__media-visual">
    <img src="{html_lib.escape(cover_url, quote=True)}" alt="{html_lib.escape(alt_text, quote=True)}" title="{html_lib.escape(title, quote=True)}" loading="lazy" decoding="async">
  </span>
  <span class="zima-compare__media-type">Creator Story</span>
  <strong class="zima-compare__media-title">{html_lib.escape(title)}</strong>
  <span class="zima-compare__media-meta">Based on {html_lib.escape(creator)} · {html_lib.escape(product_label)}</span>
</a>"""


def _resource_note(youtube_items: list[dict[str, str]], blog_items: list[dict[str, str]]) -> str:
    def compact(items: list[dict[str, str]]) -> str:
        return "; ".join(
            f"{item['product_label']}: {item['creator']}" for item in items
        )

    return f"YouTube [{compact(youtube_items)}] | Blogs [{compact(blog_items)}]"


# ---------------------------------------------------------------------------
# og:image 抓取
# ---------------------------------------------------------------------------

CoverFetcher = Callable[[str], Awaitable[str]]


class _OgImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.image_url = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.image_url or tag.lower() != "meta":
            return
        attr_map = {key.lower(): (value or "") for key, value in attrs}
        identity = (attr_map.get("property", "") or attr_map.get("name", "")).lower()
        if identity in {"og:image", "og:image:secure_url", "twitter:image"}:
            content = attr_map.get("content", "").strip()
            if content:
                self.image_url = content


async def fetch_blog_cover(url: str, client_factory: Any = None) -> str:
    """抓取博客页面的 og:image 作为封面。"""
    factory = client_factory or (lambda: httpx.AsyncClient(timeout=30.0))

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "Chrome/152 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
    }

    try:
        async with factory() as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as error:
        raise ResourceInjectionError(
            f"抓取博客封面失败（{url}）：{error}"
        ) from error

    if response.status_code >= 400:
        raise ResourceInjectionError(
            f"抓取博客封面失败（{url}）：HTTP {response.status_code}"
        )

    parser = _OgImageParser()
    parser.feed(response.text)
    parser.close()

    image_url = parser.image_url.strip()
    if image_url.startswith("//"):
        image_url = "https:" + image_url
    if not image_url.startswith(("http://", "https://")):
        raise ResourceInjectionError(
            f"博客页面没有暴露可用的 og:image：{url}"
        )
    return image_url


# ---------------------------------------------------------------------------
# 注入
# ---------------------------------------------------------------------------


async def build_resources_html(
    title: str,
    body_html: str,
    *,
    fetch_covers: bool,
    rng: random.Random | None = None,
    cover_fetcher: CoverFetcher | None = None,
) -> tuple[str, str]:
    """生成资源区块 HTML。返回 (resources_html, 说明文本)。"""
    product_keys = detect_zima_products(title, body_html)
    youtube_items = choose_resources(product_keys, "youtube", rng)
    blog_items = choose_resources(product_keys, "blog", rng)

    youtube_html = "\n".join(youtube_card(item) for item in youtube_items)

    fetcher = cover_fetcher or fetch_blog_cover
    blog_cards: list[str] = []
    for item in blog_items:
        cover = (
            await fetcher(item["url"]) if fetch_covers else PENDING_COVER
        )
        blog_cards.append(blog_card(item, cover))
    blog_html = "\n".join(blog_cards)

    resources_html = f"""<div class="zima-compare__resource-group">
  <h3>Watch Creator Videos</h3>
  <div class="zima-compare__media-grid">
{youtube_html}
  </div>
</div>

<div class="zima-compare__resource-group">
  <h3>Related Zima Articles</h3>
  <div class="zima-compare__media-grid">
{blog_html}
  </div>
</div>"""

    return resources_html, _resource_note(youtube_items, blog_items)


async def inject_resources(
    title: str,
    body_html: str,
    *,
    fetch_covers: bool,
    rng: random.Random | None = None,
    cover_fetcher: CoverFetcher | None = None,
) -> tuple[str, str]:
    """把资源区块注入到 COMPARE:RESOURCES 标记之间。返回 (新 HTML, 说明)。"""
    if (
        body_html.count(RESOURCES_OPEN_MARKER) != 1
        or body_html.count(RESOURCES_CLOSE_MARKER) != 1
    ):
        raise ResourceInjectionError(
            "注入前正文必须恰好包含一对 COMPARE:RESOURCES 标记"
        )

    resources_html, note = await build_resources_html(
        title,
        body_html,
        fetch_covers=fetch_covers,
        rng=rng,
        cover_fetcher=cover_fetcher,
    )

    pattern = re.compile(
        re.escape(RESOURCES_OPEN_MARKER) + r".*?" + re.escape(RESOURCES_CLOSE_MARKER),
        flags=re.DOTALL,
    )
    injected = pattern.sub(
        RESOURCES_OPEN_MARKER + "\n" + resources_html + "\n" + RESOURCES_CLOSE_MARKER,
        body_html,
        count=1,
    )

    return injected, note


__all__ = [
    "PENDING_COVER",
    "PRODUCT_ALIASES",
    "PRODUCT_LABELS",
    "PRODUCT_RESOURCE_LIBRARY",
    "RESOURCES_CLOSE_MARKER",
    "RESOURCES_OPEN_MARKER",
    "ResourceInjectionError",
    "blog_card",
    "build_resources_html",
    "choose_resources",
    "detect_zima_products",
    "fetch_blog_cover",
    "inject_resources",
    "resource_allocation",
    "youtube_card",
]
