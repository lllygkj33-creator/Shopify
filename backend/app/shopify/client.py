"""Shopify Admin GraphQL 客户端。

职责：
  1. 每个请求自动附加当前有效 token（由 TokenManager 负责续期）
  2. **401 自愈**：收到 401 时作废缓存 token → 换新 → 重试原请求一次
     （token 有 24h 有效期，这是「最后一公里」的保险）
  3. 把 GraphQL 层错误（HTTP 200 但 body 里有 errors）也转成异常

参考实现：GEO/publish_articles.py 的 graphql_request()（明文可读）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

from .. import config as app_config
from .token import TokenManager, token_manager as default_token_manager


class ShopifyError(RuntimeError):
    """Shopify 调用失败的基类。"""


class ShopifyAuthError(ShopifyError):
    """认证失败（401）——通常意味着 token 无效或已过期。"""


class ShopifyGraphQLError(ShopifyError):
    """GraphQL 返回了 errors。"""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        self.errors = errors
        summary = "; ".join(
            str(item.get("message", item)) for item in errors
        )
        super().__init__(f"Shopify GraphQL 错误：{summary}")


class ShopifyHTTPError(ShopifyError):
    """4xx / 5xx 等 HTTP 层错误。"""

    def __init__(self, status_code: int, body: str) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"Shopify 返回 HTTP {status_code}：{body[:400]}")


@dataclass
class VerifyResult:
    ok: bool
    shop_name: str | None = None
    shop_domain: str | None = None
    scopes: list[str] = field(default_factory=list)
    missing_scopes: list[str] = field(default_factory=list)
    api_version: str | None = None
    error: str | None = None


# 与 GEO 可用脚本 check_access_scopes() 一致：
# 发布一篇文章需要内容读写 + metaobject（作者/审核人）+ 产品（关联产品）权限，
# 以及 files 读取权限之一（封面图）。
REQUIRED_SCOPES = (
    "read_content",
    "write_content",
    "read_metaobject_definitions",
    "read_metaobjects",
    "read_products",
)

# Shopify 的 files 查询接受以下任一读取权限
FILE_READ_SCOPES = ("read_files", "read_images", "read_themes")

VERIFY_QUERY = """
query VerifyConnection {
  shop {
    name
    myshopifyDomain
  }
  currentAppInstallation {
    accessScopes {
      handle
    }
  }
}
"""


def _default_client_factory() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=60.0)


def _default_endpoint_provider() -> tuple[str, str]:
    """(店铺域名, API 版本) —— 与设置页读的是同一份配置。"""
    return app_config.resolved_shop_domain(), app_config.resolved_api_version()


class ShopifyGraphQLClient:
    def __init__(
        self,
        token_manager: TokenManager | None = None,
        client_factory: Callable[[], httpx.AsyncClient] | None = None,
        endpoint_provider: Callable[[], tuple[str, str]] | None = None,
    ) -> None:
        self._tokens = token_manager or default_token_manager
        self._client_factory = client_factory or _default_client_factory
        # 域名与版本通过 provider 注入，而不是直接读全局配置：
        # 这样测试可以完全脱离环境变量，生产行为不变。
        self._endpoint_provider = endpoint_provider or _default_endpoint_provider

    # ---------------- 对外 ----------------

    async def execute(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
        *,
        api_version: str | None = None,
    ) -> dict[str, Any]:
        """执行 GraphQL 查询 / 变更，返回 data 部分。"""
        domain, configured_version = self._endpoint_provider()
        if not domain:
            raise ShopifyError("缺少店铺域名，请在全局设置里填写 xxx.myshopify.com")

        version = api_version or configured_version
        url = f"https://{domain}/admin/api/{version}/graphql.json"

        # 第一次尝试：用当前（可能已缓存）的 token
        response = await self._post(url, query, variables, await self._tokens.get_token())

        # 401 自愈：作废 token、换新、只重试一次
        if response.status_code == 401:
            await self._tokens.invalidate()
            fresh = await self._tokens.get_token(force_refresh=True)
            response = await self._post(url, query, variables, fresh)

            if response.status_code == 401:
                raise ShopifyAuthError(
                    "Shopify 拒绝了 access token（401）。已尝试自动续期仍失败——"
                    "若使用「环境变量」来源，该 token 可能已过期，"
                    "请改用「自动续期」（CLIENT_ID / CLIENT_SECRET），或更新 .env 里的 token。"
                )

        if response.status_code >= 400:
            raise ShopifyHTTPError(response.status_code, response.text)

        try:
            payload = response.json()
        except ValueError as error:
            raise ShopifyError("Shopify 返回的不是有效 JSON") from error

        errors = payload.get("errors")
        if errors:
            raise ShopifyGraphQLError(errors if isinstance(errors, list) else [errors])

        data = payload.get("data")
        if not isinstance(data, dict):
            raise ShopifyError(f"Shopify 响应缺少 data 字段：{str(payload)[:300]}")
        return data

    async def verify(self) -> VerifyResult:
        """连接自检：确认 token 可用，并核对内容相关权限。"""
        try:
            data = await self.execute(VERIFY_QUERY)
        except ShopifyAuthError as error:
            return VerifyResult(ok=False, error=str(error))
        except ShopifyError as error:
            return VerifyResult(ok=False, error=str(error))

        shop = data.get("shop") or {}
        installation = data.get("currentAppInstallation") or {}
        scopes = [
            str(item.get("handle"))
            for item in (installation.get("accessScopes") or [])
            if isinstance(item, dict) and item.get("handle")
        ]
        missing = [scope for scope in REQUIRED_SCOPES if scope not in scopes]
        if not set(scopes).intersection(FILE_READ_SCOPES):
            missing.append("read_files（或 read_images/read_themes）")

        return VerifyResult(
            ok=not missing,
            shop_name=shop.get("name"),
            shop_domain=shop.get("myshopifyDomain"),
            scopes=scopes,
            missing_scopes=missing,
            api_version=self._endpoint_provider()[1],
            error=(
                f"缺少权限：{', '.join(missing)}。"
                "发布文章需要内容读写、metaobject 读写、产品读取，"
                "以及 files 读取权限之一（封面图）。"
                if missing
                else None
            ),
        )

    # ---------------- 内部 ----------------

    async def _post(
        self,
        url: str,
        query: str,
        variables: dict[str, Any] | None,
        token: str,
    ) -> httpx.Response:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Shopify-Access-Token": token,
        }
        async with self._client_factory() as client:
            return await client.post(
                url, json={"query": query, "variables": variables or {}}, headers=headers
            )


shopify_client = ShopifyGraphQLClient()
