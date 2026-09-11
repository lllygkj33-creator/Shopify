"""博客发布器测试。

测试用例**刻意对照 GEO 可用脚本的行为**逐条写：
这些约束（160 字符上限、H2 数量门槛、handle 正则、随机选取、封面洗牌）
都是脚本里真实存在的，一旦"顺手优化"掉就会造成发布行为漂移。
"""

from __future__ import annotations

import random

import pytest

from app.shopify.publisher import (
    COVER_IMAGE_NAMES,
    RELATED_PRODUCTS_PLACEHOLDER,
    BlogPublisher,
    PublishCandidate,
    PublishError,
    RandomCoverImagePool,
    cover_slot_from_filename,
    filename_from_shopify_url,
    inject_related_products_placeholder,
    normalize_article,
    normalize_handle,
    normalize_product_title,
    normalize_tags,
)

HTML_WITH_4_H2 = (
    "<article><h2>A</h2><p>1</p><h2>B</h2><p>2</p>"
    "<h2>C</h2><p>3</p><h2>D</h2><p>4</p></article>"
)


def article(**overrides):
    base = {
        "blog title": "Is One NVMe Slot Enough?",
        "url": "is-one-nvme-slot-enough",
        "meta title": "Meta 标题",
        "meta description": "Meta 描述",
        "summary": "摘要",
        "html代码": HTML_WITH_4_H2,
    }
    base.update(overrides)
    return base


def normalize(raw, **kwargs):
    options = {
        "blog_name": "Buying Guide",
        "default_author": "Author Name",
        "reviewers": ["Reviewer One", "Reviewer Two"],
        "product_titles": ["ZimaCube 2 Personal Cloud Home NAS"],
    }
    options.update(kwargs)
    return normalize_article(raw, **options)


# ---------------------------------------------------------------------------
# handle
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value,expected",
    [
        ("my-post", "my-post"),
        ("/my-post", "my-post"),
        ("  my-post  ", "my-post"),
        ("my-post/", "my-post"),
        ("abc-123-def", "abc-123-def"),
    ],
)
def test_normalize_handle_accepts_valid(value, expected):
    assert normalize_handle(value) == expected


def test_normalize_handle_extracts_from_url():
    assert (
        normalize_handle("https://your-store.myshopify.com/blogs/news/my-post?x=1")
        == "my-post"
    )


@pytest.mark.parametrize(
    "value", ["My-Post", "my_post", "my post", "my--post", "帖子", "my-post-"]
)
def test_normalize_handle_rejects_invalid(value):
    """脚本用严格正则，大写/下划线/空格/中文都会被拒。"""
    with pytest.raises(PublishError, match="Handle"):
        normalize_handle(value)


def test_normalize_tags_accepts_string_and_list():
    assert normalize_tags("a, b ,, c") == ["a", "b", "c"]
    assert normalize_tags(["a", " b "]) == ["a", "b"]
    assert normalize_tags(None) == []


def test_normalize_tags_rejects_other_types():
    with pytest.raises(PublishError):
        normalize_tags({"a": 1})


# ---------------------------------------------------------------------------
# 占位符注入
# ---------------------------------------------------------------------------


def test_placeholder_left_untouched_if_present():
    html = f"<article>{RELATED_PRODUCTS_PLACEHOLDER}</article>"
    assert inject_related_products_placeholder(html) == html


def test_placeholder_inserted_before_fourth_h2():
    result = inject_related_products_placeholder(HTML_WITH_4_H2)

    assert RELATED_PRODUCTS_PLACEHOLDER in result
    # 必须落在第 4 个 <h2> 之前，也就是第 3 个章节结束处
    assert result.index(RELATED_PRODUCTS_PLACEHOLDER) < result.index("<h2>D</h2>")


def test_placeholder_requires_four_h2():
    """脚本在此直接抛错——前端也据此提前标红。"""
    with pytest.raises(PublishError, match="少于4个H2"):
        inject_related_products_placeholder(
            "<article><h2>A</h2><h2>B</h2><h2>C</h2></article>"
        )


# ---------------------------------------------------------------------------
# normalize_article
# ---------------------------------------------------------------------------


