"""「Shopify 侧内容」↔「平台栏目」的映射。

拉取未来排期时要判断一条内容属于平台哪个栏目。

## 为什么单独一个模块

平台前端有一份栏目注册表（`src/config/channels.ts`），但后端需要自己的副本。
两处都有就有漂移风险，所以这里：

  - 页面栏目直接**从 `page_publisher.PAGE_CHANNEL_SPECS` 推导**（不重复定义）
  - 博客栏目只能手写（Shopify 侧只给 blog handle，没有栏目概念）
  - 测试里直接读前端 TS 文件做交叉校验，改了一处另一处没改会被测出来

## 不认识的归属怎么办

实测店铺里有不在平台菜单里的内容：
`zima-campaign-hub`（288 篇已发布，另有 2 篇排期）、`news`、`app-hardware-requirements`、
`local-ai-model-hardware` 等。这些**不入库**，但调用方要按原因分别报数 ——
让用户知道有什么没进来，而不是静默丢弃。
"""

from __future__ import annotations

from dataclasses import dataclass

from .page_publisher import PAGE_CHANNEL_SPECS

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

# 已确认不纳入菜单的模板（PRD §3.2）—— 跳过并单独报数
EXCLUDED_TEMPLATES = {
    "local-ai-model-hardware": "Model（未纳入菜单）",
    "app-hardware-requirements": "APP（未纳入菜单）",
}


@dataclass
class ChannelResolution:
    channel_id: str | None
    reason: str | None = None
    """无法归属时的原因（用于同步报告）。"""

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


def channel_mismatch_error(channel_id: str, owner: str | None) -> str | None:
    """JSON 自报的归属栏目与目标栏目不一致时，返回错误消息；一致则返回 None。

    为什么要有这条规则：上传时 JSON 自己会声明归属（页面的 template、
    文章的博客），放在 A 栏目上传却声明成 B 栏目的内容，**不能静默按 B 发**——
    否则本地记录的栏目、用户在界面上看到的位置，和内容实际去的线上位置三者不一致。

    owner 为 None（认不出的模板/博客）不算不一致：那是「不认识」，不是「属于别处」。
    """
    if owner and owner != channel_id:
        return (
            f"这份 JSON 属于「{owner}」栏目，不能在「{channel_id}」栏目上传或发布；"
            f"请到「{owner}」栏目重新上传"
        )
    return None


__all__ = [
    "BLOG_HANDLE_TO_CHANNEL",
    "EXCLUDED_TEMPLATES",
    "TEMPLATE_TO_CHANNEL",
    "ChannelResolution",
    "channel_mismatch_error",
    "resolve_article_channel",
    "resolve_page_channel",
]
