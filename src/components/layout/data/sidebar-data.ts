import { CHANNELS, type Channel } from '@/config/channels'
import { site } from '@/config/site'
import {
  BookOpenCheck,
  Boxes,
  Sparkles,
  FileText,
  GitCompareArrows,
  LifeBuoy,
  LayoutDashboard,
  MessagesSquare,
  Package,
  Server,
  ShoppingCart,
  Settings,
  Users,
} from 'lucide-react'
import { BrandMark } from '@/assets/brand-mark'
import { type SidebarData } from '../types'

/**
 * 栏目 id → 图标。
 * 图标不放进 config/channels.ts，是为了让栏目配置保持「纯领域数据」
 * （不含 React 依赖），后端也能复用同一份定义。
 */
const CHANNEL_ICONS: Record<string, React.ElementType> = {
  // 通用页面出口，放在最上面
  custom: Sparkles,
  'tech-ai-hub': Boxes,
  'support-tips': LifeBuoy,
  'nas-server-setup': Server,
  'buying-guide': ShoppingCart,
  'product-comparison': BookOpenCheck,
  'community-post': Users,
  discord: MessagesSquare,
  'user-story': FileText,
  vs: GitCompareArrows,
  makerworld: Package,
}

/** 菜单标签：页面类栏目显示中文名（PRD §3.2 的菜单项命名） */
function channelLabel(channel: Channel): string {
  return channel.nameZh ?? channel.name
}

function channelToNavItem(channel: Channel) {
  return {
    title: channelLabel(channel),
    url: `/channels/${channel.id}`,
    icon: CHANNEL_ICONS[channel.id] ?? FileText,
  }
}

/**
 * 侧边栏结构（PRD §3.1 / §3.2）
 *
 * 内容栏目**由 CHANNELS 自动生成**，不手写菜单项：
 * 以后要加栏目（例如把 Model / APP 放出来），只需改 config/channels.ts 一处。
 */
export const sidebarData: SidebarData = {
  brand: {
    // 品牌名来自站点配置（site.config.local.json 里放真实值）
    name: site.brandName,
    subtitle: site.brandSubtitle,
    // 用 Shopify 官方标识（购物袋 logo），一眼看出内容发到哪去；
    // 组件内用 currentColor，以便跟随侧边栏主题色。
    logo: BrandMark,
  },
  navGroups: [
    {
      title: '概览',
      items: [
        {
          title: '仪表盘',
          url: '/',
          icon: LayoutDashboard,
        },
      ],
    },
    {
      title: '内容栏目',
      items: CHANNELS.map(channelToNavItem),
    },
    {
      title: '系统',
      items: [
        {
          title: '全局设置',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}