def test_normalize_article_happy_path():
    result = normalize(article())

    assert result["title"] == "Is One NVMe Slot Enough?"
    assert result["handle"] == "is-one-nvme-slot-enough"
    assert result["blog_name"] == "Buying Guide"
    assert result["author"] == "Author Name"
    assert RELATED_PRODUCTS_PLACEHOLDER in result["html"]


@pytest.mark.parametrize(
    "missing",
    ["blog title", "url", "meta title", "meta description", "summary", "html代码"],
)
def test_normalize_article_requires_all_six_fields(missing):
    raw = article(**{missing: ""})
    with pytest.raises(PublishError, match="缺少字段"):
        normalize(raw)


def test_meta_description_over_160_chars_is_rejected():
    with pytest.raises(PublishError, match="meta description 超过160"):
        normalize(article(**{"meta description": "x" * 161}))


def test_summary_over_160_chars_is_rejected():
    with pytest.raises(PublishError, match="summary 超过160"):
        normalize(article(summary="x" * 161))


def test_exactly_160_chars_is_allowed():
    result = normalize(article(**{"meta description": "x" * 160}))
    assert len(result["meta_description"]) == 160


def test_reviewer_randomly_chosen_when_absent():
    reviewers = ["Reviewer One", "Reviewer Two"]
    seen = set()
    for seed in range(40):
        result = normalize(article(), reviewers=reviewers, **{"rng": random.Random(seed)})
        seen.add(result["reviewer"])

    assert seen.issubset(set(reviewers))
    assert len(seen) > 1, "应当会随机到不同审核人"


def test_explicit_reviewer_wins_over_random():
    result = normalize(article(reviewer="Reviewer Two"))
    assert result["reviewer"] == "Reviewer Two"


def test_related_product_randomly_chosen_when_absent():
    products = ["ZimaCube 2 Personal Cloud Home NAS", "ZimaBoard 2 - Mini Home Server"]
    seen = set()
    for seed in range(40):
        result = normalize(article(), product_titles=products, **{"rng": random.Random(seed)})
        seen.add(result["related_product_title"])

    assert seen.issubset(set(products))
    assert len(seen) > 1


def test_explicit_related_product_wins():
    result = normalize(article(**{"related_products": ["ZimaBoard 2 - Mini Home Server"]}))
    assert result["related_product_title"] == "ZimaBoard 2 - Mini Home Server"


def test_missing_reviewers_raises_actionable_error():
    with pytest.raises(PublishError, match="默认审核人"):
        normalize(article(), reviewers=[])


def test_missing_product_pool_raises_actionable_error():
    with pytest.raises(PublishError, match="关联产品"):
        normalize(article(), product_titles=[])


# ---------------------------------------------------------------------------
# 封面图：文件名 → 槽位
# ---------------------------------------------------------------------------


def test_filename_from_shopify_url_strips_query_and_decodes():
    url = "https://cdn.shopify.com/s/files/1/0001/files/Frame_3467296.png?v=123"
    assert filename_from_shopify_url(url) == "Frame_3467296.png"
    assert filename_from_shopify_url("https://x/y/Your_AI_deserves_a_home_M_1.jpg") == (
        "Your_AI_deserves_a_home_M_1.jpg"
    )


def test_cover_slot_exact_match_is_case_insensitive():
    assert cover_slot_from_filename("images_1.png") == "images_1"
    assert cover_slot_from_filename("IMAGES_7.JPG") == "images_7"


def test_cover_slot_matches_duplicate_upload_suffixes():
    # Shopify 重复上传会加编号或哈希后缀
    assert cover_slot_from_filename("images_3_1.png") == "images_3"
    assert cover_slot_from_filename("images_3_ab12cd34.webp") == "images_3"


def test_cover_slot_prefers_longest_configured_name():
    """否则 Frame_3467245 会抢先匹配更长的 Frame_3467245_1de55521-..."""
    long_name = "Frame_3467245_1de55521-ad22-4f07-b432-3368749e47fb"
    assert long_name in COVER_IMAGE_NAMES

    assert cover_slot_from_filename(f"{long_name}.png") == long_name
    assert cover_slot_from_filename("Frame_3467245.png") == "Frame_3467245"


