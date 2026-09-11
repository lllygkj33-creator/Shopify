"""后端配置。

两部分：
  1. **环境变量**（.env）—— 长期凭据与默认值，进程启动时读取。
     尤其是 client_id / client_secret：它们是唯一不变的东西，
     而 access_token 只是从它们派生出来的短期凭据（24 小时）。
  2. **运行时覆盖**（data/settings.json）—— 界面里改的值。
     先用 JSON 文件落地，等后端补齐数据层时再换成 SQLite（PRD §6）。

.env 的读取顺序：项目根目录 .env → backend/.env（后者可覆盖前者）。
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
RUNTIME_SETTINGS_FILE = DATA_DIR / "settings.json"

TokenSource = Literal["auto", "env", "manual"]


class EnvSettings(BaseSettings):
    """来自 .env / 系统环境变量的配置。"""

    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Shopify 连接 ---
    shopify_shop_domain: str = ""
    shopify_api_version: str = "2026-04"

    # --- 凭据 ---
    # 长期凭据：client_credentials 换发用（推荐）
    shopify_client_id: str = ""
    shopify_client_secret: str = ""
    # 短期凭据：可直接用的静态 token（自定义应用长期 token 才应放这里）
    shopify_access_token: str = ""

    # --- 默认值 ---
    # 统一为上海时区（店铺的 ianaTimezone 实测就是 Asia/Shanghai）
    default_timezone: str = "Asia/Shanghai"
    default_author: str = "ZimaSpace"

    # --- 后台对账 ---
    # 分钟；0 = 关闭。Shopify 到点会自己上线内容，本地只需定期对齐状态。
    sync_interval_minutes: int = 15

    # --- 服务 ---
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    # 允许前端 dev server 跨域访问
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://localhost:5177",
            "http://localhost:5178",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5177",
            "http://127.0.0.1:5178",
        ]
    )

    @field_validator("shopify_shop_domain", "shopify_access_token", mode="before")
    @classmethod
    def _strip(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value

    @property
    def has_client_credentials(self) -> bool:
        return bool(self.shopify_client_id and self.shopify_client_secret)

    @property
    def has_static_token(self) -> bool:
        return bool(self.shopify_access_token)


class RuntimeSettings:
    """界面里修改的设置，落在 data/settings.json。

    刻意**不存 access_token 明文**：
      - auto 模式：token 由 TokenManager 在内存里缓存并自动续期
      - env 模式：token 从环境变量读，从不落盘
      - manual 模式：确实需要存，但单独放在一个权限收紧的文件里（见 token_store）
    """

    _FIELDS = (
        "shop_domain",
        "template_choices",
        "last_sync_at",
        "api_version",
        "token_source",
        "default_author",
        "default_reviewers",
        "related_product_titles",
        "default_timezone",
        "default_publish_time",
    )

    def __init__(self, path: Path = RUNTIME_SETTINGS_FILE) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._data: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                self._data = {
                    key: value for key, value in raw.items() if key in self._FIELDS
                }
        except (json.JSONDecodeError, OSError):
            # 配置损坏时退回默认值，不让服务起不来
            self._data = {}

    def _persist(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(tmp, self._path)

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._data.get(key, default)

    def update(self, patch: dict[str, Any]) -> None:
        with self._lock:
            for key, value in patch.items():
                if key in self._FIELDS and value is not None:
                    self._data[key] = value
            self._persist()


_env = EnvSettings()
runtime = RuntimeSettings()


def get_effective(key: str, env_default: Any) -> Any:
    """运行时覆盖优先，其次环境变量，最后默认值。"""
    value = runtime.get(key)
    return env_default if value in (None, "") else value


def resolved_shop_domain() -> str:
    domain = get_effective("shop_domain", _env.shopify_shop_domain)
    domain = str(domain).strip().rstrip("/")
    for prefix in ("https://", "http://"):
        if domain.startswith(prefix):
            domain = domain[len(prefix) :]
    return domain


def resolved_api_version() -> str:
    return str(get_effective("api_version", _env.shopify_api_version)).strip()


def resolved_token_source() -> TokenSource:
    """token 来源。

    默认取 auto（只要配了 client_id/secret 就自动续期），
    因为这能避免「静态 token 悄悄过期」这类最难排查的故障。
    """
    source = runtime.get("token_source")
    if source in ("auto", "env", "manual"):
        return source
    if _env.has_client_credentials:
        return "auto"
    if _env.has_static_token:
        return "env"
    return "auto"


def resolved_timezone() -> str:
    return str(get_effective("default_timezone", _env.default_timezone)).strip()


def resolved_default_author() -> str:
    return str(get_effective("default_author", _env.default_author)).strip()


def resolved_default_reviewers() -> list[str]:
    value = runtime.get("default_reviewers")
    return [str(item) for item in value] if isinstance(value, list) else []


def resolved_related_products() -> list[str]:
    value = runtime.get("related_product_titles")
    return [str(item) for item in value] if isinstance(value, list) else []


# 已知的模板后缀（各栏目的参考脚本里核对过的），作为清单默认值
KNOWN_PAGE_TEMPLATES = (
    "community_post",
    "discord-page",
    "user-story",
    "nas-a-vs-b",
    "makerworld-page",
)


def touch_sync_state(key: str, value: str | None = None) -> None:
    """记录同步时间。"""
    from datetime import datetime, timezone

    runtime.update({key: value or datetime.now(timezone.utc).isoformat()})


def resolved_sync_state() -> dict[str, str | None]:
    return {
        "lastSyncAt": runtime.get("last_sync_at"),
    }


def resolved_sync_interval_minutes() -> int:
    """后台对账间隔（分钟）。0 = 关闭。"""
    value = runtime.get("sync_interval_minutes")
    if value is None:
        value = getattr(_env, "sync_interval_minutes", 15)
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 15


def resolved_template_choices() -> list[str]:
    """页面模板清单。

    - 用户在全局设置里维护过 → 用它
    - 否则用已知的 5 个栏目模板打底
    """
    value = runtime.get("template_choices")
    if isinstance(value, list):
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        if cleaned:
            return cleaned
    return list(KNOWN_PAGE_TEMPLATES)


def resolved_default_publish_time() -> str:
    value = runtime.get("default_publish_time")
    return str(value) if value else "09:30"


env = _env
