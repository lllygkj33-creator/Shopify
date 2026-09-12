/**
 * 应用外壳与领域层词条。
 *
 * 覆盖范围：
 *  - 侧边栏 / 命令面板 / 主题设置抽屉 / 连接状态（`src/components/**` 里非 ui 的自有组件）
 *  - `src/lib/**` 的校验与错误提示（解析器、API 客户端、时区工具）
 *  - `src/types/content.ts` 里用户可见的状态与令牌来源标签
 *  - `src/main.tsx` 的全局 toast
 *
 * 命名：`shell.*`。固定导航项、主题词等公共词放在别人维护的 `common.ts`，
 * 这里只放本区域独有的句子；栏目名来自站点配置，用 `channelLabel()` 按语言取。
 */
export const zh = {
  // --- 侧边栏分组（仪表盘 / 全局设置等固定项用 common.ts 的 nav.*）---
  // --- 语言切换器里的语言名（英文侧不能出现汉字）---
  'shell.lang.zh': '中文',
  'shell.lang.en': 'English',

  'shell.nav.group.content': '内容栏目',
  'shell.nav.group.system': '系统',

  // --- 侧边栏底部：连接状态 ---
  'shell.connection.noStore': '未配置店铺',
  'shell.connection.openSettings': '打开全局设置',
  'shell.connection.tokenFrom': 'Token 来自 {source}',
  'shell.connection.sourceEnv': '环境变量',
  'shell.connection.sourceManual': '手动配置',
  'shell.connection.tokenMissing': 'Token 未配置，无法发布',
  'shell.mock.badge': '演示数据模式（内置数据，未连后端）',

  // --- 布局与无障碍 ---
  'shell.skipToMain': '跳到主要内容',
  'shell.toggleSidebar': '切换侧边栏',
  'shell.toggleTheme': '切换主题',

  // --- 命令面板 ---
  'shell.command.placeholder': '输入命令或搜索…',
  'shell.command.empty': '没有找到结果。',

  // --- 主题设置抽屉 ---
  'shell.config.open': '打开主题设置',
  'shell.config.title': '主题设置',
  'shell.config.description': '调整外观与布局，让它符合你的使用习惯。',
  'shell.config.reset': '重置',
  'shell.config.resetAll': '将所有设置恢复为默认值',
  'shell.config.sidebar': '侧边栏',
  'shell.config.layout': '布局',
  'shell.config.direction': '方向',
  'shell.config.reset.theme': '将主题偏好恢复为默认值',
  'shell.config.reset.sidebar': '将侧边栏样式恢复为默认值',
  'shell.config.reset.layout': '将布局选项恢复为默认值',
  'shell.config.reset.direction': '将文本方向恢复为默认值',
  'shell.config.option.inset': '内嵌',
  'shell.config.option.floating': '浮动',
  'shell.config.option.default': '默认',
  'shell.config.option.compact': '紧凑',
  'shell.config.option.full': '完整布局',
  'shell.config.option.ltr': '从左到右',
  'shell.config.option.rtl': '从右到左',
  'shell.config.select': '选择 {label}',
  'shell.config.preview': '{label} 选项预览',
  'shell.config.group.theme': '选择主题偏好',
  'shell.config.group.sidebar': '选择侧边栏样式',
  'shell.config.group.layout': '选择布局样式',
  'shell.config.group.direction': '选择站点方向',
  'shell.config.hint.theme': '在跟随系统、浅色模式或深色模式之间选择',
  'shell.config.hint.sidebar': '在内嵌、浮动或标准侧边栏布局之间选择',
  'shell.config.hint.layout': '在默认展开、紧凑图标或完整布局模式之间选择',
  'shell.config.hint.direction': '在从左到右或从右到左的站点方向之间选择',

  // --- 分隔符（中英标点不同）---
  'shell.separator.item': '、',
  'shell.separator.clause': '；',

  // --- 时区选项（设置页的下拉框）---
  'shell.tz.shanghai': 'Asia/Shanghai（中国标准时间，UTC+8）— 默认',
  'shell.tz.newYork': 'America/New_York（美国东部，UTC-5/-4）',
  'shell.tz.losAngeles': 'America/Los_Angeles（美国西部，UTC-8/-7）',
  'shell.tz.london': 'Europe/London（伦敦，UTC+0/+1）',
  'shell.tz.berlin': 'Europe/Berlin（柏林，UTC+1/+2）',
  'shell.tz.tokyo': 'Asia/Tokyo（日本，UTC+9）',
  'shell.tz.singapore': 'Asia/Singapore（新加坡，UTC+8）',
  'shell.tz.sydney': 'Australia/Sydney（悉尼，UTC+10/+11）',
  'shell.tz.utc': 'UTC（协调世界时）',

  // --- 时间展示 ---
  'shell.time.parseError': '无法解析时间「{value}」，期望格式 YYYY-MM-DDTHH:mm',
  'shell.time.justNow': '刚刚',
  'shell.time.minuteAgo': '{count} 分钟前',
  'shell.time.minutesAgo': '{count} 分钟前',
  'shell.time.minuteLater': '{count} 分钟后',
  'shell.time.minutesLater': '{count} 分钟后',
  'shell.time.hourAgo': '{count} 小时前',
  'shell.time.hoursAgo': '{count} 小时前',
  'shell.time.hourLater': '{count} 小时后',
  'shell.time.hoursLater': '{count} 小时后',
  'shell.time.dayAgo': '{count} 天前',
  'shell.time.daysAgo': '{count} 天前',
  'shell.time.dayLater': '{count} 天后',
  'shell.time.daysLater': '{count} 天后',

  // --- 全局错误提示 ---
  'shell.error.generic': '出错了！',
  'shell.error.noContent': '无内容。',
  'shell.error.notModified': '内容未修改！',
  'shell.error.serverError': '服务器内部错误！',
  'shell.error.tokenInvalid':
    'Shopify Token 无效或已过期，请在「全局设置」中更新',

  // --- API 客户端 ---
  'shell.api.paramInvalid': '请求参数校验失败',
  'shell.api.backendUnreachable':
    '无法连接后端 {baseUrl}，请确认后端已启动（或设置 VITE_USE_MOCK=true 使用演示数据）',
  'shell.api.mockTemplates': '演示模式：展示内置博客清单（VITE_USE_MOCK=true）',

  // --- 演示用提交内容（show-submitted-data）---
  'shell.submitted.title': '你提交了以下数据：',

  // --- 演示模式（mock-api）：这些字符串会直接显示在界面上 ---
  'shell.mock.body':
    '<h2>演示正文</h2><p>Mock 数据，用于验证 UI 布局与状态展示。</p>',
  'shell.mock.summary': '演示用摘要文本。',
  'shell.mock.summaryShort': '演示用摘要。',
  'shell.mock.metaDescription': '演示用 meta description。',
  'shell.mock.newlyPublished': '新发布',
  'shell.mock.seedError':
    'articleCreate 返回 userErrors: 正文少于 4 个 H2，无法插入 related_products_1',
  'shell.mock.syncWarning': '演示模式：没有真实的 Shopify 对象，未做同步',
  'shell.mock.notFound': '未找到内容 {id}',

  // --- 内容状态（types/content.ts）---
  'shell.status.draft.label': '草稿',
  'shell.status.draft.desc': '已入库但未排期，可随时发布',
  'shell.status.scheduled.label': '待发布',
  'shell.status.scheduled.desc': '已提交 Shopify，将在指定时间自动上线',
  'shell.status.published.label': '已发布',
  'shell.status.published.desc': '已上线',
  'shell.status.failed.label': '发布失败',
  'shell.status.failed.desc': '发布被 Shopify 拒绝，可重试',
  'shell.status.publishing.label': '发布中',
  'shell.status.publishing.desc': '正在提交到 Shopify',

  // --- 令牌来源（types/content.ts）---
  'shell.tokenSource.auto.label': '自动续期（推荐）',
  'shell.tokenSource.auto.hint':
    '用 .env 里的 CLIENT_ID / CLIENT_SECRET 换发 token，到期前自动换新，不需要人工维护。',
  'shell.tokenSource.env.label': '环境变量静态 token',
  'shell.tokenSource.env.hint':
    '读取 .env 里的 SHOPIFY_ACCESS_TOKEN。仅适合不过期的自定义应用长期 token。',
  'shell.tokenSource.env.warning':
    '静态 token 不会被自动续期。如果它是 client_credentials 换来的（24 小时有效），明天会突然 401，请改用「自动续期」。',
  'shell.tokenSource.manual.label': '界面手动输入',
  'shell.tokenSource.manual.hint':
    '粘贴一个 shpat_ token，保存在本地 0600 权限文件中，界面只显示掩码。',
  'shell.tokenSource.manual.warning':
    '手动 token 不会被自动续期。若粘贴的是 24 小时有效期的 token，次日发布就会失败。',

  // --- JSON 解析器：归属与结构 ---
  'shell.json.field.channel': '栏目',
  'shell.json.channelMismatch':
    '这份 JSON 属于「{detected}」栏目，不能在「{current}」栏目上传；请到「{detected}」栏目重新上传',
  'shell.json.syntaxError': 'JSON 语法错误：{message}',
  'shell.json.parseFailed': '解析失败：{message}',
  'shell.json.itemFailed': '(第 {n} 条解析失败)',
  'shell.json.unknownStructure':
    '无法识别的 JSON 结构。期望：博客文章为数组（含 blog title / url / html代码），页面为单对象（含 url 与 template）。',

  // --- JSON 解析器：正文规则 ---
  'shell.json.h1Forbidden':
    '正文包含 <h1>；H1 应由 page.title / Liquid 输出，请改用 <h2>',
  'shell.json.h2Forbidden': '正文包含 <h2>；H2 标题必须由 VS Liquid 模板输出',
  'shell.json.h2Min': '正文必须至少包含 {min} 个 <h2> 章节；当前 {count} 个',
  'shell.json.imageAlt': '第 {n} 张图片缺少非空 alt 属性',
  'shell.json.imageTitle': '第 {n} 张图片缺少非空 title 属性',
  'shell.json.linkTitle': '第 {n} 个链接缺少非空 title 属性',
  'shell.json.linkHref': '第 {n} 个链接缺少 href',
  'shell.json.linkTargetBlank':
    '第 {n} 个链接是外部链接，必须使用 target="_blank"',
  'shell.json.linkRel': '第 {n} 个外部链接的 rel 缺少 {tokens}',
  'shell.json.linkNofollow': '第 {n} 个第三方链接必须包含 nofollow',
  'shell.json.bodyMustContain': '正文必须包含「{text}」',
  'shell.json.markerOpen': '{marker}：必须恰好有一个开标记 {tag}',
  'shell.json.markerClose': '{marker}：必须恰好有一个闭标记 {tag}',
  'shell.json.forbiddenPlaceholder': '正文包含未替换的占位串：{placeholder}',
  'shell.json.relatedProductsH2':
    '正文只有 {count} 个 H2，无法插入 [[related_products_1]] 占位符（需要 ≥ 4 个 H2），且正文未自带占位符',
  'shell.json.relatedProductsNoH2':
    '正文没有 H2 标题，无法自动插入关联产品占位符；若模板需要占位符请手动加入 [[related_products_1]]',

  // --- JSON 解析器：必填与长度 ---
  'shell.json.missingTitle': '缺少文章标题',
  'shell.json.missingHandle': '缺少文章 handle（url）',
  'shell.json.missingBody': '缺少正文 HTML',
  'shell.json.missingMetaTitle': '缺少 meta title（发布必填）',
  'shell.json.missingMetaDescription': '缺少 meta description（发布必填）',
  'shell.json.missingSummary': '缺少 summary（发布必填）',
  'shell.json.metaDescriptionTooLong':
    'meta description 超过 {max} 个字符，当前 {length}',
  'shell.json.summaryTooLong': 'summary 超过 {max} 个字符，当前 {length}',
  'shell.json.handlePattern':
    'handle 只能包含小写字母、数字和连字符；当前值「{handle}」',
  'shell.json.articleUrlNormalized':
    '博客文章的 url 应为不带前导斜杠的 handle，已自动规范化为「{handle}」',
  'shell.json.blogUnknown':
    '无法确定博客归属：正文缺少 zima-*-article class，且当前栏目没有默认 Blog',
  'shell.json.blogFallback':
    '正文未带 zima-*-article class，已按当前栏目默认博客「{blog}」发布',
  'shell.json.authorMissing': '未指定作者，将使用全局设置里的默认作者',
  'shell.json.missingPageTitle': '缺少页面标题',
  'shell.json.missingPageUrl': '缺少页面路径（url）',
  'shell.json.pageHandlePattern':
    '路径 handle 只能包含小写字母、数字和连字符；当前值「{handle}」',
  'shell.json.missingPageBody': '缺少页面正文 HTML',
  'shell.json.templateRequired':
    '缺少 template：该栏目的模板由 JSON 指定，必须填写',
  'shell.json.templateMissingExpected':
    '缺少 template，该栏目要求「{template}」',
  'shell.json.templateMissingSpec': '缺少 template，且该栏目未登记模板规格',
  'shell.json.templateMismatch':
    'template 必须是「{expected}」，当前为「{actual}」',
  'shell.json.metaTitleTooLong':
    'meta title 应在 {max} 个字符以内；当前 {length}',
  'shell.json.metaDescriptionRange':
    'meta description 应在 {min}~{max} 字符之间；当前 {length}',
  'shell.json.summaryTooShort': 'summary 应至少 {min} 个字符；当前 {length}',
  'shell.json.publishedMustBeTrue':
    'published 必须为 true（该栏目的排期接口要求）',
  'shell.json.publishedFalse':
    'JSON 中 published=false；实际是否上线由你在发布时选择的「发布方式」决定',
  'shell.json.relatedProductsMustBeEmpty':
    'related_products 必须为空数组；商品链接请直接写在正文里',

  // --- JSON 解析器：来源对象 ---
  'shell.json.sourceMissing': '缺少 {key} 来源对象（发布必填）',
  'shell.json.sourceUnverified':
    '缺少 {key} 来源信息；该栏目规格尚未核对，此处只做提示',
  'shell.json.sourceNotString': '{field} 必须是字符串',
  'shell.json.sourceEmpty': '{field} 不能为空',
  'shell.json.sourcePrefix': '必须以 {prefix} 开头',
  'shell.json.sourceRegex': '格式不正确（应匹配 {pattern}）',
  'shell.json.sourceHttpUrl': '必须是完整的 http(s) 链接',
  'shell.json.sourceHost': '必须指向 {hosts}',
  'shell.json.sourceExact': '必须是「{expected}」，当前「{actual}」',
  'shell.json.sourceDigits': '只能包含数字或留空',
  'shell.json.sourceModelPath': '必须指向模型页（路径需包含 {segment}）',
} as const