def test_cover_slot_returns_none_for_unknown_file():
    assert cover_slot_from_filename("random-screenshot.png") is None


def test_normalize_product_title_unifies_dashes_and_case():
    assert normalize_product_title("ZimaCube 2  Personal—Cloud") == (
        "zimacube 2 personal-cloud"
    )


# ---------------------------------------------------------------------------
# 封面图池
# ---------------------------------------------------------------------------


def test_cover_pool_does_not_repeat_within_a_round():
    images = [{"slot": f"images_{i}"} for i in range(1, 6)]
    pool = RandomCoverImagePool(images)

    drawn = [pool.draw()["slot"] for _ in range(5)]

    assert sorted(drawn) == sorted(image["slot"] for image in images)
    assert len(set(drawn)) == 5


def test_cover_pool_reshuffles_after_exhaustion():
    images = [{"slot": "a"}, {"slot": "b"}]
    pool = RandomCoverImagePool(images)

    first_round = [pool.draw()["slot"] for _ in range(2)]
    second_round = [pool.draw()["slot"] for _ in range(2)]

    assert sorted(first_round) == ["a", "b"]
    assert sorted(second_round) == ["a", "b"]


def test_cover_pool_rejects_empty_list():
    with pytest.raises(PublishError):
        RandomCoverImagePool([])


# ---------------------------------------------------------------------------
# BlogPublisher：资源解析（用假客户端，不触网）
# ---------------------------------------------------------------------------


class FakeClient:
    """按查询特征分发的假 GraphQL 客户端。"""

    def __init__(
        self,
        *,
        blogs=None,
        definitions=None,
        metaobjects=None,
        products=None,
        scan_pages=None,
        filename_files=None,
        article=None,
        user_errors=None,
    ):
        self.blogs = blogs if blogs is not None else []
        self.definitions = definitions if definitions is not None else []
        self.metaobjects = metaobjects if metaobjects is not None else []
        self.products = products if products is not None else []
        self.scan_pages = list(scan_pages or [])
        self.filename_files = filename_files if filename_files is not None else []
        self.article = article
        self.user_errors = user_errors or []
        self.calls: list[str] = []

    async def execute(self, query, variables=None, **kwargs):
        if "articleCreate" in query:
            self.calls.append("articleCreate")
            return {
                "articleCreate": {
                    "article": self.article,
                    "userErrors": self.user_errors,
                }
            }
        if "metaobjectDefinitions" in query:
            self.calls.append("metaobjectDefinitions")
            return {"metaobjectDefinitions": {"nodes": self.definitions}}
        if "metaobjects(" in query:
            self.calls.append("metaobjects")
            return {"metaobjects": {"nodes": self.metaobjects}}
        if "products(" in query:
            self.calls.append("products")
            return {"products": {"nodes": self.products}}
        if "GetRecentCoverImages" in query:
            self.calls.append("coverScan")
            if self.scan_pages:
                return {"files": self.scan_pages.pop(0)}
            return {"files": {"nodes": [], "pageInfo": {"hasNextPage": False}}}
        if "FindCoverImageByFilename" in query:
            self.calls.append("coverFilename")
            return {"files": {"nodes": self.filename_files}}
        if "blogs(" in query:
            self.calls.append("blogs")
            return {"blogs": {"nodes": self.blogs}}
        raise AssertionError(f"未预期的查询：{query[:60]}")


def media_image(name: str, *, status: str = "READY", updated: str = "2026-01-01T00:00:00Z"):
    return {
        "__typename": "MediaImage",
        "id": f"gid://shopify/MediaImage/{name}",
        "alt": "",
        "fileStatus": status,
        "updatedAt": updated,
        "image": {
            "url": f"https://cdn.shopify.com/s/files/1/files/{name}.png?v=1",
            "width": 1280,
            "height": 720,
        },
    }


