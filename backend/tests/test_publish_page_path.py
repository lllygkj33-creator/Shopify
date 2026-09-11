"""页面发布路径 + 未预期异常的可见性。

两条都是**回归**用例，对应线上真实踩过的坑：

1. `_publish_page` 里 `public_url` 被用在赋值之前 —— 草稿走 `None if draft`
   分支所以没暴露，非草稿一发布就 `UnboundLocalError`。而这个异常不在
   `except (PagePublishError, BacklinkError, ShopifyError)` 里，于是穿透出整个
   发布循环：**一条出错整批 500**，用户上传 10 篇只成功了第 1 篇，
   界面上还只显示一句「无法连接后端」。

2. 未捕获异常产生的 500 由最外层 ServerErrorMiddleware 生成，**不带 CORS 头**，
   浏览器把它当跨域失败 —— 前端永远看不到真实错误。所以还要一条用例钉住
   「500 也带 CORS 头」。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import main
from app.site_config import site
from app.storage import ContentStore

# 模板名、来源前缀、前台域名都是**部署信息**，从配置取，测试不写死
COMMUNITY_SPEC = main.get_page_spec("community-post")
_PREFIXES = dict(COMMUNITY_SPEC.source_field_prefixes)
TOPIC_PREFIX = _PREFIXES["url"]
PROFILE_PREFIX = _PREFIXES["author_profile_url"]

NOW = datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc)


class FakePagePublisher:
    """只返回一个够用的 page 节点，不去碰 Shopify。"""

    action = "created"

    async def publish(self, payload, spec, *, mode, publish_at):
        return (
            {
                "id": "gid://shopify/Page/999",
                "handle": payload.handle,
                "publishedAt": None,
            },
            self.action,
        )


@pytest.fixture()
def store(tmp_path, monkeypatch) -> ContentStore:
    """换掉模块级 store 与历史写入，其余走真实代码。"""
    test_store = ContentStore(tmp_path / "publish.db")
    monkeypatch.setattr(main, "store", test_store)
    monkeypatch.setattr(main, "record_publish_result", lambda record: None)
    monkeypatch.setattr(main, "PagePublisher", FakePagePublisher)
    return test_store


def schedule_item(**overrides) -> main.PublishItemIn:
    """一条合规的 community-post 排期项（该栏目要求最少，fixture 最短）。"""
    base = {
        "candidateTempId": "c1",
        "channelId": "community-post",
        "contentType": "page",
        "mode": "schedule",
        "publishKey": "community-post|a.json|0|zimablade-tip",
        "scheduledAt": (NOW + timedelta(days=3)).isoformat(),
        "title": "ZimaBlade Tip",
        "handle": "zimablade-tip",
        "bodyHtml": "<div><h2>Fix</h2><p>Do the thing.</p></div>",
        "metaTitle": "ZimaBlade Tip",
        "metaDescription": "A short tip.",
        "template": COMMUNITY_SPEC.template,
        "sourceFile": "community-post/a.json",
        "source": {
            "title": "ZimaBlade Tip",
            "url": f"{TOPIC_PREFIX}zimablade-tip/1",
            "excerpt": "Do the thing.",
            "author_name": "someone",
            "author_avatar_url": f"{PROFILE_PREFIX.rstrip('/')}/../a.png",
            "author_profile_url": f"{PROFILE_PREFIX}someone",
        },
    }
    base.update(overrides)
    return main.PublishItemIn(**base)


@pytest.mark.anyio
async def test_publish_page_persists_published_url(store):
    """排期发布的页面必须落库并带上前台 URL。

    修复前这里直接 `UnboundLocalError: public_url`（赋值在 _persist 之后）。
    """
    result = await main._publish_page(schedule_item(), NOW)

    assert result.status == "scheduled"

    rows = store.list_contents()
    assert len(rows) == 1
    row = rows[0]
    assert row["status"] == "scheduled"
    assert row["shopify_gid"] == "gid://shopify/Page/999"
    assert row["published_url"] == (
        f"https://{site.storefront_domain}/pages/{row['handle']}"
    )


@pytest.mark.anyio
async def test_publish_reuses_row_that_sync_already_pulled(store):
    """同步先拉进来的行，平台发布时要落到**同一行**。

    实测场景：用户排期后重传同一批内容 —— 那条已经以 shopify-schedule 的
    身份在库里了，如果发布走 publish_key 再插一次，列表里会出现两条一样的。
    """
    store.upsert(
        {
            "channel_id": "community-post",
            "content_type": "page",
            "title": "同步拉来的标题",
            "handle": "zimablade-tip",
            "status": "scheduled",
            "scheduled_at": (NOW + timedelta(days=3)).isoformat(),
            "publish_key": "shopify-schedule|Page|gid://shopify/Page/999",
            "source_file": "shopify-schedule",
            "shopify_gid": "gid://shopify/Page/999",
            "shopify_kind": "Page",
        }
    )

    await main._publish_page(schedule_item(), NOW)

    rows = store.list_contents()
    assert len(rows) == 1, "同一个线上对象不能出现两行"
    # 身份是 GID，不是 publish_key：哪条路径先写，行就沿用哪个 key。
    assert rows[0]["publish_key"] == "shopify-schedule|Page|gid://shopify/Page/999"
    # 但出处以平台那条为准（它记着来自哪个 JSON），比 shopify-schedule 具体
    assert rows[0]["source_file"] == "community-post/a.json"
    assert rows[0]["status"] == "scheduled"


@pytest.mark.anyio
async def test_publish_page_draft_keeps_url_empty(store):
    """草稿不公开，URL 必须留空（否则会把没上线的页面显示成可点链接）。"""
    await main._publish_page(schedule_item(mode="draft", scheduledAt=None), NOW)

    assert store.list_contents()[0]["published_url"] is None


@pytest.mark.anyio
async def test_unexpected_error_is_recorded_as_that_item_failure(store, monkeypatch):
    """页面分支出未预期异常时，要记成**这一条**失败，不能整批炸掉。"""
    def boom(*args, **kwargs):
        raise ValueError("构造 payload 时炸了")

    monkeypatch.setattr(main, "build_page_payload", boom)

    result = await main._publish_page(schedule_item(), NOW)

    assert result.status == "failed"
    assert "平台内部错误（ValueError）" in (result.error or "")
    assert store.list_contents()[0]["status"] == "failed"


def test_unhandled_exception_returns_500_with_cors_header(monkeypatch):
    """未预期异常的 500 必须带 CORS 头，否则浏览器只会报「无法连接后端」。"""
    client = TestClient(main.app, raise_server_exceptions=False)
    client.get("/api/health")  # 确保 app 已完成启动

    @main.app.get("/__boom")
    async def boom():  # pragma: no cover - 只在测试里挂载
        raise RuntimeError("故意的")

    response = client.get("/__boom", headers={"Origin": "http://localhost:5177"})

    assert response.status_code == 500
    assert "平台内部错误（RuntimeError）" in response.json()["detail"]
    assert (
        response.headers.get("access-control-allow-origin")
        == "http://localhost:5177"
    )
