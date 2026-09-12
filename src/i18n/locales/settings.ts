/**
 * 全局设置区域词条（`src/features/settings/**`）。
 *
 * 命名：`settings.<语义>`。通用词（保存 / 未知 / 主题…）用 `common.*`，
 * 本文件只放设置区自己的文案。
 *
 * 两点约定：
 *  - 中文与改造前的界面文字**逐字符一致**，包括 JSX 换行折叠出来的多余空格；
 *  - 含 `<code>` 的句子按前后段拆成 `.before` / `.middle` / `.after` 多个键，
 *    这样 JSX 里仍然能保留代码样式，而不是换成 dangerouslySetInnerHTML。
 */
export const zh = {
  // ---------------- 设置页外壳 ----------------
  'settings.page.desc':
    'Shopify 店铺、Token 与发布默认值 —— 一处维护，全部栏目共用。',
  'settings.sidebar.placeholder': '设置',

  // ---------------- 外观 ----------------
  'settings.appearance.title': '外观',
  'settings.appearance.desc': '自定义应用外观。自动在日间与夜间主题之间切换。',
  'settings.appearance.font': '字体',
  'settings.appearance.font.desc': '设置仪表盘使用的字体。',
  'settings.appearance.theme.desc': '选择仪表盘的主题。',
  'settings.appearance.submit': '更新偏好设置',

  // ---------------- Shopify 连接 ----------------
  'settings.section.connection': 'Shopify 连接',
  'settings.section.connection.desc':
    '店铺域名与 Admin API 版本。这两项所有发布器共用。',
  'settings.shop.domain': '店铺域名',
  'settings.shop.domain.placeholder': 'your-store.myshopify.com',
  'settings.shop.domain.required': '请填写店铺域名',
  'settings.shop.domain.format': '格式应为 xxx.myshopify.com',
  'settings.shop.apiVersion': 'Admin API 版本',
  'settings.shop.apiVersion.placeholder': '2026-04',
  'settings.shop.apiVersion.desc':
    '原脚本使用 2026-04，升级前请先做一次连接自检。',
  'settings.shop.apiVersion.required': '请填写 API 版本',

  // ---------------- Token ----------------
  'settings.token.section': '访问 Token',
  'settings.token.section.desc':
    'Token 只需在这一处维护，保存后全部 10 个栏目立即生效。',
  'settings.token.notice.title': '注意：自动换发的 token 只有约 24 小时有效期',
  'settings.token.notice.before': 'Shopify 的 ',
  'settings.token.notice.after':
    ' 换来的 shpat_ 令牌实测 86398 秒（24 小时）后失效。所以平台把它当作**派生凭据**而不是配置： 长期保存的是 CLIENT_ID / CLIENT_SECRET，access token 在内存里缓存并在 到期前自动续期。请优先使用「自动续期」。',
  'settings.token.source': 'Token 来源',
  // 三种来源的 label / hint / warning 不在这里：它们挂在 `TOKEN_SOURCE_META`
  // （src/types/content.ts）上，词条由 shell 区的 `shell.tokenSource.*` 提供。
  'settings.token.neverExpires': '不会过期',
  'settings.token.missingCredentials':
    '未检测到 CLIENT_ID / CLIENT_SECRET，请在 .env 中配置后重启后端。',
  'settings.token.newToken': '新的 Token',
  'settings.token.placeholder': 'shpat_...（留空表示不修改）',
  'settings.token.reveal': '显示',
  'settings.token.hide': '隐藏',
  'settings.token.desc':
    '保存到本地 0600 权限文件，界面只显示掩码。若 token 已在仓库中出现过， 建议在 Shopify 后台重新签发。',
  'settings.token.verify': '连接自检',
  'settings.token.verify.shop': '店铺 {name}',
  'settings.token.verify.scopes': '权限 {scopes}',
  'settings.token.verify.blogMissing': '（发博客还缺：{scopes}）',
  'settings.token.verify.failed': '失败：{error}',
  'settings.token.verify.errorTitle': '连接自检失败',
  'settings.token.verify.missingScopes': '缺少权限：{scopes}',
  'settings.token.verify.blogScopesHint':
    '发页面不受影响；但发博客文章还需要：{scopes}',
  'settings.token.refresh': '立即换新',
  'settings.token.refresh.success': '已换新令牌',

  // ---------------- 令牌状态面板 ----------------
  'settings.token.current': '当前生效',
  'settings.token.pending': '凭据已配置，首次调用时自动换取令牌',
  'settings.token.absent': '未配置 token，无法发布',
  'settings.token.neverExpiresLong': '长期有效（该来源不会自动续期）',
  'settings.token.remaining': '剩余 {remaining}',
  'settings.token.expiresAt': '· 到期 {at}',
  'settings.token.lastRefreshed': '上次刷新 {time}',
  'settings.token.lastError': '最近一次错误：{error}',
  'settings.token.remaining.expired': '已过期',
  'settings.token.remaining.daysHours': '{days} 天 {hours} 小时',
  'settings.token.remaining.hoursMinutes': '{hours} 小时 {minutes} 分',
  'settings.token.remaining.minutes': '{minutes} 分',

  // ---------------- 数据同步（对账） ----------------
  'settings.sync.tracked': '已跟踪',
  'settings.sync.tracked.scheduled': '（其中排期中 {count} 条）',
  'settings.sync.lastSync': '上次同步 {time}',
  'settings.sync.never': '尚未同步',
  'settings.sync.auto': '自动同步',
  'settings.sync.auto.every': '每 {minutes} 分钟',
  'settings.sync.auto.off': '已关闭',
  'settings.sync.run': '立即同步',
  'settings.sync.timezone': '（时区 {timezone}）',
  'settings.sync.noCredentials':
    '店铺凭据未配置，对账不可用。请先在上面填好 CLIENT_ID / CLIENT_SECRET。',
  'settings.sync.note.before':
    '定时发布由 Shopify 自己执行（创建时就带未来发布时间），',
  'settings.sync.note.strong': '本平台没有本地定时任务',
  'settings.sync.note.after':
    '，不存在服务没开导致漏发的情况。对账只负责把线上的真实状态同步回本地。',
  'settings.sync.toast.failed': '同步失败：{error}',
  'settings.sync.toast.pulled': '拉到 {count} 条排期',
  'settings.sync.toast.fixed': '修正 {count} 条',
  'settings.sync.toast.consistent': '对账 {count} 条一致',
  'settings.sync.result.pulled': '拉到 {count} 条未发布排期',
  'settings.sync.result.found': '（线上未发布的未来排期共 {count} 条）',
  'settings.sync.result.byChannel': '按栏目分布',
  'settings.sync.result.skipped': '跳过 {count} 条（不属于平台任何栏目）',
  'settings.sync.result.checked': '对账 {count} 条',
  'settings.sync.result.consistent': '· 本地与线上一致',
  'settings.sync.result.drift': '· 修正 {count} 条',
  'settings.sync.result.updated': '（状态更新 {count}',
  'settings.sync.result.goneOnly': '（线上已删除 {count}',
  'settings.sync.result.goneMore': '，线上已删除 {count}',
  'settings.sync.result.close': '）',
  'settings.sync.result.goneNote':
    '已删除的对象会在列表里标注原因，不会被静默移除。',

  // ---------------- 栏目 → 博客映射自检 ----------------
  'settings.mapping.section': '栏目 → 博客映射自检',
  'settings.mapping.section.desc':
    '把配置里的 blogName / blogHandle 与店铺实际数据逐条对比。 Shopify 侧的博客标题一旦被改，按标题匹配的发布器就会立刻失效，所以这里提前暴露不一致。',
  'settings.mapping.error.title': '无法获取店铺博客列表',
  'settings.mapping.error.hint':
    '需要先配置可用的 Token（可在上方的「连接自检」里排查）。',
  'settings.mapping.summary':
    '共 {channels} 个博客栏目，店铺里有 {blogs} 个博客',
  'settings.mapping.recheck': '重新核对',
  'settings.mapping.broken.title': '有 {count} 个栏目在店铺里找不到对应博客',
  'settings.mapping.broken.desc':
    '{names} 的名称与店铺实际不符。发布这些栏目会直接失败（运行时找不到 Blog）。',
  'settings.mapping.broken.fix.before': '修法：把 ',
  'settings.mapping.broken.fix.middle': ' 里的 ',
  'settings.mapping.broken.fix.after':
    ' 改成右侧「店铺实际」的值，或在 Shopify 后台把博客改成配置里的名字。',
  'settings.mapping.ok.title': '全部栏目都能匹配到店铺博客',
  'settings.mapping.ok.titleOnly.before':
    '其中 {count} 个是**靠标题**匹配成功的（handle 不一致）：{names}。标题随时可能被改动，建议把 ',
  'settings.mapping.ok.titleOnly.after': ' 也修正为店铺实际值。',
  'settings.mapping.col.channel': '栏目',
  'settings.mapping.col.blogName': '配置的 blogName',
  'settings.mapping.col.blogHandle': '配置的 blogHandle',
  'settings.mapping.col.actual': '店铺实际',
  'settings.mapping.col.status': '状态',
  'settings.mapping.status.titleOnly': '仅标题',
  'settings.mapping.status.missing': '找不到',
  'settings.mapping.unused': '店铺里未被任何栏目使用的博客：{names}',
  'settings.mapping.blogWithHandle': '{name}（{handle}）',

  // ---------------- 发布默认值 ----------------
  'settings.section.defaults': '发布默认值',
  'settings.section.defaults.desc':
    '新建排期与发布时的默认值，可在栏目页逐篇覆盖。',
  'settings.defaultAuthor': '默认作者',
  'settings.defaultAuthor.placeholder': 'Author Name',
  'settings.defaultAuthor.desc': '作为 Shopify metaobject 引用写入文章。',
  'settings.defaultAuthor.required': '请填写默认作者',
  'settings.timezone': '默认时区',
  'settings.timezone.desc':
    '定时发布的时间按此时区解释并转换为带偏移的 ISO 时间。',
  'settings.timezone.asiaShanghai':
    'Asia/Shanghai（中国标准时间，UTC+8）— 默认',
  'settings.timezone.americaNewYork': 'America/New_York（美国东部，UTC-5/-4）',
  'settings.timezone.americaLosAngeles':
    'America/Los_Angeles（美国西部，UTC-8/-7）',
  'settings.timezone.europeLondon': 'Europe/London（伦敦，UTC+0/+1）',
  'settings.timezone.europeBerlin': 'Europe/Berlin（柏林，UTC+1/+2）',
  'settings.timezone.asiaTokyo': 'Asia/Tokyo（日本，UTC+9）',
  'settings.timezone.asiaSingapore': 'Asia/Singapore（新加坡，UTC+8）',
  'settings.timezone.australiaSydney': 'Australia/Sydney（悉尼，UTC+10/+11）',
  'settings.timezone.utc': 'UTC（协调世界时）',
  'settings.publishTime': '默认发布时间',
  'settings.publishTime.desc': '新建排期时的默认时刻。',
  'settings.publishTime.format': '格式应为 HH:mm',
  'settings.defaultReviewers': '默认审核人',
  'settings.defaultReviewers.placeholder': '每行一个，或用逗号分隔',
  'settings.defaultReviewers.desc':
    'reviewer metaobject 引用，缺失时发布器会跳过该字段。',
  'settings.templateChoices': '页面模板清单',
  'settings.templateChoices.placeholder':
    '每行一个 templateSuffix，例如 community_post',
  'settings.templateChoices.desc':
    '「Custom 文章」的模板选择器会列出这些模板。留空则用内置的 5 个栏目模板。',
  'settings.templateChoices.desc2.before': '如果能读店铺主题（需要 ',
  'settings.templateChoices.desc2.middle': ' 权限），会优先列出主题里 实际的 ',
  'settings.templateChoices.desc2.after': '，这份清单作为兜底。',
  'settings.relatedProductTitles': '关联产品标题池',
  'settings.relatedProductTitles.placeholder': '每行一个产品标题',
  'settings.relatedProductTitles.desc.before': '用于替换正文中的 ',
  'settings.relatedProductTitles.desc.after':
    ' 占位符， 发布器按标题解析为 product GID。',
  'settings.save': '保存并下发',
  'settings.save.hint': '保存后所有栏目发布器读取同一份配置。',

  // ---------------- 保存反馈 ----------------
  'settings.save.success': '设置已保存，所有栏目发布器立即生效',
  'settings.verify.success': 'Shopify 连接正常',
  'settings.verify.failed': '连接失败',

  // ---------------- 列表分隔符 ----------------
  'settings.listSeparator': '、',
  'settings.listJoin': '，',
}