async def test_find_blog_gid_is_case_insensitive_exact_match():
    publisher = BlogPublisher(
        FakeClient(blogs=[{"id": "gid://shopify/Blog/6", "title": "Buying Guide"}])
    )

    assert await publisher.find_blog_gid("Buying Guide") == "gid://shopify/Blog/6"
    # casefold 精确匹配：大小写无关，但多一个字符就不行
    assert await publisher.find_blog_gid("buying guide") == "gid://shopify/Blog/6"


async def test_find_blog_gid_error_lists_available_blogs():
    publisher = BlogPublisher(
        FakeClient(blogs=[{"id": "gid://shopify/Blog/1", "title": "News"}])
    )

    with pytest.raises(PublishError) as excinfo:
        await publisher.find_blog_gid("Buying Guides")

    message = str(excinfo.value)
    assert "找不到 Shopify Blog" in message
    assert "News" in message


async def test_blog_lookup_is_cached_across_calls():
    client = FakeClient(blogs=[{"id": "gid://shopify/Blog/6", "title": "Buying Guide"}])
    publisher = BlogPublisher(client)

    await publisher.find_blog_gid("Buying Guide")
    await publisher.find_blog_gid("Buying Guide")

    assert client.calls.count("blogs") == 1


async def test_find_person_gid_resolves_via_metaobject_definition():
    client = FakeClient(
        definitions=[
            {"id": "1", "name": "Blog Author Information", "type": "blog_author"}
        ],
        metaobjects=[
            {"id": "gid://shopify/Metaobject/1", "handle": "eva", "displayName": "Author Name"}
        ],
    )
    publisher = BlogPublisher(client)

    assert await publisher.find_person_gid("eva wong") == "gid://shopify/Metaobject/1"


async def test_find_person_gid_reports_missing_person():
    client = FakeClient(
        definitions=[{"id": "1", "name": "Blog Author Information", "type": "blog_author"}],
        metaobjects=[{"id": "gid://shopify/Metaobject/1", "displayName": "Author Name"}],
    )
    publisher = BlogPublisher(client)

    with pytest.raises(PublishError, match="找不到：Reviewer Two"):
        await publisher.find_person_gid("Reviewer Two")


async def test_find_product_gid_normalizes_dash_variants():
    client = FakeClient(
        products=[
            {"id": "gid://shopify/Product/9", "title": "ZimaBoard 2 – Mini Home Server"}
        ]
    )
    publisher = BlogPublisher(client)

    # 配置里是 "-"，Shopify 里是 "–"，normalize 之后要能匹配上
    assert await publisher.find_product_gid("ZimaBoard 2 - Mini Home Server") == (
        "gid://shopify/Product/9"
    )


async def test_load_cover_images_maps_slots_and_ignores_not_ready():
    client = FakeClient(
        scan_pages=[
            {
                "nodes": [
                    media_image("images_1"),
                    media_image("images_2", status="PROCESSING"),
                    media_image("random-file"),
                ],
                "pageInfo": {"hasNextPage": False, "endCursor": None},
            }
        ]
    )
    publisher = BlogPublisher(client)

    found = await publisher.load_cover_images()
    slots = {item["slot"] for item in found}

    assert "images_1" in slots
    # 未 READY 的图片不能用
    assert "images_2" not in slots


async def test_load_cover_images_raises_when_nothing_matches():
    client = FakeClient(
        scan_pages=[
            {
                "nodes": [media_image("totally-unrelated")],
                "pageInfo": {"hasNextPage": False},
            }
        ]
    )
    publisher = BlogPublisher(client)

    with pytest.raises(PublishError, match="没有找到任何配置范围内的可用封面图"):
        await publisher.load_cover_images()


async def test_load_cover_images_falls_back_to_filename_lookup():
    """扫描没命中时，用 filename 过滤补查（脚本的第二步）。"""
    client = FakeClient(
        scan_pages=[
            {
                "nodes": [media_image("images_1")],
                "pageInfo": {"hasNextPage": False},
            }
        ],
        filename_files=[media_image("images_1")],
    )
    publisher = BlogPublisher(client)

    found = await publisher.load_cover_images()

    assert "coverFilename" in client.calls
    assert {item["slot"] for item in found} == {"images_1"}


