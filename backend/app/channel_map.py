"""「Shopify 侧对象」↔「平台栏目」的映射。

导入与对账都要用：拿到一篇 Shopify 文章/页面，判断它属于平台哪个栏目。

## 为什么单独一个模块

平台前端有一份栏目注册表（`src/config/channels.ts`），但后端需要自己的副本才能做导入。
两处都有的话就有漂移风险，所以这里：
  - 页面栏目直接**从 `page_publisher.PAGE_CHANNEL_SPECS` 推导**（不重复定义）
  - 博客栏目只能手写（后端原本只在发布时拿到 blogName，没有 handle→栏目的映射）
  - 测试里有专门用例钉住这 5 条映射，改了一处另一处没改会被测出来

## 不认识的归属怎么办

实测店铺里有不在平台栏目范围内的内容（例如 `zima-campaign-hub` 288 篇、
`news` 1 篇、`app-hardware-requirements` 118 个页面）。
这些**不导入**，但会在导入结果里按归属分别报数 —— 让用户知道有什么没进来，
而不是静默丢弃。
"""

from __future__ import annotations

from dataclasses import dataclass

from .shopify.page_publisher import PAGE_CHANNEL_SPECS

# Shopify 博客 handle → 平台栏目 id
#
# 与 src/config/channels.ts 的 blogHandle / id 对应（测试钉住）
BLOG_HANDLE_TO_CHANNEL: dict[str, str] = {
    "tech-ai-hub": "tech-ai-hub",
    "support-tips": "support-tips",
    "nas-server-setup": "nas-server-setup",
    "buying-guide": "buying-guide",
    "product-comparisons": "product-comparison",
}

# 页面 templateSuffix → 平台栏目 id（从发布规格推导，避免重复定义）
TEMPLATE_TO_CHANNEL: dict[str, str] = {
    spec.template: channel_id
    for channel_id, spec in PAGE_CHANNEL_SPECS.items()
    if spec.template
}

# 已确认不纳入菜单的栏目（PRD §3.2）—— 导入时跳过并单独报数
EXCLUDED_TEMPLATES = {
    "local-ai-model-hardware": "Model（未纳入菜单）",
    "app-hardware-requirements": "APP（未纳入菜单）",
}


@dataclass
class ChannelResolution:
    channel_id: str | None
    reason: str | None = None
    """无法归属时的原因（用于导入报告）。"""

    @property
    def resolved(self) -> bool:
        return self.channel_id is not None


def resolve_article_channel(blog_handle: str | None) -> ChannelResolution:
    handle = (blog_handle or "").strip()
    if not handle:
        return ChannelResolution(None, "文章没有 blog handle")

    channel_id = BLOG_HANDLE_TO_CHANNEL.get(handle)
    if not channel_id:
        return ChannelResolution(None, f"博客 {handle} 不在平台栏目内")

    return ChannelResolution(channel_id)


def resolve_page_channel(template_suffix: str | None) -> ChannelResolution:
    template = (template_suffix or "").strip()

    if not template:
        # 主题默认页面模板（没有后缀）
        return ChannelResolution(None, "页面使用主题默认模板（无 templateSuffix）")

    if template in EXCLUDED_TEMPLATES:
        return ChannelResolution(None, EXCLUDED_TEMPLATES[template])

    channel_id = TEMPLATE_TO_CHANNEL.get(template)
    if not channel_id:
        return ChannelResolution(None, f"模板 {template} 不在平台栏目内")

    return ChannelResolution(channel_id)


__all__ = [
    "BLOG_HANDLE_TO_CHANNEL",
    "EXCLUDED_TEMPLATES",
    "TEMPLATE_TO_CHANNEL",
    "ChannelResolution",
    "resolve_article_channel",
    "resolve_page_channel",
]
