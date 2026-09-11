"""FastAPI 应用：健康检查、全局设置、令牌管理、连接自检。

接口路径与前端 `src/lib/api.ts` 里声明的契约一致。

本轮只覆盖「配置与令牌」这条链路（含 blogs 查询用于验证调用链）；
内容发布、排期、历史记录等接口随后端代码陆续补齐。
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config as app_config
from .storage import store
from . import ssl_fix  # noqa: F401  导入即生效（macOS CA 修复）
from .shopify.backlink import (
    BacklinkError,
    BacklinkRunner,
    BacklinkConfig,
    load_backlink,
)
from .shopify.client import ShopifyError, shopify_client
from .shopify.templates import TemplateList, template_service
from .shopify.vs_resources import ResourceInjectionError, inject_resources
from .shopify.page_publisher import (
    PagePublishError,
    PagePublisher,
    build_page_payload,
    full_page_url,
    get_page_spec,
    validate_page_payload,
)
from .shopify.publisher import (
    DEFAULT_REVIEWERS_FALLBACK,
    RELATED_PRODUCT_TITLES_FALLBACK,
    BlogPublisher,
    PublishCandidate,
    PublishError,
    normalize_article,
    record_publish_result,
    validate_article_html,
)
from .shopify.token import (
    TokenConfigError,
    TokenError,
    mask_token,
    token_manager,
)

app = FastAPI(
    title="Zima 发布平台 API",
    version="0.1.0",
    description="ZimaSpace 定制发布平台后端：Shopify 内容托管与定时发布。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_config.env.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 响应模型
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    ok: bool
    version: str
    ssl: dict[str, Any]


class SettingsResponse(BaseModel):
    """与前端 GlobalSettings 对齐。**永不含明文 token。**"""

    shopDomain: str
    apiVersion: str
    tokenSource: str

    accessTokenMasked: str | None = None
    hasAccessToken: bool = False
    # --- 令牌有效期相关（24h token 的可观测性）---
    tokenExpiresAt: str | None = None
    tokenExpiresInSeconds: int | None = None
    tokenScope: str | None = None
    tokenLastRefreshedAt: str | None = None
    tokenNeverExpires: bool = False
    tokenError: str | None = None

    # --- 凭据配置情况 ---
    hasClientCredentials: bool = False
    clientId: str | None = None

    defaultAuthor: str
    defaultReviewers: list[str] = Field(default_factory=list)
    relatedProductTitles: list[str] = Field(default_factory=list)
    defaultTimezone: str
    defaultPublishTime: str
    # 页面模板清单（Custom 文章的模板选择器用）
    templateChoices: list[str] = Field(default_factory=list)


class SettingsUpdate(BaseModel):
    shopDomain: str | None = None
    apiVersion: str | None = None
    tokenSource: str | None = None
    # 仅当用户真的改了 token 才提交；留空表示不动
    accessToken: str | None = None
    defaultAuthor: str | None = None
    defaultReviewers: list[str] | None = None
    relatedProductTitles: list[str] | None = None
    defaultTimezone: str | None = None
    defaultPublishTime: str | None = None
    templateChoices: list[str] | None = None


class ConnectionCheckResponse(BaseModel):
    ok: bool
    shopName: str | None = None
    shopDomain: str | None = None
    apiVersion: str | None = None
    scopes: list[str] = Field(default_factory=list)
    # 内容发布必需（read/write content 或 online_store_pages）
    missingScopes: list[str] = Field(default_factory=list)
    # 仅博客发布才需要的（metaobject / products / files）
    blogMissingScopes: list[str] = Field(default_factory=list)
    checkedAt: str
    error: str | None = None


class PublishItemIn(BaseModel):
    """前端提交的一条待发布内容（见 docs/ui-actions.md 的 C11）。"""

    candidateTempId: str
    channelId: str
    contentType: str  # blog_article | page
    mode: str  # now | schedule | draft

    publishKey: str | None = None
    scheduledAt: str | None = None  # mode=schedule 必填，带时区偏移的 ISO 8601

    # 正文与 SEO
    title: str | None = None
    handle: str | None = None
    bodyHtml: str | None = None
    summary: str | None = None
    metaTitle: str | None = None
    metaDescription: str | None = None

    # 博客文章
    blogName: str | None = None
    # 页面
    template: str | None = None
    # 页面来源对象（如 community_source），整对象透传给后端
    source: dict[str, Any] | None = None
    # 来源 metafield 的键名（Custom 栏目由 JSON 的 *_source 决定）
    sourceKey: str | None = None
    # 可选：页面发布成功后往某篇博客文章追加上下文反链（用户故事用）
    backlink: dict[str, Any] | None = None

    # 前置引用
    author: str | None = None
    reviewer: str | None = None
    relatedProducts: list[str] | None = None
    tags: list[str] | None = None

    # 来源追溯
    sourceFile: str | None = None
    sourceIndex: int | None = None


class PublishRequest(BaseModel):
    items: list[PublishItemIn]


class PublishResultItem(BaseModel):
    candidateTempId: str
    status: str  # draft | scheduled | published | failed
    title: str
    scheduledAt: str | None = None
    publishedUrl: str | None = None
    shopifyId: str | None = None
    error: str | None = None
    # 便于核对：本次实际用到的封面图与关联产品
    coverImageSlot: str | None = None
    relatedProduct: str | None = None
    reviewer: str | None = None
    """反链执行结果：ADDED / ALREADY PRESENT / None"""
    backlinkResult: str | None = None
    backlinkError: str | None = None


class PublishResponse(BaseModel):
    ok: bool
    items: list[PublishResultItem]


class ContentItemOut(BaseModel):
    """与前端 ContentItem 对齐。"""

    id: str
    channelId: str
    contentType: str
    title: str
    handle: str
    blogName: str | None = None
    template: str | None = None
    bodyHtml: str = ""
    summary: str | None = None
    metaTitle: str | None = None
    metaDescription: str | None = None
    author: str | None = None
    reviewer: str | None = None
    relatedProducts: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    sourceFile: str | None = None
    sourceIndex: int | None = None
    publishKey: str | None = None
    status: str
    scheduledAt: str | None = None
    publishedAt: str | None = None
    publishedUrl: str | None = None
    shopifyId: str | None = None
    error: str | None = None
    createdAt: str
    updatedAt: str


class TimelineBarOut(BaseModel):
    id: str
    channelId: str
    title: str
    handle: str
    status: str
    contentType: str
    scheduledAt: str | None = None
    publishedAt: str | None = None
    publishedUrl: str | None = None
    error: str | None = None


class DashboardStatsOut(BaseModel):
    scheduledCount: int = 0
    publishedCount: int = 0
    failedCount: int = 0
    draftCount: int = 0


class HistoryEntryOut(BaseModel):
    id: str
    channelId: str
    title: str
    handle: str
    status: str
    publishKey: str | None = None
    scheduledAt: str | None = None
    publishedAt: str | None = None
    publishedUrl: str | None = None
    shopifyId: str | None = None
    error: str | None = None
    recordedAt: str


class ContentScheduleUpdate(BaseModel):
    scheduledAt: str


class ValidateIssue(BaseModel):
    level: str  # error | warning
    field: str | None = None
    message: str


class ValidateItemIn(BaseModel):
    """与 PublishItemIn 同形（不含发布方式），用于上传阶段的权威校验。"""

    candidateTempId: str
    channelId: str
    contentType: str
    title: str | None = None
    handle: str | None = None
    bodyHtml: str | None = None
    summary: str | None = None
    metaTitle: str | None = None
    metaDescription: str | None = None
    blogName: str | None = None
    template: str | None = None
    source: dict[str, Any] | None = None
    sourceKey: str | None = None
    relatedProducts: list[str] | None = None
    sourceFile: str | None = None


class ValidateRequest(BaseModel):
    items: list[ValidateItemIn]


class ValidateResultItem(BaseModel):
    candidateTempId: str
    publishable: bool
    issues: list[ValidateIssue] = Field(default_factory=list)


class ValidateResponse(BaseModel):
    items: list[ValidateResultItem]


class BlogItem(BaseModel):
    id: str
    name: str
    handle: str


# ---------------------------------------------------------------------------
# 组装设置响应
# ---------------------------------------------------------------------------


async def _build_settings_response() -> SettingsResponse:
    """组装设置响应。

    会在首次访问时**主动换取一次令牌**（非强制），否则界面会误报
    「未配置 token，无法发布」—— 因为令牌本来是懒加载的，配置齐全但还没被用过。
    换取失败不阻断设置读取，而是把原因放进 tokenError 让界面显示。
    """
    error_text: str | None = None
    if (
        app_config.resolved_token_source() == "auto"
        and app_config.env.has_client_credentials
    ):
        try:
            await token_manager.get_token()
        except TokenError as error:
            error_text = str(error)

    snapshot = token_manager.snapshot()
    client_id = app_config.env.shopify_client_id

    return SettingsResponse(
        shopDomain=app_config.resolved_shop_domain(),
        apiVersion=app_config.resolved_api_version(),
        tokenSource=snapshot.source,
        accessTokenMasked=snapshot.masked,
        hasAccessToken=snapshot.has_token,
        tokenExpiresAt=(
            snapshot.expires_at.isoformat() if snapshot.expires_at else None
        ),
        tokenExpiresInSeconds=snapshot.expires_in_seconds,
        tokenScope=snapshot.scope,
        tokenLastRefreshedAt=(
            snapshot.last_refreshed_at.isoformat()
            if snapshot.last_refreshed_at
            else None
        ),
        tokenNeverExpires=snapshot.never_expires,
        tokenError=error_text or snapshot.error,
        hasClientCredentials=app_config.env.has_client_credentials,
        # client_id 不是机密（参考代码里也明文写在脚本里），回显便于确认配的是哪个应用
        clientId=client_id or None,
        defaultAuthor=app_config.resolved_default_author(),
        defaultReviewers=app_config.resolved_default_reviewers(),
        relatedProductTitles=app_config.resolved_related_products(),
        defaultTimezone=app_config.resolved_timezone(),
        defaultPublishTime=app_config.resolved_default_publish_time(),
        templateChoices=app_config.resolved_template_choices(),
    )


# ---------------------------------------------------------------------------
# 接口
# ---------------------------------------------------------------------------


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    from . import __version__

    return HealthResponse(ok=True, version=__version__, ssl=ssl_fix.describe())


@app.get("/api/settings", response_model=SettingsResponse)
async def get_settings() -> SettingsResponse:
    return await _build_settings_response()


@app.put("/api/settings", response_model=SettingsResponse)
async def update_settings(payload: SettingsUpdate) -> SettingsResponse:
    patch: dict[str, Any] = {}

    if payload.shopDomain is not None:
        patch["shop_domain"] = payload.shopDomain.strip()
    if payload.apiVersion is not None:
        patch["api_version"] = payload.apiVersion.strip()
    if payload.tokenSource is not None:
        if payload.tokenSource not in ("auto", "env", "manual"):
            raise HTTPException(
                status_code=422,
                detail="tokenSource 只能是 auto / env / manual",
            )
        patch["token_source"] = payload.tokenSource
    if payload.defaultAuthor is not None:
        patch["default_author"] = payload.defaultAuthor.strip()
    if payload.defaultReviewers is not None:
        patch["default_reviewers"] = payload.defaultReviewers
    if payload.relatedProductTitles is not None:
        patch["related_product_titles"] = payload.relatedProductTitles
    if payload.defaultTimezone is not None:
        patch["default_timezone"] = payload.defaultTimezone.strip()
    if payload.defaultPublishTime is not None:
        patch["default_publish_time"] = payload.defaultPublishTime.strip()
    if payload.templateChoices is not None:
        patch["template_choices"] = [
            item.strip() for item in payload.templateChoices if item.strip()
        ]

    app_config.runtime.update(patch)

    # 手动 token 单独存（0600 权限文件），不进 settings.json
    from .shopify.token import manual_token_store

    if payload.accessToken:
        token = payload.accessToken.strip()
        if not token:
            manual_token_store.clear()
        else:
            manual_token_store.write(token)
        # 换了 token 就要丢掉旧缓存
        await token_manager.invalidate()

    # 配置变了 → 缓存的 token 可能对应旧店铺，一并作废
    if "shop_domain" in patch or "token_source" in patch:
        await token_manager.invalidate()

    return await _build_settings_response()


@app.post("/api/settings/verify", response_model=ConnectionCheckResponse)
async def verify_connection() -> ConnectionCheckResponse:
    """连接自检：换取 token 并核对内容读写权限。"""
    checked_at = datetime.now(timezone.utc).isoformat()

    try:
        # 强制换新，确保「自检」反映的是当前配置而不是旧缓存
        await token_manager.get_token(force_refresh=True)
    except TokenConfigError as error:
        return ConnectionCheckResponse(ok=False, checkedAt=checked_at, error=str(error))
    except TokenError as error:
        return ConnectionCheckResponse(ok=False, checkedAt=checked_at, error=str(error))

    try:
        result = await shopify_client.verify()
    except ShopifyError as error:
        return ConnectionCheckResponse(ok=False, checkedAt=checked_at, error=str(error))

    return ConnectionCheckResponse(
        ok=result.ok,
        shopName=result.shop_name,
        shopDomain=result.shop_domain,
        apiVersion=result.api_version,
        scopes=result.scopes,
        missingScopes=result.missing_scopes,
        blogMissingScopes=result.blog_missing_scopes,
        checkedAt=checked_at,
        error=result.error,
    )


@app.post("/api/settings/token/refresh", response_model=SettingsResponse)
async def refresh_token() -> SettingsResponse:
    """手动触发令牌续期（界面上「立即换新」按钮）。"""
    try:
        await token_manager.get_token(force_refresh=True)
    except TokenError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return await _build_settings_response()


@app.get("/api/theme/templates", response_model=TemplateList)
async def list_theme_templates() -> TemplateList:
    """列出可选的页面模板（templateSuffix）。

    **双来源**：
      1. 店铺主题（`read_themes` 权限可用时）—— 读 `templates/page.<suffix>.liquid`
      2. 全局设置里维护的模板清单（兜底）

    Shopify 对**不存在的 templateSuffix 是静默回退**到主题默认模板，不报错，
    所以「模板名写错」会静默发错样式。这个清单就是为了避免这种情况。
    """
    return await template_service.list_templates()


@app.get("/api/blogs", response_model=list[BlogItem])
async def list_blogs() -> list[BlogItem]:
    """列出店铺的博客，用于确认「栏目 → Shopify Blog」映射是否正确。"""
    query = """
    query ListBlogs {
      blogs(first: 50) {
        nodes {
          id
          title
          handle
        }
      }
    }
    """
    try:
        data = await shopify_client.execute(query)
    except ShopifyError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    nodes = ((data.get("blogs") or {}).get("nodes")) or []
    return [
        BlogItem(
            id=str(node.get("id", "")),
            name=str(node.get("title", "")),
            handle=str(node.get("handle", "")),
        )
        for node in nodes
    ]


def _to_content_item(row: dict[str, Any]) -> ContentItemOut:
    return ContentItemOut(
        id=str(row["id"]),
        channelId=row["channel_id"],
        contentType=row["content_type"],
        title=row["title"],
        handle=row["handle"],
        blogName=row.get("blog_name"),
        template=row.get("template"),
        bodyHtml=row.get("body_html") or "",
        summary=row.get("summary"),
        metaTitle=row.get("meta_title"),
        metaDescription=row.get("meta_description"),
        author=row.get("author"),
        reviewer=row.get("reviewer"),
        relatedProducts=row.get("related_products") or [],
        tags=row.get("tags") or [],
        sourceFile=row.get("source_file"),
        sourceIndex=row.get("source_index"),
        publishKey=row.get("publish_key"),
        status=row["status"],
        scheduledAt=row.get("scheduled_at"),
        publishedAt=row.get("published_at"),
        publishedUrl=row.get("published_url"),
        shopifyId=row.get("shopify_gid"),
        error=row.get("error"),
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )


@app.get("/api/contents", response_model=list[ContentItemOut])
async def list_contents(
    channel_id: str | None = None, limit: int = 500
) -> list[ContentItemOut]:
    """列出已入库的内容（含草稿与失败）。"""
    return [
        _to_content_item(row)
        for row in store.list_contents(channel_id=channel_id, limit=limit)
    ]


@app.get("/api/contents/timeline", response_model=list[TimelineBarOut])
async def contents_timeline(
    start: str | None = None, end: str | None = None
) -> list[TimelineBarOut]:
    """排期时间轴（仪表盘用）。

    `start` / `end` 可选，用于按窗口过滤（不传就是全量，前端自己算坐标）。
    """
    return [
        TimelineBarOut(
            id=str(row["id"]),
            channelId=row["channel_id"],
            title=row["title"],
            handle=row["handle"],
            status=row["status"],
            contentType=row["content_type"],
            scheduledAt=row.get("scheduled_at"),
            publishedAt=row.get("published_at"),
            publishedUrl=row.get("published_url"),
            error=row.get("error"),
        )
        for row in store.timeline(start=start, end=end)
    ]


@app.get("/api/contents/stats", response_model=DashboardStatsOut)
async def contents_stats() -> DashboardStatsOut:
    return DashboardStatsOut(**store.stats())


@app.get("/api/history", response_model=list[HistoryEntryOut])
async def publish_history(
    channel_id: str | None = None, limit: int = 200
) -> list[HistoryEntryOut]:
    """发布历史（排除纯草稿）。"""
    return [
        HistoryEntryOut(
            id=str(row["id"]),
            channelId=row["channel_id"],
            title=row["title"],
            handle=row["handle"],
            status=row["status"],
            publishKey=row.get("publish_key"),
            scheduledAt=row.get("scheduled_at"),
            publishedAt=row.get("published_at"),
            publishedUrl=row.get("published_url"),
            shopifyId=row.get("shopify_gid"),
            error=row.get("error"),
            recordedAt=row["updated_at"],
        )
        for row in store.history(channel_id=channel_id, limit=limit)
    ]


@app.patch("/api/contents/{content_id}", response_model=ContentItemOut)
async def reschedule_content(
    content_id: int, payload: ContentScheduleUpdate
) -> ContentItemOut:
    """改期。

    注意：这只更新**本地排期记录**。Shopify 侧已创建对象的 publishDate
    需要另行走 GraphQL（见 docs/ui-actions.md 的数据流说明）。
    """
    try:
        value = datetime.fromisoformat(payload.scheduledAt.replace("Z", "+00:00"))
    except ValueError as error:
        raise HTTPException(status_code=422, detail="scheduledAt 不是有效的 ISO 时间") from error

    if value.tzinfo is None:
        raise HTTPException(
            status_code=422, detail="scheduledAt 必须带时区偏移"
        )

    row = store.update_schedule(content_id, value.isoformat())
    if row is None:
        raise HTTPException(status_code=404, detail=f"未找到内容 {content_id}")
    return _to_content_item(row)


@app.delete("/api/contents/{content_id}/schedule", response_model=ContentItemOut)
async def cancel_content_schedule(content_id: int) -> ContentItemOut:
    """取消排期，退回草稿（Shopify 上的对象不会被删除）。"""
    row = store.cancel_schedule(content_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"未找到内容 {content_id}")
    return _to_content_item(row)


@app.post("/api/validate", response_model=ValidateResponse)
async def validate(payload: ValidateRequest) -> ValidateResponse:
    """上传阶段的**权威**校验（对应前端 C1/C4）。

    为什么要放在后端：各栏目的规则差异很大（Discord 要 4 个 H2、MakerWorld 还要求
    alt 长度区间 / loading=lazy / 链接的 target·rel·nofollow / 正文引用来源 URL）。
    这些规则在后端已经有一份完整实现，前端只保留少量结构校验做即时反馈，
    避免同一套规则在两种语言里各写一遍、然后慢慢漂移。

    只读接口：不写任何东西，纯校验。
    """
    results: list[ValidateResultItem] = []

    for item in payload.items:
        issues: list[ValidateIssue] = []

        if item.contentType == "page":
            spec = get_page_spec(item.channelId)
            if spec is None:
                issues.append(
                    ValidateIssue(
                        level="error",
                        message=f"栏目「{item.channelId}」没有页面发布规格",
                    )
                )
            else:
                try:
                    resolved_source_key = item.sourceKey or spec.source_key

                    raw: dict[str, Any] = {
                        "title": item.title,
                        "meta_title": item.metaTitle,
                        "meta_description": item.metaDescription,
                        "summary": item.summary,
                        "url": item.handle,
                        "template": item.template,
                        "html": item.bodyHtml,
                        "related_products": item.relatedProducts or [],
                    }
                    if resolved_source_key and item.source:
                        raw[resolved_source_key] = item.source
                    page = build_page_payload(
                        raw,
                        channel_id=item.channelId,
                        spec=spec,
                        source_file=item.sourceFile or "",
                    )
                    # VS 需要先注入资源区块，校验才看得到真实的最终 HTML。
                    # 这里不抓 og:image（上传阶段几十个文件会很慢），
                    # 封面可用性留给发布时检查。
                    await _inject_vs_resources(page, spec, fetch_covers=False)
                    # 结构化错误（缺字段、来源不合法…）
                    issues.extend(
                        ValidateIssue(level="error", message=message)
                        for message in validate_page_payload(page, spec)
                    )
                except (PagePublishError, ShopifyError) as error:
                    issues.append(ValidateIssue(level="error", message=str(error)))

        elif item.contentType == "blog_article":
            # 博客的规则前端已有本地实现，这里只做一次权威兜底
            reviewers = (
                app_config.resolved_default_reviewers() or DEFAULT_REVIEWERS_FALLBACK
            )
            products = (
                app_config.resolved_related_products() or RELATED_PRODUCT_TITLES_FALLBACK
            )
            try:
                normalize_article(
                    {
                        "blog title": item.title,
                        "url": item.handle,
                        "meta title": item.metaTitle,
                        "meta description": item.metaDescription,
                        "summary": item.summary,
                        "html代码": item.bodyHtml,
                    },
                    blog_name=item.blogName or "",
                    default_author=app_config.resolved_default_author(),
                    reviewers=reviewers,
                    product_titles=products,
                )
            except PublishError as error:
                issues.append(ValidateIssue(level="error", message=str(error)))

            # 外链规则（平台新增，脚本没有这一段）
            for message in validate_article_html(item.bodyHtml or ""):
                issues.append(ValidateIssue(level="error", message=message))
        else:
            issues.append(
                ValidateIssue(level="error", message=f"未知的内容类型：{item.contentType}")
            )

        results.append(
            ValidateResultItem(
                candidateTempId=item.candidateTempId,
                publishable=not any(issue.level == "error" for issue in issues),
                issues=issues,
            )
        )

    return ValidateResponse(items=results)


@app.post("/api/publish", response_model=PublishResponse)
async def publish(payload: PublishRequest) -> PublishResponse:
    """批量发布（对应前端 C11「发布 N 篇」）。

    行为与 GEO 的可用脚本 `publish_articles_random_covers_fixed.py` 对齐：
      - 封面图按配置名单随机洗牌分配（一轮内不重复）
      - reviewer / 关联产品未指定时随机选取
      - 定时发布用 `isPublished=False` + 未来 `publishDate`，由 Shopify 到点上线
      - **逐条独立处理**：单条失败不影响其他条目，逐条回传结果
      - 页面（page）发布器尚未实现，明确报错而不是静默跳过
    """
    if not payload.items:
        raise HTTPException(status_code=422, detail="items 不能为空")

    publisher = BlogPublisher()

    # 封面图只在有博客条目时才是前置条件；纯页面批次不必去扫 Files。
    cover_pool = None
    if any(item.contentType == "blog_article" for item in payload.items):
        try:
            cover_pool = await publisher._get_cover_pool()
        except (PublishError, ShopifyError) as error:
            raise HTTPException(
                status_code=502, detail=f"封面图加载失败：{error}"
            ) from error

    reviewers = app_config.resolved_default_reviewers() or DEFAULT_REVIEWERS_FALLBACK
    product_titles = (
        app_config.resolved_related_products() or RELATED_PRODUCT_TITLES_FALLBACK
    )
    default_author = app_config.resolved_default_author()

    now = datetime.now(timezone.utc)
    results: list[PublishResultItem] = []

    for item in payload.items:
        if item.contentType == "page":
            results.append(await _publish_page(item, now))
            continue

        if item.contentType != "blog_article":
            message = f"未知的内容类型：{item.contentType}"
            _persist(
                {
                    "channel_id": item.channelId,
                    "content_type": item.contentType,
                    "title": item.title or "",
                    "handle": item.handle or "",
                    "status": "failed",
                    "error": message,
                    "publish_key": item.publishKey,
                    "source_file": item.sourceFile,
                    "mode": item.mode,
                }
            )
            results.append(
                PublishResultItem(
                    candidateTempId=item.candidateTempId,
                    status="failed",
                    title=item.title or item.handle or "(未命名)",
                    error=message,
                )
            )
            continue

        try:
            scheduled = _parse_scheduled_at(item)

            if item.mode == "schedule" and scheduled is not None and scheduled <= now:
                # 与脚本的 ALLOW_PAST_SCHEDULE=False 一致：禁止把已过去的时间交给 Shopify
                raise PublishError(
                    "发布时间已经过去，为避免内容立即公开，本次未发布该条："
                    f"{scheduled.isoformat()}"
                )

            raw_article = {
                "blog title": item.title,
                "url": item.handle,
                "meta title": item.metaTitle,
                "meta description": item.metaDescription,
                "summary": item.summary,
                "html代码": item.bodyHtml,
                "author": item.author,
                "reviewer": item.reviewer,
                "related_products": item.relatedProducts,
                "tags": item.tags,
            }

            blog_name = item.blogName
            if not blog_name:
                raise PublishError(
                    "缺少 blogName：无法确定发布到哪个 Shopify Blog。"
                    "请在 JSON 正文里带上 zima-*-article class，或确认栏目默认博客。"
                )

            normalized = normalize_article(
                raw_article,
                blog_name=blog_name,
                default_author=default_author,
                reviewers=reviewers,
                product_titles=product_titles,
            )

            # 外链规则：与上传阶段保持一致，避免绕过前端直接调接口发布坏标记
            link_errors = validate_article_html(normalized["html"])
            if link_errors:
                raise PublishError("；".join(link_errors))

            assert cover_pool is not None  # 上面已保证有博客条目时必加载
            cover = cover_pool.draw()
            candidate = PublishCandidate(
                **normalized,
                source_index=item.sourceIndex or 0,
                source_file=item.sourceFile or "",
                publish_key=item.publishKey or "",
                cover_image_url=cover["url"],
                cover_image_slot=cover["slot"],
                cover_image_filename=cover["filename"],
            )

            blog_gid = await publisher.find_blog_gid(candidate.blog_name)
            author_gid = await publisher.find_person_gid(candidate.author)
            reviewer_gid = await publisher.find_person_gid(candidate.reviewer)
            product_gid = await publisher.find_product_gid(
                candidate.related_product_title
            )

            is_published = item.mode == "now"
            article = await publisher.create_article(
                candidate,
                blog_gid=blog_gid,
                author_gid=author_gid,
                reviewer_gid=reviewer_gid,
                related_product_gid=product_gid,
                # 草稿与立即发布都不需要 publishDate
                publish_datetime=scheduled if item.mode == "schedule" else None,
                is_published=is_published,
            )

            status = (
                "published"
                if item.mode == "now"
                else "draft"
                if item.mode == "draft"
                else "scheduled"
            )

            record_publish_result(
                {
                    "status": "success",
                    "publish_key": candidate.publish_key,
                    "article_id": article.get("id"),
                    "channel_id": item.channelId,
                    "blog_name": candidate.blog_name,
                    "title": candidate.title,
                    "handle": candidate.handle,
                    "scheduled_at": scheduled.isoformat() if scheduled else None,
                    "author": candidate.author,
                    "reviewer": candidate.reviewer,
                    "related_product": candidate.related_product_title,
                    "cover_image_slot": candidate.cover_image_slot,
                    "cover_image_filename": candidate.cover_image_filename,
                    "cover_image_url": candidate.cover_image_url,
                    "json_file": candidate.source_file,
                    "mode": item.mode,
                }
            )

            _persist(
                {
                    "channel_id": item.channelId,
                    "content_type": "blog_article",
                    "title": candidate.title,
                    "handle": candidate.handle,
                    "blog_name": candidate.blog_name,
                    "body_html": candidate.html,
                    "summary": candidate.summary,
                    "meta_title": candidate.meta_title,
                    "meta_description": candidate.meta_description,
                    "author": candidate.author,
                    "reviewer": candidate.reviewer,
                    "related_products": [candidate.related_product_title],
                    "tags": candidate.tags,
                    "status": status,
                    "scheduled_at": scheduled.isoformat() if scheduled else None,
                    "published_at": (
                        article.get("publishedAt") if status == "published" else None
                    ),
                    "published_url": (
                        f"/blogs/{blog_name}/{candidate.handle}"
                        if item.mode != "draft"
                        else None
                    ),
                    "shopify_gid": article.get("id"),
                    "shopify_kind": "Article",
                    "publish_key": candidate.publish_key or item.publishKey,
                    "source_file": candidate.source_file,
                    "source_index": candidate.source_index,
                    "mode": item.mode,
                }
            )

            results.append(
                PublishResultItem(
                    candidateTempId=item.candidateTempId,
                    status=status,
                    title=candidate.title,
                    scheduledAt=scheduled.isoformat() if scheduled else None,
                    publishedUrl=(
                        f"/blogs/{blog_name}/{candidate.handle}"
                        if item.mode != "draft"
                        else None
                    ),
                    shopifyId=article.get("id"),
                    coverImageSlot=candidate.cover_image_slot,
                    relatedProduct=candidate.related_product_title,
                    reviewer=candidate.reviewer,
                )
            )

        except (PublishError, ShopifyError) as error:
            record_publish_result(
                {
                    "status": "failed",
                    "publish_key": item.publishKey,
                    "channel_id": item.channelId,
                    "title": item.title,
                    "handle": item.handle,
                    "error": str(error),
                    "json_file": item.sourceFile,
                    "mode": item.mode,
                }
            )
            _persist(
                {
                    "channel_id": item.channelId,
                    "content_type": "blog_article",
                    "title": item.title or "",
                    "handle": item.handle or "",
                    "blog_name": item.blogName,
                    "body_html": item.bodyHtml or "",
                    "summary": item.summary,
                    "meta_title": item.metaTitle,
                    "meta_description": item.metaDescription,
                    "author": item.author,
                    "reviewer": item.reviewer,
                    "tags": item.tags,
                    "status": "failed",
                    "scheduled_at": item.scheduledAt,
                    "error": str(error),
                    "publish_key": item.publishKey,
                    "source_file": item.sourceFile,
                    "source_index": item.sourceIndex,
                    "mode": item.mode,
                }
            )
            results.append(
                PublishResultItem(
                    candidateTempId=item.candidateTempId,
                    status="failed",
                    title=item.title or item.handle or "(未命名)",
                    error=str(error),
                )
            )

    return PublishResponse(
        ok=all(result.status != "failed" for result in results), items=results
    )


def _parse_scheduled_at(item: PublishItemIn) -> datetime | None:
    """解析前端传来的排期时间（带时区偏移的 ISO 8601）。"""
    if not item.scheduledAt:
        if item.mode == "schedule":
            raise PublishError("定时发布缺少 scheduledAt。")
        return None

    try:
        value = datetime.fromisoformat(item.scheduledAt.replace("Z", "+00:00"))
    except ValueError as error:
        raise PublishError(
            f"scheduledAt 不是有效的 ISO 8601 时间：{item.scheduledAt}"
        ) from error

    if value.tzinfo is None:
        raise PublishError(
            "scheduledAt 必须带时区偏移（例如 2026-09-15T09:30:00-05:00），"
            "否则无法判断真实发布时间。"
        )
    return value


def _persist(record: dict[str, Any]) -> None:
    """把发布结果写进本地库。

    落库失败**不影响**已经完成的发布（Shopify 上的对象已经创建了），
    但要留下痕迹 —— 否则仪表盘会静默变空。
    """
    try:
        store.upsert(record)
    except Exception as error:  # pragma: no cover - 只在磁盘/权限异常时触发
        logging.warning("写入内容库失败：%s｜记录：%s", error, record.get("publish_key"))


async def _inject_vs_resources(
    payload: Any, spec: Any, *, fetch_covers: bool
) -> bool:
    """对声明了 COMPARE 标记的栏目（VS）注入资源区块。返回是否注入。"""
    if "RESOURCES" not in (spec.required_marker_pairs or ()):
        return False

    payload.body_html, note = await inject_resources(
        payload.title, payload.body_html, fetch_covers=fetch_covers
    )
    payload.resource_note = note
    return True


async def _publish_page(item: PublishItemIn, now: datetime) -> PublishResultItem:
    """发布一条页面（社区 / Discord / 用户故事 / VS / MakerWorld）。

    与 `publish_community_pages.py` 对齐：按 handle 判断创建或更新，
    `pageUpdate` 后单独补 `metafieldsSet`，并做写回校验。
    """
    try:
        spec = get_page_spec(item.channelId)
        if spec is None:
            raise PagePublishError(
                f"栏目「{item.channelId}」没有页面发布规格。"
                "需要在 page_publisher.py 的 PAGE_CHANNEL_SPECS 里登记模板与来源 metafield。"
            )

        # 来源键：前端识别到的优先，其次栏目规格里的固定键
        resolved_source_key = item.sourceKey or spec.source_key

        raw: dict[str, Any] = {
            "title": item.title,
            "meta_title": item.metaTitle,
            "meta_description": item.metaDescription,
            # MakerWorld 的 summary 是独立必填字段（会成为 custom.maker_summary）
            "summary": item.summary,
            "url": item.handle,
            "template": item.template,
            "html": item.bodyHtml,
            "related_products": item.relatedProducts or [],
            "published": item.mode != "draft",
        }
        if resolved_source_key and item.source:
            raw[resolved_source_key] = item.source

        payload_page = build_page_payload(
            raw,
            channel_id=item.channelId,
            spec=spec,
            source_file=item.sourceFile or "",
        )

        # VS 栏目需要先把资源库里的视频/文章注入 RESOURCES 区块，
        # 再对注入结果做校验（校验见到的是最终要发布的 HTML）。
        # 发布时抓真实 og:image；抓不到就报错，不发布半成品。
        if await _inject_vs_resources(payload_page, spec, fetch_covers=True):
            pass

        # 与脚本一致的硬校验
        errors = validate_page_payload(payload_page, spec)
        if errors:
            raise PagePublishError("；".join(errors))

        scheduled = _parse_scheduled_at(item)
        if item.mode == "schedule" and scheduled is not None and scheduled <= now:
            raise PagePublishError(
                "发布时间已经过去，为避免内容立即公开，本次未发布该条："
                f"{scheduled.isoformat()}"
            )

        publisher_page = PagePublisher()
        page, action = await publisher_page.publish(
            payload_page,
            spec,
            mode=item.mode,
            publish_at=scheduled if item.mode == "schedule" else None,
        )

        status = {
            "now": "published",
            "schedule": "scheduled",
            "draft": "draft",
        }[item.mode]

        record_publish_result(
            {
                "status": "success",
                "publish_key": item.publishKey,
                "page_id": page.get("id"),
                "channel_id": item.channelId,
                "title": payload_page.title,
                "handle": payload_page.handle,
                "template": payload_page.template_suffix,
                "scheduled_at": scheduled.isoformat() if scheduled else None,
                "action": action,
                "json_file": payload_page.source_file,
                "mode": item.mode,
            }
        )

        _persist(
            {
                "channel_id": item.channelId,
                "content_type": "page",
                "title": payload_page.title,
                "handle": payload_page.handle,
                "template": payload_page.template_suffix,
                "body_html": payload_page.body_html,
                "summary": payload_page.summary,
                "meta_title": payload_page.meta_title,
                "meta_description": payload_page.meta_description,
                "status": status,
                "scheduled_at": scheduled.isoformat() if scheduled else None,
                "published_at": (
                    page.get("publishedAt") if status == "published" else None
                ),
                "published_url": None if item.mode == "draft" else public_url,
                "shopify_gid": page.get("id"),
                "shopify_kind": "Page",
                "publish_key": item.publishKey,
                "source_file": item.sourceFile,
                "source_index": item.sourceIndex,
                "mode": item.mode,
            }
        )

        public_url = full_page_url(payload_page.handle)

        # 可选反链：页面发布成功后，往一篇已有博客文章追加幂等上下文反链。
        # 反链失败不回滚页面（页面本身是成功的），但要把原因报出来。
        backlink_result: str | None = None
        backlink_error: str | None = None
        if item.backlink:
            try:
                config = load_backlink({"backlink": item.backlink})
                if config is not None:
                    backlink_result = await BacklinkRunner().ensure(
                        page_handle=payload_page.handle,
                        page_url=public_url,
                        backlink=config,
                    )
                    if backlink_result:
                        record_publish_result(
                            {
                                "status": "success",
                                "publish_key": item.publishKey,
                                "channel_id": item.channelId,
                                "title": payload_page.title,
                                "handle": payload_page.handle,
                                "backlink": backlink_result,
                                "backlink_article": config.article_url,
                            }
                        )
            except BacklinkError as error:
                backlink_error = str(error)

        return PublishResultItem(
            candidateTempId=item.candidateTempId,
            status=status,
            title=payload_page.title,
            scheduledAt=scheduled.isoformat() if scheduled else None,
            publishedUrl=None if item.mode == "draft" else public_url,
            shopifyId=page.get("id"),
            backlinkResult=backlink_result,
            backlinkError=backlink_error,
        )

    except (PagePublishError, BacklinkError, ShopifyError) as error:
        record_publish_result(
            {
                "status": "failed",
                "publish_key": item.publishKey,
                "channel_id": item.channelId,
                "title": item.title,
                "handle": item.handle,
                "error": str(error),
                "json_file": item.sourceFile,
                "mode": item.mode,
            }
        )
        _persist(
            {
                "channel_id": item.channelId,
                "content_type": "page",
                "title": item.title or "",
                "handle": item.handle or "",
                "template": item.template,
                "body_html": item.bodyHtml or "",
                "meta_title": item.metaTitle,
                "meta_description": item.metaDescription,
                "status": "failed",
                "scheduled_at": item.scheduledAt,
                "error": str(error),
                "publish_key": item.publishKey,
                "source_file": item.sourceFile,
                "source_index": item.sourceIndex,
                "mode": item.mode,
            }
        )
        return PublishResultItem(
            candidateTempId=item.candidateTempId,
            status="failed",
            title=item.title or item.handle or "(未命名)",
            error=str(error),
        )


@app.get("/api/debug/token")
async def debug_token() -> dict[str, Any]:
    """排查用：只返回掩码与有效期，不返回明文。"""
    snapshot = token_manager.snapshot()
    return {
        **snapshot.to_dict(),
        "hasClientCredentials": app_config.env.has_client_credentials,
        "clientId": app_config.env.shopify_client_id or None,
        "shopDomain": app_config.resolved_shop_domain(),
        "maskPreview": mask_token(app_config.env.shopify_access_token),
    }