async def test_create_article_builds_expected_input():
    captured = {}

    class CaptureClient(FakeClient):
        async def execute(self, query, variables=None, **kwargs):
            if "articleCreate" in query:
                captured.update(variables["article"])
                return {
                    "articleCreate": {
                        "article": {
                            "id": "gid://shopify/Article/1",
                            "title": "T",
                            "handle": "h",
                            "isPublished": False,
                            "publishedAt": None,
                        },
                        "userErrors": [],
                    }
                }
            return await super().execute(query, variables, **kwargs)

    publisher = BlogPublisher(CaptureClient())
    candidate = PublishCandidate(
        title="T",
        handle="h",
        meta_title="MT",
        meta_description="MD",
        summary="S",
        html="<article></article>",
        blog_name="Buying Guide",
        author="Author Name",
        reviewer="Reviewer Two",
        related_product_title="ZimaCube 2 Personal Cloud Home NAS",
        tags=["a"],
        cover_image_url="https://cdn.example/x.png",
    )

    from datetime import datetime, timezone

    await publisher.create_article(
        candidate,
        blog_gid="gid://shopify/Blog/6",
        author_gid="gid://shopify/Metaobject/1",
        reviewer_gid="gid://shopify/Metaobject/2",
        related_product_gid="gid://shopify/Product/9",
        publish_datetime=datetime(2026, 9, 15, 14, 30, tzinfo=timezone.utc),
        is_published=False,
    )

    assert captured["blogId"] == "gid://shopify/Blog/6"
    assert captured["isPublished"] is False
    assert captured["publishDate"].startswith("2026-09-15T14:30")
    # 封面图 alt 用文章标题，避免共用图片时 alt 过于泛化
    assert captured["image"] == {
        "url": "https://cdn.example/x.png",
        "altText": "T",
    }
    # 6 个 metafield，字段名与脚本一致
    metafields = {item["key"]: item for item in captured["metafields"]}
    assert set(metafields) == {
        "title_tag",
        "description_tag",
        "summary_text",
        "author",
        "reviewer",
        "related_products",
    }
    assert metafields["related_products"]["value"] == (
        '["gid://shopify/Product/9"]'
    )


async def test_create_article_surfaces_user_errors():
    publisher = BlogPublisher(
        FakeClient(user_errors=[{"code": "INVALID", "field": ["handle"], "message": "已被占用"}])
    )
    candidate = PublishCandidate(
        title="T",
        handle="h",
        meta_title="MT",
        meta_description="MD",
        summary="S",
        html="<article></article>",
        blog_name="Buying Guide",
        author="Author Name",
        reviewer="Reviewer Two",
        related_product_title="P",
    )

    with pytest.raises(PublishError) as excinfo:
        await publisher.create_article(
            candidate,
            blog_gid="b",
            author_gid="a",
            reviewer_gid="r",
            related_product_gid="p",
            publish_datetime=None,
            is_published=True,
        )

    assert "已被占用" in str(excinfo.value)


async def test_immediate_publish_omits_publish_date():
    """立即发布不能带 publishDate（Shopify 要求未来时间才配 isPublished=False）。"""
    captured = {}

    class CaptureClient(FakeClient):
        async def execute(self, query, variables=None, **kwargs):
            if "articleCreate" in query:
                captured.update(variables["article"])
                return {
                    "articleCreate": {
                        "article": {"id": "gid://shopify/Article/1"},
                        "userErrors": [],
                    }
                }
            return await super().execute(query, variables, **kwargs)

    publisher = BlogPublisher(CaptureClient())
    candidate = PublishCandidate(
        title="T",
        handle="h",
        meta_title="MT",
        meta_description="MD",
        summary="S",
        html="<article></article>",
        blog_name="Buying Guide",
        author="Author Name",
        reviewer="Reviewer Two",
        related_product_title="P",
    )

    await publisher.create_article(
        candidate,
        blog_gid="b",
        author_gid="a",
        reviewer_gid="r",
        related_product_gid="p",
        publish_datetime=None,
        is_published=True,
    )

    assert captured["isPublished"] is True
    assert "publishDate" not in captured
    # 没有封面时不应带 image 字段
    assert "image" not in captured
