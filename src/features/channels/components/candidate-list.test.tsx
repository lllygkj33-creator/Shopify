import type { ParsedCandidate } from '@/types/content'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { I18nProvider } from '@/context/i18n-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CandidateList, type PublishPlan } from './candidate-list'

/**
 * 候选列表（第 3 步「核对并发布」）的双语。
 *
 * 为什么要单独一个文件：候选列表只在选中文件夹之后才渲染，直接渲染栏目页
 * 拿不到它。这里用 fixture 造两条内容 —— 一条通过、一条有校验错误 ——
 * 把「校验」列的三种状态（错误 / 提示 / 通过）和发布方式下拉都钉住。
 */
function candidate(
  overrides: Partial<ParsedCandidate> & Pick<ParsedCandidate, 'tempId'>
): ParsedCandidate {
  return {
    channelId: 'community-post',
    contentType: 'page',
    title: 'Example Community Post',
    handle: '/pages/example-post',
    bodyHtml: '<h2>Body</h2>',
    sourceFile: 'example-post.json',
    sourceIndex: 0,
    publishKey: 'community-post|example-post|0',
    issues: [],
    publishable: true,
    ...overrides,
  }
}

const CLEAN = candidate({ tempId: 'clean' })
const BROKEN = candidate({
  tempId: 'broken',
  title: '',
  handle: '',
  template: undefined,
  publishable: false,
  issues: [
    { level: 'error', field: 'title', message: '缺少页面标题' },
    { level: 'warning', field: 'author', message: '未指定作者' },
  ],
})

const PLANS: Record<string, PublishPlan> = {
  clean: { mode: 'now', wallTime: '' },
  broken: { mode: 'schedule', wallTime: '' },
}

/**
 * 表头文案。为什么不用 `getByRole('columnheader')`：这个表格在测试容器里
 * 的 `<th>` 被无障碍树算成了 `table-cell`（`<table>` 的隐式角色没被继承），
 * 而按文本找又会撞上「校验 / 校验通过」这种包含关系，所以直接读表头单元格文本。
 */
function columnHeaders(): string[] {
  return Array.from(document.querySelectorAll('thead th')).map(
    (cell) => cell.textContent?.trim() ?? ''
  )
}

async function renderList(lang: 'zh' | 'en') {
  document.cookie = `content-publisher-lang=${lang}`
  return await render(
    <I18nProvider>
      <TooltipProvider>
        <CandidateList
          candidates={[CLEAN, BROKEN]}
          plans={PLANS}
          selected={new Set(['clean'])}
          timezone='Asia/Shanghai'
          busy={false}
          onToggle={vi.fn()}
          onToggleAll={vi.fn()}
          onPlanChange={vi.fn()}
        />
      </TooltipProvider>
    </I18nProvider>
  )
}

describe('候选列表双语', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('中文：表头、校验列与发布方式都是中文', async () => {
    const screen = await renderList('zh')

    // 表头文案（第 5 个是本行的错误数徽标不算表头，只取表头行）
    expect(columnHeaders()).toEqual([
      '',
      '文章',
      '发布目标',
      '校验',
      '发布方式',
    ])

    // 校验列的三种状态
    await expect.element(screen.getByText('校验通过')).toBeInTheDocument()
    await expect.element(screen.getByText('1 项错误')).toBeInTheDocument()
    // 空标题 / 空 handle 的兜底文案
    await expect.element(screen.getByText('(无标题)')).toBeInTheDocument()
    await expect.element(screen.getByText('(无 handle)')).toBeInTheDocument()

    // 发布方式下拉里的当前值
    await expect.element(screen.getByText('立即发布')).toBeInTheDocument()
    await expect.element(screen.getByText('定时发布')).toBeInTheDocument()
  })

  it('英文：表头、校验列与发布方式都是英文', async () => {
    const screen = await renderList('en')

    expect(columnHeaders()).toEqual([
      '',
      'Article',
      'Destination',
      'Validation',
      'Publish mode',
    ])

    await expect.element(screen.getByText('Passed')).toBeInTheDocument()
    await expect.element(screen.getByText('1 error(s)')).toBeInTheDocument()
    await expect.element(screen.getByText('(untitled)')).toBeInTheDocument()
    await expect.element(screen.getByText('(no handle)')).toBeInTheDocument()

    await expect.element(screen.getByText('Publish now')).toBeInTheDocument()
    await expect.element(screen.getByText('Schedule')).toBeInTheDocument()
  })
})