export const en = {
  'shell.lang.zh': 'Chinese',
  'shell.lang.en': 'English',

  'shell.nav.group.content': 'Content channels',
  'shell.nav.group.system': 'System',

  'shell.connection.noStore': 'No store configured',
  'shell.connection.openSettings': 'Open global settings',
  'shell.connection.tokenFrom': 'Token from {source}',
  'shell.connection.sourceEnv': 'environment variables',
  'shell.connection.sourceManual': 'manual configuration',
  'shell.connection.tokenMissing':
    'No token configured — publishing unavailable',
  'shell.mock.badge': 'Demo data mode (built-in data, backend not connected)',

  'shell.skipToMain': 'Skip to Main',
  'shell.toggleSidebar': 'Toggle Sidebar',
  'shell.toggleTheme': 'Toggle theme',

  'shell.command.placeholder': 'Type a command or search...',
  'shell.command.empty': 'No results found.',

  'shell.config.open': 'Open theme settings',
  'shell.config.title': 'Theme Settings',
  'shell.config.description':
    'Adjust the appearance and layout to suit your preferences.',
  'shell.config.reset': 'Reset',
  'shell.config.resetAll': 'Reset all settings to default values',
  'shell.config.sidebar': 'Sidebar',
  'shell.config.layout': 'Layout',
  'shell.config.direction': 'Direction',
  'shell.config.reset.theme': 'Reset theme preference to default',
  'shell.config.reset.sidebar': 'Reset sidebar style to default',
  'shell.config.reset.layout': 'Reset layout options to default',
  'shell.config.reset.direction': 'Reset text direction to default',
  'shell.config.option.inset': 'Inset',
  'shell.config.option.floating': 'Floating',
  'shell.config.option.default': 'Default',
  'shell.config.option.compact': 'Compact',
  'shell.config.option.full': 'Full layout',
  'shell.config.option.ltr': 'Left to Right',
  'shell.config.option.rtl': 'Right to Left',
  'shell.config.select': 'Select {label}',
  'shell.config.preview': '{label} option preview',
  'shell.config.group.theme': 'Select theme preference',
  'shell.config.group.sidebar': 'Select sidebar style',
  'shell.config.group.layout': 'Select layout style',
  'shell.config.group.direction': 'Select site direction',
  'shell.config.hint.theme':
    'Choose between system preference, light mode, or dark mode',
  'shell.config.hint.sidebar':
    'Choose between inset, floating, or standard sidebar layout',
  'shell.config.hint.layout':
    'Choose between default expanded, compact icon-only, or full layout mode',
  'shell.config.hint.direction':
    'Choose between left-to-right or right-to-left site direction',

  'shell.separator.item': ', ',
  'shell.separator.clause': '; ',

  'shell.tz.shanghai': 'Asia/Shanghai (China Standard Time, UTC+8) — Default',
  'shell.tz.newYork': 'America/New_York (US Eastern, UTC-5/-4)',
  'shell.tz.losAngeles': 'America/Los_Angeles (US Pacific, UTC-8/-7)',
  'shell.tz.london': 'Europe/London (London, UTC+0/+1)',
  'shell.tz.berlin': 'Europe/Berlin (Berlin, UTC+1/+2)',
  'shell.tz.tokyo': 'Asia/Tokyo (Japan, UTC+9)',
  'shell.tz.singapore': 'Asia/Singapore (Singapore, UTC+8)',
  'shell.tz.sydney': 'Australia/Sydney (Sydney, UTC+10/+11)',
  'shell.tz.utc': 'UTC (Coordinated Universal Time)',

  'shell.time.parseError':
    'Cannot parse the time "{value}"; expected format YYYY-MM-DDTHH:mm',
  'shell.time.justNow': 'Just now',
  'shell.time.minuteAgo': '{count} minute ago',
  'shell.time.minutesAgo': '{count} minutes ago',
  'shell.time.minuteLater': 'in {count} minute',
  'shell.time.minutesLater': 'in {count} minutes',
  'shell.time.hourAgo': '{count} hour ago',
  'shell.time.hoursAgo': '{count} hours ago',
  'shell.time.hourLater': 'in {count} hour',
  'shell.time.hoursLater': 'in {count} hours',
  'shell.time.dayAgo': '{count} day ago',
  'shell.time.daysAgo': '{count} days ago',
  'shell.time.dayLater': 'in {count} day',
  'shell.time.daysLater': 'in {count} days',

  'shell.error.generic': 'Something went wrong!',
  'shell.error.noContent': 'No content.',
  'shell.error.notModified': 'Content not modified!',
  'shell.error.serverError': 'Internal Server Error!',
  'shell.error.tokenInvalid':
    'The Shopify token is invalid or has expired. Update it in Global Settings.',

  'shell.api.paramInvalid': 'Request parameter validation failed',
  'shell.api.backendUnreachable':
    'Cannot reach the backend at {baseUrl}. Make sure it is running, or set VITE_USE_MOCK=true to use demo data.',
  'shell.api.mockTemplates':
    'Demo mode: showing the built-in blog list (VITE_USE_MOCK=true)',

  'shell.submitted.title': 'You submitted the following values:',

  'shell.mock.body':
    '<h2>Demo body</h2><p>Mock data, used to verify the UI layout and status rendering.</p>',
  'shell.mock.summary': 'Demo summary text.',
  'shell.mock.summaryShort': 'Demo summary.',
  'shell.mock.metaDescription': 'Demo meta description.',
  'shell.mock.newlyPublished': 'Newly published',
  'shell.mock.seedError':
    'articleCreate returned userErrors: body has fewer than 4 H2 sections, cannot insert related_products_1',
  'shell.mock.syncWarning':
    'Demo mode: there is no real Shopify object, so nothing was synced',
  'shell.mock.notFound': 'Content {id} not found',

  'shell.status.draft.label': 'Draft',
  'shell.status.draft.desc': 'Saved but not scheduled — publish it any time',
  'shell.status.scheduled.label': 'Scheduled',
  'shell.status.scheduled.desc':
    'Submitted to Shopify; goes live automatically at the scheduled time',
  'shell.status.published.label': 'Published',
  'shell.status.published.desc': 'Live on the store',
  'shell.status.failed.label': 'Failed',
  'shell.status.failed.desc': 'Rejected by Shopify — you can retry',
  'shell.status.publishing.label': 'Publishing',
  'shell.status.publishing.desc': 'Submitting to Shopify',

  'shell.tokenSource.auto.label': 'Auto-renew (recommended)',
  'shell.tokenSource.auto.hint':
    'Exchanges the CLIENT_ID / CLIENT_SECRET from .env for a token and renews it before expiry — no manual maintenance.',
  'shell.tokenSource.env.label': 'Static token from environment variables',
  'shell.tokenSource.env.hint':
    'Reads SHOPIFY_ACCESS_TOKEN from .env. Only suitable for a non-expiring long-lived custom app token.',
  'shell.tokenSource.env.warning':
    'A static token is never renewed automatically. If it came from client_credentials (24-hour lifetime) it will suddenly return 401 tomorrow — switch to Auto-renew instead.',
  'shell.tokenSource.manual.label': 'Entered manually in the UI',
  'shell.tokenSource.manual.hint':
    'Paste a shpat_ token; it is stored in a local file with 0600 permissions and the UI only shows a masked value.',
  'shell.tokenSource.manual.warning':
    'A manually entered token is never renewed automatically. If the token you paste is only valid for 24 hours, publishing will fail the next day.',

  'shell.json.field.channel': 'Channel',
  'shell.json.channelMismatch':
    'This JSON belongs to the "{detected}" channel, so it cannot be uploaded from the "{current}" channel. Please upload it from the "{detected}" channel.',
  'shell.json.syntaxError': 'JSON syntax error: {message}',
  'shell.json.parseFailed': 'Parsing failed: {message}',
  'shell.json.itemFailed': '(item {n} failed to parse)',
  'shell.json.unknownStructure':
    'Unrecognized JSON structure. Expected either a blog article array (with blog title / url / body html) or a page object (with url and template).',

  'shell.json.h1Forbidden':
    'Body contains <h1>; the H1 should be rendered by page.title / Liquid — use <h2> instead',
  'shell.json.h2Forbidden':
    'Body contains <h2>; H2 headings must be rendered by the VS Liquid template',
  'shell.json.h2Min':
    'Body must contain at least {min} <h2> sections; currently {count}',
  'shell.json.imageAlt': 'Image #{n} is missing a non-empty alt attribute',
  'shell.json.imageTitle': 'Image #{n} is missing a non-empty title attribute',
  'shell.json.linkTitle': 'Link #{n} is missing a non-empty title attribute',
  'shell.json.linkHref': 'Link #{n} is missing href',
  'shell.json.linkTargetBlank':
    'Link #{n} points outside the store and must use target="_blank"',
  'shell.json.linkRel': 'Link #{n} external rel is missing {tokens}',
  'shell.json.linkNofollow':
    'Link #{n} points to a third party and must include nofollow',
  'shell.json.bodyMustContain': 'Body must contain "{text}"',
  'shell.json.markerOpen':
    '{marker}: exactly one opening marker {tag} required',
  'shell.json.markerClose':
    '{marker}: exactly one closing marker {tag} required',
  'shell.json.forbiddenPlaceholder':
    'Body contains an unreplaced placeholder: {placeholder}',
  'shell.json.relatedProductsH2':
    'Body has only {count} H2 sections, so the [[related_products_1]] placeholder cannot be inserted (at least 4 H2 required) and the body does not carry the placeholder itself',
  'shell.json.relatedProductsNoH2':
    'Body has no H2 headings, so related-product placeholders cannot be inserted automatically; if the template needs one, add [[related_products_1]] manually',

  'shell.json.missingTitle': 'Missing article title',
  'shell.json.missingHandle': 'Missing article handle (url)',
  'shell.json.missingBody': 'Missing body HTML',
  'shell.json.missingMetaTitle': 'Missing meta title (required for publishing)',
  'shell.json.missingMetaDescription':
    'Missing meta description (required for publishing)',
  'shell.json.missingSummary': 'Missing summary (required for publishing)',
  'shell.json.metaDescriptionTooLong':
    'meta description exceeds {max} characters; currently {length}',
  'shell.json.summaryTooLong':
    'summary exceeds {max} characters; currently {length}',
  'shell.json.handlePattern':
    'handle may only contain lowercase letters, digits and hyphens; current value "{handle}"',
  'shell.json.articleUrlNormalized':
    'A blog article url must be a handle without a leading slash; normalized to "{handle}"',
  'shell.json.blogUnknown':
    'Cannot determine the target blog: the body has no zima-*-article class and the current channel has no default blog',
  'shell.json.blogFallback':
    'Body has no zima-*-article class; publishing to the current channel default blog "{blog}"',
  'shell.json.authorMissing':
    'No author specified; the default author from global settings will be used',
  'shell.json.missingPageTitle': 'Missing page title',
  'shell.json.missingPageUrl': 'Missing page path (url)',
  'shell.json.pageHandlePattern':
    'Path handle may only contain lowercase letters, digits and hyphens; current value "{handle}"',
  'shell.json.missingPageBody': 'Missing page body HTML',
  'shell.json.templateRequired':
    'Missing template: this channel takes its template from the JSON, so it is required',
  'shell.json.templateMissingExpected':
    'Missing template; this channel requires "{template}"',
  'shell.json.templateMissingSpec':
    'Missing template, and this channel has no registered template spec',
  'shell.json.templateMismatch':
    'template must be "{expected}", currently "{actual}"',
  'shell.json.metaTitleTooLong':
    'meta title must be at most {max} characters; currently {length}',
  'shell.json.metaDescriptionRange':
    'meta description must be {min}–{max} characters; currently {length}',
  'shell.json.summaryTooShort':
    'summary must be at least {min} characters; currently {length}',
  'shell.json.publishedMustBeTrue':
    'published must be true (required by this channel scheduling API)',
  'shell.json.publishedFalse':
    'published=false in the JSON; whether it actually goes live is decided by the publish mode you choose when publishing',
  'shell.json.relatedProductsMustBeEmpty':
    'related_products must be an empty array; write product links directly in the body',

  'shell.json.sourceMissing':
    'Missing the {key} source object (required to publish)',
  'shell.json.sourceUnverified':
    'Missing {key} source information; this channel spec has not been verified yet, so this is only a hint',
  'shell.json.sourceNotString': '{field} must be a string',
  'shell.json.sourceEmpty': '{field} must not be empty',
  'shell.json.sourcePrefix': 'Must start with {prefix}',
  'shell.json.sourceRegex': 'Invalid format (must match {pattern})',
  'shell.json.sourceHttpUrl': 'Must be a complete http(s) link',
  'shell.json.sourceHost': 'Must point to {hosts}',
  'shell.json.sourceExact': 'Must be "{expected}", currently "{actual}"',
  'shell.json.sourceDigits': 'Digits only, or leave it empty',
  'shell.json.sourceModelPath':
    'Must point to a model page (path must contain {segment})',
} as const
