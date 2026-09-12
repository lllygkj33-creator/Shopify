/**
 * 仪表盘区域词条（页面标题、统计卡、时间轴、排期详情弹窗）。
 *
 * 命名：`dashboard.*`。这里也放了几个只在本区域用到的动作词
 * （`dashboard.action.*`），避免为了一个「保存」去动别人维护的 common.ts。
 *
 * 注意：英文侧的空格是**刻意**的 —— 中英排版规则不同，
 * 例如「未来 7 天」译成英文时数字前后要有空格。
 */
export const zh = {
  // 页面头部
  'dashboard.title': '排期仪表盘',
  'dashboard.subtitle': '所有栏目的发布时间轴 · 时区 {timezone}',
  'dashboard.newSchedule': '新建排期',
  'dashboard.selectChannel': '选择栏目',

  // 演示数据提示
  'dashboard.mock.title': '演示数据模式',
  'dashboard.mock.body':
    '下面这些排期是<strong>内置的假数据</strong>，不是你的店铺内容。想看真实数据：停掉当前服务，改用',
  'dashboard.mock.bodyTail': '（连接真实后端），演示模式只在',
  'dashboard.mock.bodyTailEnd': '下开启。',

  // 统计卡
  'dashboard.stats.scheduled': '待发布',
  'dashboard.stats.scheduledHint': '已提交 Shopify，等待到点上线',
  'dashboard.stats.published': '已发布',
  'dashboard.stats.publishedHint': '已上线内容',
  'dashboard.stats.failed': '发布失败',
  'dashboard.stats.failedHint': '需要重试或修正',
  'dashboard.stats.draft': '草稿',
  'dashboard.stats.draftHint': '已入库但未排期',

  // 排期卡片
  'dashboard.schedule.title': '发布排期',
  'dashboard.schedule.description':
    '每行一个栏目，色块为该内容的预定发布时间。点击色块可查看详情、改期或取消。',
  'dashboard.scale.day': '未来 7 天',
  'dashboard.scale.week': '未来 5 周',
  'dashboard.scale.month': '未来 6 月',
  'dashboard.action.refresh': '刷新',
  'dashboard.timeline.loadFailed': '排期数据加载失败',
  'dashboard.timeline.empty':
    '还没有任何排期内容。去左侧任一栏目页上传 JSON 文件并设置发布时间 —— 发布后（或排期到点由 Shopify 上线）内容就会出现在这里。 点色块可以改期或取消。',

  // 内容状态（与 types/content.ts 的 CONTENT_STATUS_META 一一对应）
  'dashboard.status.draft': '草稿',
  'dashboard.status.scheduled': '待发布',
  'dashboard.status.published': '已发布',
  'dashboard.status.failed': '发布失败',
  'dashboard.status.publishing': '发布中',

  // 时间轴
  'dashboard.timeline.channelColumn': '栏目 / 时间',
  'dashboard.timeline.week': '第 {index} 周',
  'dashboard.timeline.weekStart': '{date} 起',
  'dashboard.timeline.noSchedule': '暂无排期',
  'dashboard.timeline.now': '现在',
  'dashboard.timeline.legend': '块上的数字是该格的内容条数，悬停或点击展开清单',
  'dashboard.timeline.countUnit': '条',
  'dashboard.timeline.itemCount': '{count} 条',
  'dashboard.timeline.titleSeparator': '：',
  'dashboard.timeline.bucketAria': '{channel} {tick} 共 {count} 条',
  'dashboard.timeline.tooltipMore': '…另有 {count} 条',

  // 排期详情 / 改期 / 取消
  'dashboard.dialog.page': '页面',
  'dashboard.dialog.blogArticle': '博客文章',
  'dashboard.dialog.publishPath': '发布路径',
  'dashboard.dialog.scheduledAt': '排期时间',
  'dashboard.dialog.unscheduled': '未排期（草稿）',
  'dashboard.dialog.failureReason': '失败原因',
  'dashboard.dialog.reschedule': '改期（{timezone} · {offset}）',
  'dashboard.dialog.save': '保存',
  'dashboard.dialog.saveHint':
    '时间按全局设置时区解释，提交给 Shopify 时会带上时区偏移。',
  'dashboard.dialog.openChannel': '打开栏目页',
  'dashboard.dialog.viewOnline': '查看线上',
  'dashboard.dialog.cancelSchedule': '取消排期',

  // 改期 / 取消后的提示
  'dashboard.toast.syncPending': '线上排期未同步',
  'dashboard.toast.rescheduledSynced': '排期已更新，并已同步到 Shopify',
  'dashboard.toast.rescheduledLocal':
    '已记录新的排期时间；该条目在 Shopify 上还没有对象，需重新发布才会生效',
  'dashboard.toast.cancelFailed': '线上排期未能撤销',
  'dashboard.toast.cancelledSynced': '已取消排期，并已撤销 Shopify 侧的排期',
  'dashboard.toast.cancelledLocal': '已取消排期并退回草稿',
} as const

