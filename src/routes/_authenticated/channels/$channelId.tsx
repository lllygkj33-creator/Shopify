import { createFileRoute, notFound } from '@tanstack/react-router'
import { getChannel } from '@/config/channels'
import { ChannelPage } from '@/features/channels'

export const Route = createFileRoute('/_authenticated/channels/$channelId')({
  component: RouteComponent,
})

/**
 * 10 个栏目共用这一个路由与页面组件（PRD §4.2「栏目发布页共用同一套模板」）。
 * 栏目定义来自 config/channels.ts，新增栏目无需新增路由文件。
 */
// eslint-disable-next-line react-refresh/only-export-components
function RouteComponent() {
  const { channelId } = Route.useParams()
  const channel = getChannel(channelId)

  if (!channel) throw notFound()

  return <ChannelPage channel={channel} />
}
