"""GraphQL 客户端测试：令牌注入、401 自愈、错误转换。"""

from __future__ import annotations

import httpx
import pytest

from app.shopify.client import (
    ShopifyAuthError,
    ShopifyGraphQLClient,
    ShopifyGraphQLError,
    ShopifyHTTPError,
)
from app.shopify.token import Credentials, TokenManager

GRAPHQL_PATH = "/admin/api/2026-04/graphql.json"


def make_credentials(**overrides) -> Credentials:
    base = dict(
        source="auto",
        shop_domain="example.myshopify.com",
        client_id="client-id-123",
        client_secret="shpss_secret_value",
        static_token="",
        manual_token="",
    )
    base.update(overrides)
    return Credentials(**base)


class Router:
    """按路径分发响应，并记录每个请求带的 token。"""

    def __init__(self, oauth_responses=None, graphql_responses=None):
        self.oauth_responses = list(oauth_responses or [])
        self.graphql_responses = list(graphql_responses or [])
        self.tokens_seen: list[str | None] = []
        self.graphql_calls = 0
        self.oauth_calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/graphql.json"):
            self.graphql_calls += 1
            self.tokens_seen.append(request.headers.get("X-Shopify-Access-Token"))
            if not self.graphql_responses:
                raise AssertionError("GraphQL 响应已用尽")
            return self.graphql_responses.pop(0)

        self.oauth_calls += 1
        if not self.oauth_responses:
            raise AssertionError("OAuth 响应已用尽")
        return self.oauth_responses.pop(0)


def oauth_ok(token: str, expires_in: int = 86399) -> httpx.Response:
    return httpx.Response(
        200, json={"access_token": token, "expires_in": expires_in, "scope": "read_content,write_content"}
    )


def build(router: Router, api_version: str = "2026-04"):
    def factory() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(router.handler))

    async def no_sleep(_seconds: float) -> None:
        return None

    tokens = TokenManager(
        credentials_provider=lambda: make_credentials(),
        client_factory=factory,
        sleeper=no_sleep,
    )
    client = ShopifyGraphQLClient(
        token_manager=tokens,
        client_factory=factory,
        endpoint_provider=lambda: ("example.myshopify.com", api_version),
    )
    return tokens, client


async def test_attaches_access_token_header():
    router = Router(
        oauth_responses=[oauth_ok("shpat_abc")],
        graphql_responses=[httpx.Response(200, json={"data": {"shop": {"name": "Zima"}}})],
    )
    _, client = build(router)

    data = await client.execute("{ shop { name } }")

    assert data["shop"]["name"] == "Zima"
    assert router.tokens_seen == ["shpat_abc"]


async def test_uses_configured_api_version_in_path():
    router = Router(
        oauth_responses=[oauth_ok("shpat_abc")],
        graphql_responses=[httpx.Response(200, json={"data": {}})],
    )
    _, client = build(router)

    await client.execute("{ shop { name } }")

    assert router.graphql_calls == 1


async def test_401_triggers_refresh_and_retry_once():
    """token 有 24h 有效期，这是「最后一公里」的保险。"""
    router = Router(
        oauth_responses=[
            oauth_ok("shpat_stale_token"),
            oauth_ok("shpat_fresh_token"),
        ],
        graphql_responses=[
            httpx.Response(401, text="Invalid API key or access token"),
            httpx.Response(200, json={"data": {"shop": {"name": "Zima"}}}),
        ],
    )
    _, client = build(router)

    data = await client.execute("{ shop { name } }")

    assert data["shop"]["name"] == "Zima"
    # 第一次带旧 token，401 后换新 token 重试
    assert router.tokens_seen == ["shpat_stale_token", "shpat_fresh_token"]
    assert router.oauth_calls == 2
    assert router.graphql_calls == 2


async def test_repeated_401_raises_actionable_auth_error():
    router = Router(
        oauth_responses=[oauth_ok("shpat_a"), oauth_ok("shpat_b")],
        graphql_responses=[
            httpx.Response(401, text="nope"),
            httpx.Response(401, text="nope"),
        ],
    )
    _, client = build(router)

    with pytest.raises(ShopifyAuthError) as excinfo:
        await client.execute("{ shop { name } }")

    message = str(excinfo.value)
    assert "自动续期仍失败" in message
    # 要给出可执行建议，而不是一句「401」
    assert "自动续期" in message
    assert router.graphql_calls == 2


async def test_graphql_errors_are_raised():
    router = Router(
        oauth_responses=[oauth_ok("shpat_abc")],
        graphql_responses=[
            httpx.Response(
                200,
                json={"errors": [{"message": "Field 'foo' doesn't exist"}]},
            )
        ],
    )
    _, client = build(router)

    with pytest.raises(ShopifyGraphQLError) as excinfo:
        await client.execute("{ foo }")

    assert "doesn't exist" in str(excinfo.value)


async def test_http_5xx_raises_http_error():
    router = Router(
        oauth_responses=[oauth_ok("shpat_abc")],
        graphql_responses=[httpx.Response(500, text="boom")],
    )
    _, client = build(router)

    with pytest.raises(ShopifyHTTPError) as excinfo:
        await client.execute("{ shop { name } }")

    assert excinfo.value.status_code == 500


async def test_verify_parses_shop_and_scopes():
    router = Router(
        oauth_responses=[oauth_ok("shpat_abc")],
        graphql_responses=[
            httpx.Response(
                200,
                json={
                    "data": {
                        "shop": {"name": "Demo Store", "myshopifyDomain": "your-store.myshopify.com"},
                        "currentAppInstallation": {
                            "accessScopes": [
                                {"handle": "read_content"},
                                {"handle": "write_content"},
                                {"handle": "read_metaobject_definitions"},
                                {"handle": "read_metaobjects"},
                                {"handle": "read_products"},
                                {"handle": "read_files"},
                            ]
                        },
                    }
                },
            )
        ],
    )
    _, client = build(router)

    result = await client.verify()

    assert result.ok is True
    assert result.shop_name == "Demo Store"
    assert result.shop_domain == "your-store.myshopify.com"
    assert "read_content" in result.scopes
    assert "read_files" in result.scopes
    assert result.missing_scopes == []


async def test_verify_flags_missing_write_scope():
    router = Router(
        oauth_responses=[oauth_ok("shpat_abc")],
        graphql_responses=[
            httpx.Response(
                200,
                json={
                    "data": {
                        "shop": {"name": "Demo Store"},
                        "currentAppInstallation": {
                            "accessScopes": [{"handle": "read_content"}]
                        },
                    }
                },
            )
        ],
    )
    _, client = build(router)

    result = await client.verify()

    assert result.ok is False
    # 内容写权限属于「阻断发布」的那一档
    assert any("write_content" in scope for scope in result.missing_scopes)
    # metaobject / products / files 只影响博客发布，归到第二档
    assert "read_metaobjects" in result.blog_missing_scopes
    assert "read_files（或 read_images/read_themes）" in result.blog_missing_scopes
    assert "write_content" in (result.error or "")


async def test_verify_reports_auth_failure_instead_of_raising():
    router = Router(
        oauth_responses=[oauth_ok("shpat_a"), oauth_ok("shpat_b")],
        graphql_responses=[httpx.Response(401, text="nope"), httpx.Response(401, text="nope")],
    )
    _, client = build(router)

    result = await client.verify()

    assert result.ok is False
    assert result.error