export const en = {
  // 页面头部
  'dashboard.title': 'Schedule dashboard',
  'dashboard.subtitle':
    'Publishing timeline across all channels · Timezone {timezone}',
  'dashboard.newSchedule': 'New schedule',
  'dashboard.selectChannel': 'Select channel',

  // 演示数据提示
  'dashboard.mock.title': 'Demo data mode',
  'dashboard.mock.body':
    'These schedules are <strong>built-in fake data</strong>, not your store content. To see real data: stop the current server and switch to',
  'dashboard.mock.bodyTail':
    '(connect to the real backend). Demo mode only runs under',
  'dashboard.mock.bodyTailEnd': '.',

  // 统计卡
  'dashboard.stats.scheduled': 'Scheduled',
  'dashboard.stats.scheduledHint':
    'Submitted to Shopify, waiting for its publish time',
  'dashboard.stats.published': 'Published',
  'dashboard.stats.publishedHint': 'Content that is live',
  'dashboard.stats.failed': 'Failed',
  'dashboard.stats.failedHint': 'Needs a retry or a fix',
  'dashboard.stats.draft': 'Drafts',
  'dashboard.stats.draftHint': 'Stored locally, not scheduled',

  // 排期卡片
  'dashboard.schedule.title': 'Publishing schedule',
  'dashboard.schedule.description':
    'One row per channel; each block is a scheduled publish time. Click a block to view details, reschedule, or cancel.',
  'dashboard.scale.day': 'Next 7 days',
  'dashboard.scale.week': 'Next 5 weeks',
  'dashboard.scale.month': 'Next 6 months',
  'dashboard.action.refresh': 'Refresh',
  'dashboard.timeline.loadFailed': 'Failed to load schedule data',
  'dashboard.timeline.empty':
    'No scheduled content yet. Go to any channel page on the left, upload a JSON file, and set a publish time — once published (or once Shopify publishes it at the scheduled time) the content will show up here. Click a block to reschedule or cancel.',

  // 内容状态（与 types/content.ts 的 CONTENT_STATUS_META 一一对应）
  'dashboard.status.draft': 'Draft',
  'dashboard.status.scheduled': 'Scheduled',
  'dashboard.status.published': 'Published',
  'dashboard.status.failed': 'Failed',
  'dashboard.status.publishing': 'Publishing',

  // 时间轴
  'dashboard.timeline.channelColumn': 'Channel / Time',
  'dashboard.timeline.week': 'Week {index}',
  'dashboard.timeline.weekStart': 'From {date}',
  'dashboard.timeline.noSchedule': 'Nothing scheduled',
  'dashboard.timeline.now': 'Now',
  'dashboard.timeline.legend':
    'The number on a block is how many items fall in that cell; hover or click to expand the list',
  'dashboard.timeline.countUnit': 'items',
  'dashboard.timeline.itemCount': '{count} items',
  'dashboard.timeline.titleSeparator': ': ',
  'dashboard.timeline.bucketAria': '{channel} {tick}, {count} items',
  'dashboard.timeline.tooltipMore': '…and {count} more',

  // 排期详情 / 改期 / 取消
  'dashboard.dialog.page': 'Page',
  'dashboard.dialog.blogArticle': 'Blog article',
  'dashboard.dialog.publishPath': 'Publish path',
  'dashboard.dialog.scheduledAt': 'Scheduled time',
  'dashboard.dialog.unscheduled': 'Not scheduled (draft)',
  'dashboard.dialog.failureReason': 'Failure reason',
  'dashboard.dialog.reschedule': 'Reschedule ({timezone} · {offset})',
  'dashboard.dialog.save': 'Save',
  'dashboard.dialog.saveHint':
    'The time is interpreted in the global timezone and sent to Shopify with its UTC offset.',
  'dashboard.dialog.openChannel': 'Open channel page',
  'dashboard.dialog.viewOnline': 'View live',
  'dashboard.dialog.cancelSchedule': 'Cancel schedule',

  // 改期 / 取消后的提示
  'dashboard.toast.syncPending': 'Online schedule not synced',
  'dashboard.toast.rescheduledSynced': 'Schedule updated and synced to Shopify',
  'dashboard.toast.rescheduledLocal':
    'New schedule time recorded; this item has no object on Shopify yet, so it takes effect only after republishing',
  'dashboard.toast.cancelFailed': 'Failed to cancel the online schedule',
  'dashboard.toast.cancelledSynced':
    'Schedule cancelled and the Shopify-side schedule was removed',
  'dashboard.toast.cancelledLocal': 'Schedule cancelled and reverted to draft',
}
