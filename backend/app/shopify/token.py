"""Shopify Admin API 令牌管理。

## 为什么需要这一层

参考代码用 `client_credentials` 换到的 `shpat_` **只有约 24 小时有效期**
（Shopify 返回 `expires_in: 86399`）。这意味着 token 不是配置，而是**派生凭据**：

    长期凭据  client_id + client_secret   →  不变，放 .env
    短期凭据  access_token                →  24h，内存缓存 + 自动续期

如果把换来的 token 当长期配置用（写进 .env 或数据库），就会变成
「今天能用，明天某个不确定的时刻突然 401」——这是最难排查的一类故障。

## 三道保险

1. **提前刷新**：距过期不足 `REFRESH_MARGIN_SECONDS` 就先换新的，
   而不是等到请求失败才发现。
2. **并发去重**：`asyncio.Lock` 保证同一时刻只有一个刷新请求，
   避免并发发布时把换 token 接口打爆。
3. **401 自愈**：万一还是撞上 401（时钟偏差、Shopify 提前作废等），
   认证客户端会 `invalidate()` 后重试一次原请求（见 client.py）。

## 三种来源（token_source）

| 值 | 含义 | 是否自动续期 |
|---|---|---|
| `auto`   | client_credentials 换发（推荐） | ✅ 到期前自动换 |
| `env`    | `.env` 里的静态 token（自定义应用长期 token） | ❌ 不会过期，但换了要手动改 |
| `manual` | 界面里手动粘贴的 token | ⚠️ 若粘的是 24h token，明天就会失效 |

注：已排期文章由 Shopify 自己到点上线，**不需要 token**；
只有「现在就要发」和「状态回写」才依赖它。
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal

import httpx

from .. import config as app_config

TokenSource = Literal["auto", "env", "manual"]

# 距过期不足这个时长就提前换新（30 分钟）
REFRESH_MARGIN_SECONDS = 30 * 60
# 换 token 失败时的重试次数（仅针对 5xx / 网络抖动）
MAX_ATTEMPTS = 3
REQUEST_TIMEOUT = 60.0
MANUAL_TOKEN_FILE = app_config.DATA_DIR / "manual_token.json"


# ---------------------------------------------------------------------------
# 错误
# ---------------------------------------------------------------------------


class TokenError(RuntimeError):
    """令牌获取失败（面向用户的最终错误）。"""


class TokenConfigError(TokenError):
    """配置缺失 / 矛盾，改配置就能解决。"""


class TokenTransientError(TokenError):
    """Shopify 临时故障（5xx / 网络），已自动重试仍失败。"""


class TokenAuthError(TokenError):
    """client_id / client_secret 被拒绝（4xx）。"""


# ---------------------------------------------------------------------------
# 掩码
# ---------------------------------------------------------------------------


def mask_token(token: str | None) -> str | None:
    """脱敏展示：保留前 10 位与后 4 位。

    **任何日志、接口响应、异常消息都不允许出现完整 token。**
    """
    if not token:
        return None
    if len(token) <= 14:
        return "*" * len(token)
    return f"{token[:10]}****{token[-4:]}"


def _redact(text: str, secrets: list[str]) -> str:
    """把响应体里可能回显的密钥替换掉，避免顺着错误信息泄露。"""
    for secret in secrets:
        if secret and len(secret) >= 8 and secret in text:
            text = text.replace(secret, mask_token(secret) or "****")
    return text


# ---------------------------------------------------------------------------
# 手动 token 存储（单独文件 + 0600 权限）
# ---------------------------------------------------------------------------


class ManualTokenStore:
    """`manual` 模式下用户粘贴的 token。

    刻意与 settings.json 分开，并把文件权限收紧到 0600：
    唯一需要落盘的机密只放在一个地方，便于审计与清理。
    """

    def __init__(self, path: Path = MANUAL_TOKEN_FILE) -> None:
        self._path = path

    def read(self) -> str:
        if not self._path.exists():
            return ""
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return ""
        token = raw.get("access_token") if isinstance(raw, dict) else None
        return str(token) if token else ""

    def write(self, token: str) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps({"access_token": token}, ensure_ascii=False), encoding="utf-8"
        )
        # 只允许当前用户读写
        os.chmod(self._path, 0o600)

    def clear(self) -> None:
        if self._path.exists():
            self._path.unlink()


manual_token_store = ManualTokenStore()


# ---------------------------------------------------------------------------
# 凭据与快照
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Credentials:
    source: TokenSource
    shop_domain: str
    client_id: str = ""
    client_secret: str = ""
    static_token: str = ""
    manual_token: str = ""

    @property
    def secrets(self) -> list[str]:
        return [value for value in (self.client_secret, self.static_token, self.manual_token) if value]


def load_credentials() -> Credentials:
    """从环境变量 + 运行时设置组装当前生效的凭据。"""
    return Credentials(
        source=app_config.resolved_token_source(),
        shop_domain=app_config.resolved_shop_domain(),
        client_id=app_config.env.shopify_client_id,
        client_secret=app_config.env.shopify_client_secret,
        static_token=app_config.env.shopify_access_token,
        manual_token=manual_token_store.read(),
    )


@dataclass
class TokenSnapshot:
    """给界面看的令牌状态（永不含明文）。"""

    source: TokenSource
    masked: str | None = None
    has_token: bool = False
    expires_at: datetime | None = None
    scope: str | None = None
    last_refreshed_at: datetime | None = None
    # env 模式的静态 token 无从得知过期时间，标记为「长期有效」
    never_expires: bool = False
    error: str | None = None

    @property
    def expires_in_seconds(self) -> int | None:
        if self.never_expires or self.expires_at is None:
            return None
        delta = self.expires_at - datetime.now(timezone.utc)
        return max(0, int(delta.total_seconds()))

    @property
    def is_expired(self) -> bool:
        remaining = self.expires_in_seconds
        return remaining is not None and remaining <= 0

    @property
    def is_expiring_soon(self) -> bool:
        remaining = self.expires_in_seconds
        return remaining is not None and 0 < remaining <= REFRESH_MARGIN_SECONDS

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "accessTokenMasked": self.masked,
            "hasAccessToken": self.has_token,
            "tokenExpiresAt": self.expires_at.isoformat() if self.expires_at else None,
            "tokenExpiresInSeconds": self.expires_in_seconds,
            "tokenScope": self.scope,
            "tokenLastRefreshedAt": (
                self.last_refreshed_at.isoformat() if self.last_refreshed_at else None
            ),
            "tokenNeverExpires": self.never_expires,
            "tokenError": self.error,
        }


@dataclass
class _Cached:
    token: str
    source: TokenSource
    expires_at: datetime | None
    scope: str | None
    refreshed_at: datetime
    never_expires: bool = False

    def is_usable(self, margin_seconds: int = REFRESH_MARGIN_SECONDS) -> bool:
        if self.never_expires or self.expires_at is None:
            return True
        return self.expires_at - timedelta(seconds=margin_seconds) > datetime.now(
            timezone.utc
        )


# ---------------------------------------------------------------------------
# 令牌管理器
# ---------------------------------------------------------------------------

ClientFactory = Callable[[], httpx.AsyncClient]


def _default_client_factory() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=REQUEST_TIMEOUT)


class TokenManager:
    def __init__(
        self,
        credentials_provider: Callable[[], Credentials] = load_credentials,
        client_factory: ClientFactory = _default_client_factory,
        margin_seconds: int = REFRESH_MARGIN_SECONDS,
        max_attempts: int = MAX_ATTEMPTS,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._credentials_provider = credentials_provider
        self._client_factory = client_factory
        self._margin_seconds = margin_seconds
        self._max_attempts = max_attempts
        self._sleep = sleeper
        self._cached: _Cached | None = None
        self._lock = asyncio.Lock()
        self._last_error: str | None = None

    # ---------------- 对外 ----------------

    async def get_token(self, *, force_refresh: bool = False) -> str:
        """拿到可用的 token；必要时自动续期。"""
        async with self._lock:
            credentials = self._credentials_provider()

            if credentials.source == "env":
                return await self._token_from_env(credentials)

            if credentials.source == "manual":
                return self._token_from_manual(credentials)

            return await self._token_from_client_credentials(
                credentials, force_refresh=force_refresh
            )

    async def invalidate(self) -> None:
        """作废缓存，下次取用时强制换新。

        由认证客户端在收到 401 时调用，实现「401 自愈」。
        env / manual 模式没有可换的东西，仅清空缓存。
        """
        async with self._lock:
            self._cached = None

    def snapshot(self) -> TokenSnapshot:
        """当前令牌状态（不触发任何网络请求）。"""
        try:
            credentials = self._credentials_provider()
        except Exception as error:  # pragma: no cover - 配置层异常兜底
            return TokenSnapshot(source="auto", error=str(error))

        if credentials.source == "env":
            token = credentials.static_token
            return TokenSnapshot(
                source="env",
                masked=mask_token(token),
                has_token=bool(token),
                never_expires=bool(token),
                error=self._last_error,
            )

        if credentials.source == "manual":
            token = credentials.manual_token
            return TokenSnapshot(
                source="manual",
                masked=mask_token(token),
                has_token=bool(token),
                # 手动粘贴的 token 可能是 24h 的，无从判断 → 提示风险
                never_expires=False,
                error=self._last_error,
            )

        cached = self._cached
        if cached is None or cached.source != "auto":
            return TokenSnapshot(source="auto", error=self._last_error)

        return TokenSnapshot(
            source="auto",
            masked=mask_token(cached.token),
            has_token=True,
            expires_at=cached.expires_at,
            scope=cached.scope,
            last_refreshed_at=cached.refreshed_at,
            error=self._last_error,
        )

    # ---------------- 各来源实现 ----------------

    async def _token_from_env(self, credentials: Credentials) -> str:
        if not credentials.static_token:
            raise TokenConfigError(
                "token 来源为「环境变量」，但 .env 里没有 SHOPIFY_ACCESS_TOKEN。"
                "请填写该项，或把来源改为「自动续期」并配置 CLIENT_ID / CLIENT_SECRET。"
            )
        # 静态 token 直接返回，不缓存过期信息
        self._cached = _Cached(
            token=credentials.static_token,
            source="env",
            expires_at=None,
            scope=None,
            refreshed_at=datetime.now(timezone.utc),
            never_expires=True,
        )
        self._last_error = None
        return credentials.static_token

    def _token_from_manual(self, credentials: Credentials) -> str:
        if not credentials.manual_token:
            raise TokenConfigError(
                "token 来源为「手动输入」，但还没有保存过 token。"
                "请在全局设置里粘贴一个 shpat_ 开头的令牌。"
            )
        self._cached = _Cached(
            token=credentials.manual_token,
            source="manual",
            expires_at=None,
            scope=None,
            refreshed_at=datetime.now(timezone.utc),
            # 无法得知有效期，因此不能标记为永久——下次取用仍会读文件
        )
        self._last_error = None
        return credentials.manual_token

    async def _token_from_client_credentials(
        self, credentials: Credentials, *, force_refresh: bool
    ) -> str:
        if not credentials.shop_domain:
            raise TokenConfigError(
                "缺少店铺域名。请在全局设置里填写 xxx.myshopify.com。"
            )
        if not (credentials.client_id and credentials.client_secret):
            raise TokenConfigError(
                "token 来源为「自动续期」，但缺少 CLIENT_ID / CLIENT_SECRET。"
                "请在 .env 里配置 SHOPIFY_CLIENT_ID 与 SHOPIFY_CLIENT_SECRET。"
            )

        cached = self._cached
        if (
            not force_refresh
            and cached is not None
            and cached.source == "auto"
            and cached.token
            and cached.is_usable(self._margin_seconds)
        ):
            return cached.token

        return await self._fetch(credentials)

    async def _fetch(self, credentials: Credentials) -> str:
        url = f"https://{credentials.shop_domain}/admin/oauth/access_token"
        payload = {
            "client_id": credentials.client_id,
            "client_secret": credentials.client_secret,
            "grant_type": "client_credentials",
            "scopes": "read_content,write_content",
        }
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        last_transient: Exception | None = None

        for attempt in range(1, self._max_attempts + 1):
            try:
                async with self._client_factory() as client:
                    response = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as error:
                # 网络层抖动：可重试
                last_transient = TokenTransientError(
                    f"无法连接 Shopify（{type(error).__name__}: {error}）"
                )
                if attempt < self._max_attempts:
                    await self._sleep(2 * attempt)
                    continue
                break

            if 500 <= response.status_code < 600:
                last_transient = TokenTransientError(
                    f"Shopify 返回 HTTP {response.status_code}（临时故障）"
                )
                if attempt < self._max_attempts:
                    await self._sleep(2 * attempt)
                    continue
                break

            if response.status_code >= 400:
                body = _redact(response.text[:500], credentials.secrets)
                self._last_error = f"HTTP {response.status_code}: {body}"
                raise TokenAuthError(
                    f"换取 token 被拒绝（HTTP {response.status_code}）：{body}"
                )

            return self._store_response(response, credentials)

        message = (
            f"Shopify 临时故障，已自动重试 {self._max_attempts} 次仍失败。"
            "请稍后重试；若持续失败，请检查 CLIENT_ID / CLIENT_SECRET 是否仍然有效。"
        )
        self._last_error = message
        raise TokenTransientError(message) from last_transient

    def _store_response(self, response: httpx.Response, credentials: Credentials) -> str:
        try:
            data = response.json()
        except ValueError as error:
            raise TokenError(
                "换 token 的响应不是有效 JSON，可能是店铺域名写错了。"
            ) from error

        token = str(data.get("access_token") or "").strip()
        if not token:
            body = _redact(json.dumps(data, ensure_ascii=False)[:300], credentials.secrets)
            raise TokenError(f"响应里没有 access_token：{body}")

        expires_in = data.get("expires_in")
        try:
            expires_seconds = int(expires_in) if expires_in is not None else None
        except (TypeError, ValueError):
            expires_seconds = None

        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
            if expires_seconds
            else None
        )

        self._cached = _Cached(
            token=token,
            source="auto",
            expires_at=expires_at,
            scope=str(data.get("scope") or "") or None,
            refreshed_at=datetime.now(timezone.utc),
            # 拿不到 expires_in 时不能假设永久，但也没法主动续期 → 交给 401 自愈
            never_expires=False,
        )
        self._last_error = None
        return token


# 全局单例（FastAPI 依赖注入用）
token_manager = TokenManager()