export const en = {
  // ---------------- 设置页外壳 ----------------
  'settings.page.desc':
    'Shopify store, token and publishing defaults — maintained in one place, shared by every channel.',
  'settings.sidebar.placeholder': 'Settings',

  // ---------------- 外观 ----------------
  'settings.appearance.title': 'Appearance',
  'settings.appearance.desc':
    'Customize the appearance of the app. Automatically switch between day and night themes.',
  'settings.appearance.font': 'Font',
  'settings.appearance.font.desc':
    'Set the font you want to use in the dashboard.',
  'settings.appearance.theme.desc': 'Select the theme for the dashboard.',
  'settings.appearance.submit': 'Update preferences',

  // ---------------- Shopify 连接 ----------------
  'settings.section.connection': 'Shopify connection',
  'settings.section.connection.desc':
    'Store domain and Admin API version. Both are shared by every publisher.',
  'settings.shop.domain': 'Store domain',
  'settings.shop.domain.placeholder': 'your-store.myshopify.com',
  'settings.shop.domain.required': 'Enter your store domain',
  'settings.shop.domain.format': 'Must look like xxx.myshopify.com',
  'settings.shop.apiVersion': 'Admin API version',
  'settings.shop.apiVersion.placeholder': '2026-04',
  'settings.shop.apiVersion.desc':
    'The original script used 2026-04. Run a connection check before upgrading.',
  'settings.shop.apiVersion.required': 'Enter an API version',

  // ---------------- Token ----------------
  'settings.token.section': 'Access token',
  'settings.token.section.desc':
    'The token only needs to be maintained here; saving applies to all 10 channels immediately.',
  'settings.token.notice.title':
    'Note: auto-issued tokens are valid for roughly 24 hours',
  'settings.token.notice.before': 'Tokens exchanged through Shopify ',
  'settings.token.notice.after':
    ' were measured to expire after 86,398 seconds (24 hours). The platform therefore treats the access token as a **derived credential** rather than configuration: CLIENT_ID / CLIENT_SECRET are stored for the long term, while the access token is cached in memory and renewed automatically before it expires. Prefer “Auto-renew”.',
  'settings.token.source': 'Token source',
  // source label / hint / warning live on `TOKEN_SOURCE_META` (src/types/content.ts),
  // whose copy is owned by the shell area (`shell.tokenSource.*`).
  'settings.token.neverExpires': 'Never expires',
  'settings.token.missingCredentials':
    'No CLIENT_ID / CLIENT_SECRET detected. Configure them in .env and restart the backend.',
  'settings.token.newToken': 'New token',
  'settings.token.placeholder': 'shpat_... (leave blank to keep current)',
  'settings.token.reveal': 'Show',
  'settings.token.hide': 'Hide',
  'settings.token.desc':
    'Stored in a local 0600 file; the UI only shows a mask. If the token has ever appeared in the repository, reissue it in Shopify admin.',
  'settings.token.verify': 'Check connection',
  'settings.token.verify.shop': 'Store {name}',
  'settings.token.verify.scopes': 'scopes {scopes}',
  'settings.token.verify.blogMissing':
    ' (blog publishing still missing: {scopes})',
  'settings.token.verify.failed': 'Failed: {error}',
  'settings.token.verify.errorTitle': 'Connection check failed',
  'settings.token.verify.missingScopes': 'Missing scopes: {scopes}',
  'settings.token.verify.blogScopesHint':
    'Publishing pages is unaffected, but publishing blog articles also needs: {scopes}',
  'settings.token.refresh': 'Renew now',
  'settings.token.refresh.success': 'Token renewed',

  // ---------------- 令牌状态面板 ----------------
  'settings.token.current': 'In use',
  'settings.token.pending':
    'Credentials configured — the token is exchanged on first call',
  'settings.token.absent': 'No token configured, publishing unavailable',
  'settings.token.neverExpiresLong':
    'Long-lived (this source is never renewed automatically)',
  // 中文是「剩余 + 片段」，英文把语义写进片段里（这样过期时不会出现 “expired left”）
  'settings.token.remaining': '{remaining}',
  'settings.token.expiresAt': '· expires {at}',
  'settings.token.lastRefreshed': 'Last refreshed {time}',
  'settings.token.lastError': 'Most recent error: {error}',
  'settings.token.remaining.expired': 'expired',
  'settings.token.remaining.daysHours': 'expires in {days} d {hours} h',
  'settings.token.remaining.hoursMinutes': 'expires in {hours} h {minutes} m',
  'settings.token.remaining.minutes': 'expires in {minutes} m',

  // ---------------- 数据同步（对账） ----------------
  'settings.sync.tracked': 'Tracked',
  'settings.sync.tracked.scheduled': '({count} scheduled)',
  'settings.sync.lastSync': 'Last synced {time}',
  'settings.sync.never': 'Not synced yet',
  'settings.sync.auto': 'Auto sync',
  'settings.sync.auto.every': 'every {minutes} min',
  'settings.sync.auto.off': 'off',
  'settings.sync.run': 'Sync now',
  'settings.sync.timezone': '(timezone {timezone})',
  'settings.sync.noCredentials':
    'Store credentials are not configured, so reconciliation is unavailable. Fill in CLIENT_ID / CLIENT_SECRET above first.',
  'settings.sync.note.before':
    'Scheduled publishing is executed by Shopify itself (the future publish date is set at creation time), so ',
  'settings.sync.note.strong': 'this platform runs no local scheduler',
  'settings.sync.note.after':
    ' and nothing is missed when the service is down. Reconciliation only pulls the real state back from Shopify.',
  'settings.sync.toast.failed': 'Sync failed: {error}',
  'settings.sync.toast.pulled': 'pulled {count} scheduled items',
  'settings.sync.toast.fixed': 'corrected {count} items',
  'settings.sync.toast.consistent': 'checked {count} items, all consistent',
  'settings.sync.result.pulled': 'Pulled {count} unpublished scheduled items',
  'settings.sync.result.found':
    '({count} future scheduled items on Shopify in total)',
  'settings.sync.result.byChannel': 'By channel',
  'settings.sync.result.skipped':
    'Skipped {count} items (belonging to no channel)',
  'settings.sync.result.checked': 'Checked {count} items',
  'settings.sync.result.consistent': '· local matches Shopify',
  'settings.sync.result.drift': '· corrected {count}',
  'settings.sync.result.updated': ' (status updated {count}',
  'settings.sync.result.goneOnly': ' (removed on Shopify {count}',
  'settings.sync.result.goneMore': ', removed on Shopify {count}',
  'settings.sync.result.close': ')',
  'settings.sync.result.goneNote':
    'Deleted objects keep a reason note in the list instead of disappearing silently.',

  // ---------------- 栏目 → 博客映射自检 ----------------
  'settings.mapping.section': 'Channel → blog mapping check',
  'settings.mapping.section.desc':
    'Compares the configured blogName / blogHandle against the store, one by one. Once a blog title changes on Shopify, any publisher matching by title breaks immediately — so inconsistencies surface here early.',
  'settings.mapping.error.title': 'Could not load the store’s blog list',
  'settings.mapping.error.hint':
    'A working token is required (troubleshoot with “Check connection” above).',
  'settings.mapping.summary':
    '{channels} blog channels configured, {blogs} blogs in the store',
  'settings.mapping.recheck': 'Re-check',
  'settings.mapping.broken.title':
    '{count} channels have no matching blog in the store',
  'settings.mapping.broken.desc':
    '{names} do not match the store. Publishing these channels fails outright (no Blog found at runtime).',
  'settings.mapping.broken.fix.before': 'Fix: either change ',
  'settings.mapping.broken.fix.middle': ' in ',
  'settings.mapping.broken.fix.after':
    ' to the “Actual in store” value on the right, or rename the blogs in Shopify admin to match the configuration.',
  'settings.mapping.ok.title': 'Every channel matches a store blog',
  'settings.mapping.ok.titleOnly.before':
    '{count} of them matched by **title** only (handle differs): {names}. Titles can change at any time, so consider fixing ',
  'settings.mapping.ok.titleOnly.after': ' to the actual store value too.',
  'settings.mapping.col.channel': 'Channel',
  'settings.mapping.col.blogName': 'Configured blogName',
  'settings.mapping.col.blogHandle': 'Configured blogHandle',
  'settings.mapping.col.actual': 'Actual in store',
  'settings.mapping.col.status': 'Status',
  'settings.mapping.status.titleOnly': 'Title only',
  'settings.mapping.status.missing': 'Not found',
  'settings.mapping.unused': 'Blogs in the store used by no channel: {names}',
  'settings.mapping.blogWithHandle': '{name} ({handle})',

  // ---------------- 发布默认值 ----------------
  'settings.section.defaults': 'Publishing defaults',
  'settings.section.defaults.desc':
    'Defaults for new schedules and publishing; each item can override them on its channel page.',
  'settings.defaultAuthor': 'Default author',
  'settings.defaultAuthor.placeholder': 'Author Name',
  'settings.defaultAuthor.desc':
    'Written into articles as a Shopify metaobject reference.',
  'settings.defaultAuthor.required': 'Enter a default author',
  'settings.timezone': 'Default timezone',
  'settings.timezone.desc':
    'Scheduled publish times are interpreted in this timezone and converted to an ISO time with offset.',
  'settings.timezone.asiaShanghai':
    'Asia/Shanghai (China Standard Time, UTC+8) — default',
  'settings.timezone.americaNewYork': 'America/New_York (US Eastern, UTC-5/-4)',
  'settings.timezone.americaLosAngeles':
    'America/Los_Angeles (US Pacific, UTC-8/-7)',
  'settings.timezone.europeLondon': 'Europe/London (London, UTC+0/+1)',
  'settings.timezone.europeBerlin': 'Europe/Berlin (Berlin, UTC+1/+2)',
  'settings.timezone.asiaTokyo': 'Asia/Tokyo (Japan, UTC+9)',
  'settings.timezone.asiaSingapore': 'Asia/Singapore (Singapore, UTC+8)',
  'settings.timezone.australiaSydney': 'Australia/Sydney (Sydney, UTC+10/+11)',
  'settings.timezone.utc': 'UTC (Coordinated Universal Time)',
  'settings.publishTime': 'Default publish time',
  'settings.publishTime.desc': 'Default time of day for new schedules.',
  'settings.publishTime.format': 'Must be in HH:mm format',
  'settings.defaultReviewers': 'Default reviewers',
  'settings.defaultReviewers.placeholder': 'One per line, or comma-separated',
  'settings.defaultReviewers.desc':
    'reviewer metaobject references; publishers skip the field when it is missing.',
  'settings.templateChoices': 'Page template list',
  'settings.templateChoices.placeholder':
    'One templateSuffix per line, e.g. community_post',
  'settings.templateChoices.desc':
    'These templates are offered by the “Custom” article template picker. Leave empty to use the 5 built-in channel templates.',
  'settings.templateChoices.desc2.before':
    'When the store theme is readable (requires the ',
  'settings.templateChoices.desc2.middle': ' scope), the theme’s actual ',
  'settings.templateChoices.desc2.after':
    ' files are listed first; this list is the fallback.',
  'settings.relatedProductTitles': 'Related product title pool',
  'settings.relatedProductTitles.placeholder': 'One product title per line',
  'settings.relatedProductTitles.desc.before': 'Used to replace the ',
  'settings.relatedProductTitles.desc.after':
    ' placeholder in the body; publishers resolve titles to product GIDs.',
  'settings.save': 'Save and apply',
  'settings.save.hint':
    'After saving, every channel publisher reads the same configuration.',

  // ---------------- 保存反馈 ----------------
  'settings.save.success':
    'Settings saved — all channel publishers take effect immediately',
  'settings.verify.success': 'Shopify connection is healthy',
  'settings.verify.failed': 'Connection failed',

  // ---------------- 列表分隔符 ----------------
  'settings.listSeparator': ', ',
  'settings.listJoin': ', ',
}
