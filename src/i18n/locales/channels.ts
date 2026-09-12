/**
 * 栏目区域（频道页：上传 / 校验 / 发布 / 历史）的词条。
 *
 * 命名：`channels.*`。栏目名不在这里 —— 它来自站点配置，用
 * `@/i18n/channel-label` 的 `channelLabel(channel, lang)` 按语言取。
 *
 * 注意：校验提示里有一部分是**前端在 `src/lib/shopify-json.ts` 里拼的**
 * （栏目不匹配、H2 数量不足、缺 meta description 等），那个文件归别的区域维护，
 * 这里的键只覆盖本区域组件自己拼出来的文案。
 */
export const zh = {
  // --- 栏目头 ---
  'channels.folder': '默认文件夹',
  'channels.contentType.blog': '博客文章',
  'channels.contentType.page': '页面',
  'channels.blog': '博客：{name}',
  'channels.template': '模板：{name}',

  // --- 演示模式提示 ---
  'channels.mock.title': '演示数据模式',
  'channels.mock.description':
    '解析与校验是真实逻辑（与后端同规则），但发布结果由本地模拟返回。',

  // --- 页签 ---
  'channels.tab.publish': '上传与发布',
  'channels.tab.history': '历史记录',

  // --- 1. 选择本地文件夹 ---
  'channels.step.folder.title': '1. 选择本地文件夹',
  'channels.step.folder.description':
    'JSON 结构会自动识别：数组 → 博客文章，单对象 → 页面。单个文件出错不会影响其他文件。',
  'channels.dropzone.reading': '正在读取文件…',
  'channels.dropzone.idle': '把包含 JSON 的文件夹拖到这里',
  'channels.dropzone.hint':
    '或点击下方按钮选择本地文件夹，支持一次导入多个 JSON',
  'channels.dropzone.pick': '选择文件夹',
  'channels.file.imported': '已导入 {files} 个文件，解析出 {items} 条内容',
  'channels.file.validating': '（正在做后端权威校验…）',
  'channels.file.blocked': '（{count} 条有错误无法发布）',
  'channels.file.clear': '清空',
  'channels.file.parseFailed': '解析失败',
  'channels.file.count': '{count} 条',
  'channels.file.kind.article': '文章',
  'channels.file.kind.page': '页面',
  'channels.file.error.title': '{count} 个文件解析失败（其余文件可正常发布）',
  'channels.file.error.item': '{file}：{message}',

  // --- 2. 设置发布方式 ---
  'channels.step.plan.title': '2. 设置发布方式',
  'channels.step.plan.description':
    '可逐篇调整；下面的批量设置作用于已勾选的 {count} 篇。时间按 {timezone}（{offset}）解释。',
  'channels.batch.time': '统一发布时间',
  'channels.batch.scheduleAll': '全部定时发布',
  'channels.batch.publishAllNow': '全部立即发布',
  'channels.batch.draftAll': '全部存为草稿',

  // --- 3. 核对并发布 ---
  'channels.step.review.title': '3. 核对并发布',
  'channels.step.review.description':
    '状态由 JSON 内的 url / template 决定，栏目只作为默认兜底。',
  'channels.publish.submit': '发布 {count} 篇',
  'channels.alert.scheduleMissing.title': '有定时发布的内容缺少时间',
  'channels.alert.scheduleMissing.description':
    '请为每一篇「定时发布」的内容填写发布时间，或改用「立即发布」。',
  'channels.alert.scheduleInPast.title': '有 {count} 篇的发布时间已经过去',
  'channels.alert.scheduleInPast.description':
    '为避免内容立即公开，Shopify 侧不接受已过去的时间。请改到未来时间，或改用「立即发布」。',

  // --- 发布结果 ---
  'channels.result.ok': '成功 {count}',
  'channels.result.failed': '失败 {count}',
  'channels.result.backlink': '反链：{status}',
  'channels.result.backlink.added': '已追加',
  'channels.result.backlink.skipped': '已存在，跳过',
  'channels.result.backlinkFailed': '页面已发布，但反链失败：{message}',

  // --- 提示条（Toast）---
  'channels.toast.submitted': '已提交 {count} 篇',
  'channels.toast.partial': '已提交 {total} 篇，其中 {failed} 篇失败',

  // --- 候选列表（表格）---
  'channels.list.selectAll': '全选',
  'channels.list.select': '选择 {title}',
  'channels.list.col.article': '文章',
  'channels.list.col.target': '发布目标',
  'channels.list.col.validation': '校验',
  'channels.list.col.mode': '发布方式',
  'channels.list.untitled': '(无标题)',
  'channels.list.noHandle': '(无 handle)',
  'channels.list.blogUnknown': '未识别博客',
  'channels.list.defaultTemplate': '默认模板',
  'channels.list.valid': '校验通过',
  'channels.list.issues': '{count} 项{level}',
  'channels.list.level.error': '错误',
  'channels.list.level.warning': '提示',
  'channels.list.mode.now': '立即发布',
  'channels.list.mode.schedule': '定时发布',
  'channels.list.mode.draft': '存为草稿',
  'channels.list.time': '发布时间（{offset}）',
  'channels.list.submittedValue': '提交值 {value}',
  'channels.list.pastTime': '时间已过去，无法发布',

  // --- 模板选择器 ---
  'channels.template.placeholder': '选择模板…',
  'channels.template.search': '搜索模板名…',
  'channels.template.empty':
    '没有匹配的模板。可以直接改 JSON 里的 template 字段。',
  'channels.template.group': '可选模板（{count}）',
  'channels.template.notListed': '不在清单里{source}',
  'channels.template.notListed.manual': '（清单来自设置）',
  'channels.template.notListed.hint':
    '：Shopify 会静默回退到主题默认模板，请确认模板名拼写',
  'channels.template.source.shopify': '读自店铺主题',
  'channels.template.source.manual': '来自设置清单',

  // --- 历史记录 ---
  'channels.history.title': '发布历史',
  'channels.history.description': '该栏目每一次发布的提交时间、状态与结果。',
  'channels.history.empty':
    '该栏目还没有发布记录。上传 JSON 并发布后，这里会记录每一篇的结果。',
  'channels.history.refresh': '刷新',
  'channels.history.col.title': '标题',
  'channels.history.col.status': '状态',
  'channels.history.col.publishedAt': '发布时间',
  'channels.history.col.result': '结果',
  'channels.history.view': '查看',
  'channels.history.submitted': '已提交',
} as const

