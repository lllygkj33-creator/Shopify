"""页面模板清单。

## 两个来源

1. **店铺主题**（首选）：`themes` → `theme.files`，取 `templates/page*.liquid`
   推导出 templateSuffix。**需要 `read_themes` 权限**。
2. **手动清单**（兜底）：全局设置里维护的列表。没有 `read_themes` 时使用。

做成双来源的原因：Shopify 对**不存在的 `templateSuffix` 是静默回退**到主题默认
模板，不报错。所以「模板名写错」是一种会静默失败的发布错误 —— 有个可选清单
能显著降低这种风险。而 `read_themes` 需要改应用权限，所以不能只依赖它。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .. import config as app_config
from .client import ShopifyError, ShopifyGraphQLClient, shopify_client

THEMES_QUERY = """
query ThemesForTemplates {
  themes(first: 10) {
    nodes { id name role }
  }
}
"""

THEME_FILES_QUERY = """
query ThemeFiles($id: ID!) {
  theme(id: $id) {
    files(first: 250) {
      nodes { filename }
    }
  }
}
"""

# templates/page.community_post.liquid → community_post
PAGE_TEMPLATE_PATTERN = re.compile(
    r"^templates/page\.([A-Za-z0-9_-]+)\.liquid$"
)


@dataclass
class TemplateList:
    source: str  # shopify | manual
    templates: list[str] = field(default_factory=list)
    theme_name: str | None = None
    reason: str | None = None
    """回退到手动清单的原因（给界面显示）。"""


def derivation_hint() -> str:
    return "店铺主题里的 templates/page.<suffix>.liquid → suffix"


class TemplateService:
    def __init__(self, client: ShopifyGraphQLClient | None = None) -> None:
        self._client = client or shopify_client

    async def list_templates(self) -> TemplateList:
        """列出模板。优先读店铺主题，失败则回退手动清单。"""
        try:
            return await self._from_theme()
        except (ShopifyError, KeyError, TypeError) as error:
            return TemplateList(
                source="manual",
                templates=app_config.resolved_template_choices(),
                reason=str(error)[:300],
            )

    async def _from_theme(self) -> TemplateList:
        themes_data = await self._client.execute(THEMES_QUERY)
        nodes = (themes_data.get("themes") or {}).get("nodes") or []

        main_theme = next(
            (item for item in nodes if item.get("role") == "MAIN"),
            nodes[0] if nodes else None,
        )
        if not main_theme:
            raise ShopifyError("店铺里没有找到主题")

        files_data = await self._client.execute(
            THEME_FILES_QUERY, {"id": main_theme["id"]}
        )
        files = ((files_data.get("theme") or {}).get("files") or {}).get("nodes") or []

        suffixes: list[str] = []
        for item in files:
            filename = str(item.get("filename") or "")
            match = PAGE_TEMPLATE_PATTERN.match(filename)
            if not match:
                continue
            suffix = match.group(1)
            if suffix not in suffixes:
                suffixes.append(suffix)

        if not suffixes:
            # 主题里没有带后缀的页面模板 → 回退手动清单，但说明原因
            return TemplateList(
                source="manual",
                templates=app_config.resolved_template_choices(),
                theme_name=str(main_theme.get("name") or ""),
                reason="该主题里没有 templates/page.<suffix>.liquid 形式的页面模板",
            )

        return TemplateList(
            source="shopify",
            templates=sorted(suffixes),
            theme_name=str(main_theme.get("name") or ""),
        )


template_service = TemplateService()

__all__ = [
    "PAGE_TEMPLATE_PATTERN",
    "TemplateList",
    "TemplateService",
    "template_service",
]
