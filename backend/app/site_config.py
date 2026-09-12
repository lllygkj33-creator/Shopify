"""站点配置：所有「谁在部署」的值都从这里读。

## 为什么需要

代码里原本散落着真实域名（`shop.example-store.test`、`community.example-store.test`）、
品牌名、产品名、博客标题、主题模板名 —— 那些是**部署信息**，不是程序逻辑。
写死之后：仓库不能给别人用，一推公开仓库就把自己的店铺结构带出去了。

## 两层

| 文件 | 是否提交 | 内容 |
|---|---|---|
| `site.config.json` | ✅ 提交 | 通用占位值。克隆下来即可跑演示模式 |
| `site.config.local.json` | ❌ gitignore | 真实部署的值，深度覆盖上一层 |

深度合并（字典逐层合并，数组整体替换），所以本地只要写想改的那几项。
字符串里的 `${a.b}` 会按配置自身展开，用来避免同一域名写两遍。

## 用法

    from .site_config import site

    site.storefront_domain        # 'shop.example-store.test'
    site.first_party_suffixes     # ('example-store.test',)
    site.channels                 # 栏目表（含各自的 page 规格）
    site.channel('community-post')  # 取一个栏目，找不到抛 KeyError
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# 独立解析仓库根目录：不能 import app.config（那边的默认值又依赖本模块，会成环）
PROJECT_ROOT = Path(__file__).resolve().parents[2]
BASE_FILE = PROJECT_ROOT / "site.config.json"
LOCAL_FILE = PROJECT_ROOT / "site.config.local.json"

_TOKEN = re.compile(r"\$\{([A-Za-z0-9_.]+)\}")


def _deep_merge(base: Any, override: Any) -> Any:
    """字典逐层合并；其他类型（含数组）整体替换。

    带 `"$replace": true` 的字典**整体替换**上一层，而不是逐键合并。
    需要它的场景：占位值里有示例条目（例如资源库示例产品），
    逐键合并会把示例和真实值混在一起。
    """
    if isinstance(base, dict) and isinstance(override, dict):
        if override.get("$replace") is True:
            return {key: value for key, value in override.items() if key != "$replace"}
        merged = dict(base)
        for key, value in override.items():
            merged[key] = _deep_merge(base.get(key), value)
        return merged
    return override


class SiteConfig:
    def __init__(self, data: dict[str, Any]) -> None:
        # 先放原始数据：展开 ${a.b} 时要能查到值（单层展开，够用）
        self._data = data
        self._data = self._expand_tokens(data)

    # ---------------- 展开 ${a.b} ----------------

    def _lookup(self, path: str) -> str:
        node: Any = self._data
        for part in path.split("."):
            if not isinstance(node, dict) or part not in node:
                raise KeyError(
                    f"site.config.json 里的 ${{{path}}} 指不到任何值"
                )
            node = node[part]
        return str(node)

    def _expand_tokens(self, node: Any) -> Any:
        if isinstance(node, str):
            return _TOKEN.sub(lambda m: self._lookup(m.group(1)), node)
        if isinstance(node, list):
            return [self._expand_tokens(item) for item in node]
        if isinstance(node, dict):
            return {key: self._expand_tokens(value) for key, value in node.items()}
        return node

    # ---------------- 读取 ----------------

    @property
    def raw(self) -> dict[str, Any]:
        return self._data

    def get(self, path: str, default: Any = None) -> Any:
        node: Any = self._data
        for part in path.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    @property
    def brand_name(self) -> str:
        return str(self.get("brand.name", "Content Publisher"))

    @property
    def brand_subtitle(self) -> str:
        return str(self.get("brand.subtitle", ""))

    @property
    def storefront_domain(self) -> str:
        return str(self.get("storefront.domain", "shop.example.com"))

    @property
    def first_party_suffixes(self) -> tuple[str, ...]:
        return tuple(str(x) for x in (self.get("firstPartySuffixes") or []))

    @property
    def default_author(self) -> str:
        return str(self.get("defaults.author", ""))

    @property
    def default_reviewers(self) -> list[str]:
        return [str(x) for x in (self.get("defaults.reviewers") or [])]

    @property
    def related_products(self) -> list[str]:
        return [str(x) for x in (self.get("defaults.relatedProducts") or [])]

    @property
    def backlink_marker_prefix(self) -> str:
        return str(self.get("backlinkMarkerPrefix", "USER_STORY_BACKLINK"))

    @property
    def channels(self) -> list[dict[str, Any]]:
        return list(self.get("channels") or [])

    def channel(self, channel_id: str) -> dict[str, Any]:
        for channel in self.channels:
            if channel.get("id") == channel_id:
                return channel
        raise KeyError(f"site.config.json 里没有栏目 {channel_id!r}")

    def page_spec(self, channel_id: str) -> dict[str, Any] | None:
        return self.channel(channel_id).get("page")


def _load() -> SiteConfig:
    if not BASE_FILE.exists():
        raise FileNotFoundError(
            f"缺少站点配置 {BASE_FILE}。它是仓库自带的通用配置，"  # pragma: no cover
            "复制一份改自己的值即可。"
        )

    data = json.loads(BASE_FILE.read_text(encoding="utf-8"))

    # 本地覆盖：真实部署的域名/品牌/产品名放这里，不进仓库。
    # 用 is_file 而不是 exists：Docker 挂载一个**不存在**的文件时会建同名目录，
    # exists() 会为真、随后读目录报错；is_file() 能把它当作"没配"正常跳过。
    if LOCAL_FILE.is_file():
        data = _deep_merge(
            data, json.loads(LOCAL_FILE.read_text(encoding="utf-8"))
        )

    return SiteConfig(data)


site_config = _load()

# 简写，读起来更像配置而不是模块
site = site_config

__all__ = ["BASE_FILE", "LOCAL_FILE", "SiteConfig", "site", "site_config"]