export const en = {
  // --- 栏目头 ---
  'channels.folder': 'Default folder',
  'channels.contentType.blog': 'Blog article',
  'channels.contentType.page': 'Page',
  'channels.blog': 'Blog: {name}',
  'channels.template': 'Template: {name}',

  // --- 演示模式提示 ---
  'channels.mock.title': 'Demo data mode',
  'channels.mock.description':
    'Parsing and validation use the real rules (same as the backend), but publish results are simulated locally.',

  // --- 页签 ---
  'channels.tab.publish': 'Upload & publish',
  'channels.tab.history': 'History',

  // --- 1. 选择本地文件夹 ---
  'channels.step.folder.title': '1. Choose a local folder',
  'channels.step.folder.description':
    'The JSON shape is detected automatically: an array is a blog article, a single object is a page. One bad file does not affect the others.',
  'channels.dropzone.reading': 'Reading files…',
  'channels.dropzone.idle': 'Drop a folder containing JSON files here',
  'channels.dropzone.hint':
    'Or use the button below to pick a local folder — multiple JSON files at once are supported',
  'channels.dropzone.pick': 'Choose folder',
  'channels.file.imported': 'Imported {files} file(s), parsed {items} item(s)',
  'channels.file.validating': '(running authoritative backend validation…)',
  'channels.file.blocked':
    '({count} item(s) have errors and cannot be published)',
  'channels.file.clear': 'Clear',
  'channels.file.parseFailed': 'Parse failed',
  'channels.file.count': '{count} item(s)',
  'channels.file.kind.article': 'article',
  'channels.file.kind.page': 'page',
  'channels.file.error.title':
    '{count} file(s) failed to parse (the rest can still be published)',
  'channels.file.error.item': '{file}: {message}',

  // --- 2. 设置发布方式 ---
  'channels.step.plan.title': '2. Set the publish mode',
  'channels.step.plan.description':
    'You can adjust each item individually; the batch actions below apply to the {count} selected item(s). Times are interpreted in {timezone} ({offset}).',
  'channels.batch.time': 'Batch publish time',
  'channels.batch.scheduleAll': 'Schedule all',
  'channels.batch.publishAllNow': 'Publish all now',
  'channels.batch.draftAll': 'Save all as drafts',

  // --- 3. 核对并发布 ---
  'channels.step.review.title': '3. Review and publish',
  'channels.step.review.description':
    'Each item’s destination comes from the url / template fields in its JSON; the channel is only the fallback.',
  'channels.publish.submit': 'Publish {count} item(s)',
  'channels.alert.scheduleMissing.title':
    'Some scheduled items have no publish time',
  'channels.alert.scheduleMissing.description':
    'Set a publish time for every item in “Schedule”, or switch it to “Publish now”.',
  'channels.alert.scheduleInPast.title':
    '{count} item(s) are scheduled in the past',
  'channels.alert.scheduleInPast.description':
    'Shopify rejects past times so content does not go live immediately. Pick a future time, or switch to “Publish now”.',

  // --- 发布结果 ---
  'channels.result.ok': 'Succeeded {count}',
  'channels.result.failed': 'Failed {count}',
  'channels.result.backlink': 'Backlink: {status}',
  'channels.result.backlink.added': 'Added',
  'channels.result.backlink.skipped': 'Already present, skipped',
  'channels.result.backlinkFailed':
    'The page was published, but the backlink failed: {message}',

  // --- 提示条（Toast）---
  'channels.toast.submitted': 'Submitted {count} item(s)',
  'channels.toast.partial': 'Submitted {total} item(s), {failed} failed',

  // --- 候选列表（表格）---
  'channels.list.selectAll': 'Select all',
  'channels.list.select': 'Select {title}',
  'channels.list.col.article': 'Article',
  'channels.list.col.target': 'Destination',
  'channels.list.col.validation': 'Validation',
  'channels.list.col.mode': 'Publish mode',
  'channels.list.untitled': '(untitled)',
  'channels.list.noHandle': '(no handle)',
  'channels.list.blogUnknown': 'Blog not detected',
  'channels.list.defaultTemplate': 'Default template',
  'channels.list.valid': 'Passed',
  'channels.list.issues': '{count} {level}',
  'channels.list.level.error': 'error(s)',
  'channels.list.level.warning': 'warning(s)',
  'channels.list.mode.now': 'Publish now',
  'channels.list.mode.schedule': 'Schedule',
  'channels.list.mode.draft': 'Save as draft',
  'channels.list.time': 'Publish time ({offset})',
  'channels.list.submittedValue': 'Submitted value {value}',
  'channels.list.pastTime': 'Time is in the past — cannot publish',

  // --- 模板选择器 ---
  'channels.template.placeholder': 'Choose a template…',
  'channels.template.search': 'Search template names…',
  'channels.template.empty':
    'No matching template. You can edit the template field in the JSON directly.',
  'channels.template.group': 'Available templates ({count})',
  'channels.template.notListed': 'Not in the list{source}',
  'channels.template.notListed.manual': ' (the list comes from settings)',
  'channels.template.notListed.hint':
    ': Shopify silently falls back to the theme default template, so please double-check the template name',
  'channels.template.source.shopify': 'Read from store theme',
  'channels.template.source.manual': 'From settings list',

  // --- 历史记录 ---
  'channels.history.title': 'Publish history',
  'channels.history.description':
    'Submission time, status and result of every publish run in this channel.',
  'channels.history.empty':
    'No publish records for this channel yet. Once you upload and publish JSON, every result shows up here.',
  'channels.history.refresh': 'Refresh',
  'channels.history.col.title': 'Title',
  'channels.history.col.status': 'Status',
  'channels.history.col.publishedAt': 'Publish time',
  'channels.history.col.result': 'Result',
  'channels.history.view': 'View',
  'channels.history.submitted': 'Submitted',
} as const
