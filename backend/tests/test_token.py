"""令牌管理测试。

重点覆盖「24 小时有效期」带来的行为，这些是最容易出隐性 bug 的地方：
提前续期、并发去重、5xx 重试、4xx 不重试、密钥不外泄。
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.shopify.token import (
    REFRESH_MARGIN_SECONDS,
    Credentials,
    TokenAuthError,
    TokenConfigError,
    TokenManager,
    TokenTransientError,
    mask_token,
)

OAUTH_PATH = "/admin/oauth/access_token"


def make_credentials(**overrides) -> Credentials:
    base = dict(
        source="auto",
        shop_domain="example.myshopify.com",
        client_id="client-id-123",
        client_secret="shpss_super_secret_value",
        static_token="",
        manual_token="",
    )
    base.update(overrides)
    return Credentials(**base)


class Recorder:
    """记录请求并提供可编程响应。"""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if not self.responses:
            raise AssertionError(f"收到意料之外的请求：{request.url}")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    @property
    def call_count(self) -> int:
        return len(self.requests)


def token_response(
    token: str = "shpat_abcdefghijklmnop1234",
    expires_in: int | None = 86399,
    scope: str = "read_content,write_content",
) -> httpx.Response:
    body = {"access_token": token, "scope": scope}
    if expires_in is not None:
        body["expires_in"] = expires_in
    return httpx.Response(200, json=body)


def build_manager(recorder: Recorder, **kwargs) -> TokenManager:
    def factory() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(recorder.handler))

    async def no_sleep(_seconds: float) -> None:
        return None

    return TokenManager(
        credentials_provider=lambda: make_credentials(),
        client_factory=factory,
        sleeper=no_sleep,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# 掩码
# ---------------------------------------------------------------------------


def test_mask_token_keeps_head_and_tail():
    masked = mask_token("shpat_abcdefghijklmnop1234")
    assert masked == "shpat_abcd****1234"
    assert "efghijklmnop" not in masked


def test_mask_token_hides_short_values_entirely():
    assert mask_token("short") == "*****"
    assert mask_token("") is None
    assert mask_token(None) is None


# ---------------------------------------------------------------------------
# auto：换取与缓存
# ---------------------------------------------------------------------------


async def test_fetches_token_and_caches_it():
    recorder = Recorder([token_response()])
    manager = build_manager(recorder)

    first = await manager.get_token()
    second = await manager.get_token()

    assert first == "shpat_abcdefghijklmnop1234"
    assert second == first
    # 第二次应命中缓存，不再请求
    assert recorder.call_count == 1


async def test_sends_client_credentials_payload():
    recorder = Recorder([token_response()])
    manager = build_manager(recorder)

    await manager.get_token()

    request = recorder.requests[0]
    assert request.url.path == OAUTH_PATH
    assert request.url.host == "example.myshopify.com"
    body = request.read().decode()
    # httpx 默认发紧凑 JSON（无空格）
    assert '"grant_type":"client_credentials"' in body
    assert '"read_content,write_content"' in body


async def test_records_expiry_from_expires_in():
    recorder = Recorder([token_response(expires_in=86399)])
    manager = build_manager(recorder)

    await manager.get_token()
    snapshot = manager.snapshot()

    assert snapshot.source == "auto"
    assert snapshot.has_token is True
    assert snapshot.masked == "shpat_abcd****1234"
    # 刚拿到时应接近 86399 秒，且不应被认为快过期
    assert 86000 < snapshot.expires_in_seconds <= 86399
    assert snapshot.is_expiring_soon is False
    assert snapshot.is_expired is False
    assert snapshot.scope == "read_content,write_content"


async def test_refreshes_proactively_when_close_to_expiry():
    """核心行为：距过期不足安全边距时，下一次取用应自动换新。"""
    recorder = Recorder(
        [
            token_response(token="shpat_old_token_aaaa1111", expires_in=60),
            token_response(token="shpat_new_token_bbbb2222", expires_in=86399),
        ]
    )
    manager = build_manager(recorder)

    first = await manager.get_token()
    second = await manager.get_token()

    assert first == "shpat_old_token_aaaa1111"
    # 60 秒 < 30 分钟安全边距 → 应已换成新 token
    assert second == "shpat_new_token_bbbb2222"
    assert recorder.call_count == 2


async def test_does_not_refresh_while_comfortably_valid():
    recorder = Recorder([token_response(expires_in=REFRESH_MARGIN_SECONDS + 600)])
    manager = build_manager(recorder)

    await manager.get_token()
    await manager.get_token()

    assert recorder.call_count == 1


async def test_force_refresh_ignores_cache():
    recorder = Recorder(
        [
            token_response(token="shpat_first_token_aaa1111"),
            token_response(token="shpat_second_token_bbb2222"),
        ]
    )
    manager = build_manager(recorder)

    await manager.get_token()
    refreshed = await manager.get_token(force_refresh=True)

    assert refreshed == "shpat_second_token_bbb2222"
    assert recorder.call_count == 2


async def test_concurrent_callers_share_one_fetch():
    """并发发布时只换一次 token，避免把换 token 接口打爆。"""
    recorder = Recorder([token_response()])
    manager = build_manager(recorder)

    results = await asyncio.gather(*(manager.get_token() for _ in range(8)))

    assert len(set(results)) == 1
    assert recorder.call_count == 1


async def test_missing_expires_in_still_works():
    """没有 expires_in 时不假设永久有效，交给 401 自愈兜底。"""
    recorder = Recorder([token_response(expires_in=None)])
    manager = build_manager(recorder)

    token = await manager.get_token()
    snapshot = manager.snapshot()

    assert token.startswith("shpat_")
    assert snapshot.expires_at is None
    assert snapshot.expires_in_seconds is None
    assert snapshot.never_expires is False


# ---------------------------------------------------------------------------
# auto：失败路径
# ---------------------------------------------------------------------------


async def test_retries_on_5xx_then_succeeds():
    recorder = Recorder(
        [
            httpx.Response(500, text="internal error"),
            httpx.Response(502, text="bad gateway"),
            token_response(),
        ]
    )
    manager = build_manager(recorder)

    token = await manager.get_token()

    assert token.startswith("shpat_")
    assert recorder.call_count == 3


async def test_gives_up_after_max_attempts_of_5xx():
    recorder = Recorder([httpx.Response(503, text="unavailable")] * 3)
    manager = build_manager(recorder)

    with pytest.raises(TokenTransientError) as excinfo:
        await manager.get_token()

    assert recorder.call_count == 3
    assert "重试 3 次" in str(excinfo.value)


async def test_4xx_is_not_retried_and_is_actionable():
    recorder = Recorder([httpx.Response(401, text="invalid client")])
    manager = build_manager(recorder)

    with pytest.raises(TokenAuthError) as excinfo:
        await manager.get_token()

    assert recorder.call_count == 1
    assert "HTTP 401" in str(excinfo.value)


async def test_error_body_never_leaks_client_secret():
    """Shopify 若在错误里回显密钥，必须被替换掉。"""
    recorder = Recorder(
        [httpx.Response(400, text='{"error":"bad secret shpss_super_secret_value"}')]
    )
    manager = build_manager(recorder)

    with pytest.raises(TokenAuthError) as excinfo:
        await manager.get_token()

    message = str(excinfo.value)
    assert "shpss_super_secret_value" not in message
    assert "shpss_supe****alue" in message


async def test_network_error_is_retried():
    recorder = Recorder(
        [
            httpx.ConnectError("connection refused"),
            token_response(),
        ]
    )
    manager = build_manager(recorder)

    assert (await manager.get_token()).startswith("shpat_")
    assert recorder.call_count == 2


async def test_missing_client_credentials_raises_config_error():
    def factory() -> httpx.AsyncClient:
        raise AssertionError("不该发起请求")

    manager = TokenManager(
        credentials_provider=lambda: make_credentials(
            client_id="", client_secret=""
        ),
        client_factory=factory,
    )

    with pytest.raises(TokenConfigError) as excinfo:
        await manager.get_token()

    assert "CLIENT_SECRET" in str(excinfo.value)


async def test_missing_shop_domain_raises_config_error():
    manager = TokenManager(
        credentials_provider=lambda: make_credentials(shop_domain=""),
        client_factory=lambda: httpx.AsyncClient(),
    )

    with pytest.raises(TokenConfigError) as excinfo:
        await manager.get_token()

    assert "店铺域名" in str(excinfo.value)


async def test_non_json_response_is_explained():
    recorder = Recorder([httpx.Response(200, text="<html>not json</html>")])
    manager = build_manager(recorder)

    with pytest.raises(Exception) as excinfo:
        await manager.get_token()

    assert "不是有效 JSON" in str(excinfo.value)


# ---------------------------------------------------------------------------
# env / manual
# ---------------------------------------------------------------------------


async def test_env_source_returns_static_token_without_network():
    def factory() -> httpx.AsyncClient:
        raise AssertionError("env 模式不应发起网络请求")

    manager = TokenManager(
        credentials_provider=lambda: make_credentials(
            source="env", static_token="shpat_static_token_zzzz9999"
        ),
        client_factory=factory,
    )

    token = await manager.get_token()
    snapshot = manager.snapshot()

    assert token == "shpat_static_token_zzzz9999"
    assert snapshot.source == "env"
    # 静态 token 无从得知过期时间，标记为长期有效
    assert snapshot.never_expires is True
    assert snapshot.expires_in_seconds is None


async def test_env_source_without_token_raises_actionable_error():
    manager = TokenManager(
        credentials_provider=lambda: make_credentials(source="env", static_token=""),
        client_factory=lambda: httpx.AsyncClient(),
    )

    with pytest.raises(TokenConfigError) as excinfo:
        await manager.get_token()

    assert "SHOPIFY_ACCESS_TOKEN" in str(excinfo.value)


async def test_manual_source_returns_stored_token():
    manager = TokenManager(
        credentials_provider=lambda: make_credentials(
            source="manual", manual_token="shpat_manual_token_yyyy8888"
        ),
        client_factory=lambda: httpx.AsyncClient(),
    )

    assert await manager.get_token() == "shpat_manual_token_yyyy8888"
    assert manager.snapshot().source == "manual"


async def test_manual_source_without_token_raises_actionable_error():
    manager = TokenManager(
        credentials_provider=lambda: make_credentials(source="manual", manual_token=""),
        client_factory=lambda: httpx.AsyncClient(),
    )

    with pytest.raises(TokenConfigError) as excinfo:
        await manager.get_token()

    assert "手动输入" in str(excinfo.value)


# ---------------------------------------------------------------------------
# 缓存作废（401 自愈的基础）
# ---------------------------------------------------------------------------


async def test_invalidate_forces_next_call_to_refetch():
    recorder = Recorder(
        [
            token_response(token="shpat_first_token_aaa1111"),
            token_response(token="shpat_second_token_bbb2222"),
        ]
    )
    manager = build_manager(recorder)

    await manager.get_token()
    await manager.invalidate()
    token = await manager.get_token()

    assert token == "shpat_second_token_bbb2222"
    assert recorder.call_count == 2


def test_snapshot_before_any_fetch_is_safe():
    manager = TokenManager(
        credentials_provider=lambda: make_credentials(),
        client_factory=lambda: httpx.AsyncClient(),
    )

    snapshot = manager.snapshot()

    assert snapshot.source == "auto"
    assert snapshot.has_token is False
    assert snapshot.expires_in_seconds is None


async def test_expired_token_reported_in_snapshot():
    """直接构造一个已过期的缓存，确认状态判断正确。"""
    recorder = Recorder([token_response(expires_in=1)])
    manager = build_manager(recorder, margin_seconds=0)

    await manager.get_token()
    # 把过期时间手动挪到过去
    manager._cached.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)

    snapshot = manager.snapshot()
    assert snapshot.is_expired is True
    assert snapshot.expires_in_seconds == 0
