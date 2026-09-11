import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Channel } from '@/config/channels'
import type {
  ParsedCandidate,
  ParsedFile,
  PublishResult,
} from '@/types/content'
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  FileJson,
  Loader2,
  Rocket,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  publishApi,
  settingsApi,
  templatesApi,
  USE_MOCK,
  validateApi,
} from '@/lib/api'
import {
  DEFAULT_TIMEZONE,
  defaultScheduleWallTime,
  formatTimezoneOffset,
  isPastWallTime,
  wallTimeToIso,
} from '@/lib/datetime'
import { parseJsonContent } from '@/lib/shopify-json'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CandidateList, type PublishPlan } from './components/candidate-list'
import { FolderDropzone, type PickedFile } from './components/folder-dropzone'
import { HistoryTable } from './components/history-table'

type ChannelPageProps = {
  channel: Channel
}

export function ChannelPage({ channel }: ChannelPageProps) {
  const queryClient = useQueryClient()
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([])
  const [plans, setPlans] = useState<Record<string, PublishPlan>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<PublishResult | null>(null)
  const [batchWallTime, setBatchWallTime] = useState('')
  const [validating, setValidating] = useState(false)

  // 模板自由的栏目（Custom 文章）才需要可选模板清单
  const templateFree = Boolean(channel.pageSpec?.allowAnyTemplate)
  const templatesQuery = useQuery({
    queryKey: ['theme-templates'],
    queryFn: () => templatesApi.list(),
    enabled: templateFree,
  })

  /** 改模板：直接改候选上的 template，改动会自动流进发布载荷 */
  const setTemplate = useCallback((tempId: string, template: string) => {
    setParsedFiles((previous) =>
      previous.map((file) => ({
        ...file,
        candidates: file.candidates.map((candidate) =>
          candidate.tempId === tempId ? { ...candidate, template } : candidate
        ),
      }))
    )
  }, [])

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  })
  const timezone = settingsQuery.data?.defaultTimezone ?? DEFAULT_TIMEZONE

  // 默认排期时间：优先用设置里的默认发布时间，退化为「24 小时后」
  const defaultWallTime = useMemo(
    () => defaultScheduleWallTime(timezone, 24),
    [timezone]
  )

  /**
   * 解析结果直接进 state，而不是从「已选文件列表」派生：
   * 这样「初始化发布计划与默认勾选」可以在**选择文件的那一刻**完成，
   * 不需要用 useEffect 去同步派生的 candidates（那会触发级联渲染）。
   */
  const candidates: ParsedCandidate[] = useMemo(
    () => parsedFiles.flatMap((file) => file.candidates),
    [parsedFiles]
  )

  const fileErrors = parsedFiles.filter((file) => file.error)

  /**
   * 后端权威校验：本地规则只做即时反馈，链接/图片那类复杂规则以后端为准。
   * 把结果合并进候选（用 tempId 对齐），并重新计算勾选状态。
   */
  const mergeBackendValidation = useCallback(async (parsed: ParsedFile[]) => {
    const items = parsed.flatMap((file) => file.candidates)
    if (USE_MOCK || items.length === 0) return

    setValidating(true)
    try {
      const results = await validateApi.check(
        items.map((candidate) => ({
          candidateTempId: candidate.tempId,
          channelId: candidate.channelId,
          contentType: candidate.contentType,
          title: candidate.title,
          handle: candidate.handle,
          bodyHtml: candidate.bodyHtml,
          summary: candidate.summary,
          metaTitle: candidate.metaTitle,
          metaDescription: candidate.metaDescription,
          blogName: candidate.blogName,
          template: candidate.template,
          source: candidate.source,
          sourceKey: candidate.sourceKey,
          sourceFile: candidate.sourceFile,
        }))
      )

      const byId = new Map(results.map((item) => [item.candidateTempId, item]))

      setParsedFiles((previous) => {
        const next = previous.map((file) => ({
          ...file,
          candidates: file.candidates.map((candidate) => {
            const verdict = byId.get(candidate.tempId)
            if (!verdict) return candidate
            return {
              ...candidate,
              // 后端问题追加在后端发现的问题之后
              issues: [...candidate.issues, ...verdict.issues],
              publishable: candidate.publishable && verdict.publishable,
            }
          }),
        }))

        // 校验后变成不可发布的条目要取消勾选
        const stillPublishable = new Set(
          next
            .flatMap((file) => file.candidates)
            .filter((candidate) => candidate.publishable)
            .map((candidate) => candidate.tempId)
        )
        setSelected((previousSelected) => {
          const filtered = new Set<string>()
          for (const tempId of previousSelected) {
            if (stillPublishable.has(tempId)) filtered.add(tempId)
          }
          return filtered
        })

        return next
      })
    } catch {
      // 后端不可用就沿用本地校验结果，不阻断流程
    } finally {
      setValidating(false)
    }
  }, [])

  /** 选择文件夹后：解析 + 初始化每篇的发布方式与默认勾选 */
  const handleFiles = useCallback(
    (files: PickedFile[]) => {
      const parsed = files.map((file) =>
        parseJsonContent(file.text, file.path, channel.id)
      )
      const flat = parsed.flatMap((file) => file.candidates)

      const nextPlans: Record<string, PublishPlan> = {}
      const nextSelected = new Set<string>()
      for (const candidate of flat) {
        nextPlans[candidate.tempId] = {
          mode: 'schedule',
          wallTime: defaultWallTime,
        }
        // 校验通过的默认勾选，有错误的必须先修 JSON
        if (candidate.publishable) nextSelected.add(candidate.tempId)
      }

      setParsedFiles(parsed)
      setPlans(nextPlans)
      setSelected(nextSelected)
      setResult(null)
      setBatchWallTime(defaultWallTime)

      // 再跑一次后端权威校验（含本地没有的链接/图片规则）
      void mergeBackendValidation(parsed)
    },
    [channel.id, defaultWallTime, mergeBackendValidation]
  )

  const clearFiles = useCallback(() => {
    setParsedFiles([])
    setPlans({})
    setSelected(new Set())
    setResult(null)
  }, [])

  const publishableSelected = candidates.filter(
    (candidate) => selected.has(candidate.tempId) && candidate.publishable
  )

  const publish = useMutation({
    mutationFn: () =>
      publishApi.submit(
        publishableSelected.map((candidate) => {
          const plan = plans[candidate.tempId]
          return {
            candidate,
            mode: plan.mode,
            scheduledAt:
              plan.mode === 'schedule'
                ? wallTimeToIsoSafe(plan.wallTime, timezone)
                : undefined,
          }
        })
      ),
    onSuccess: (data) => {
      setResult(data)
      const failed = data.items.filter((item) => item.status === 'failed')
      if (failed.length === 0) {
        toast.success(`已提交 ${data.items.length} 篇`)
      } else {
        toast.warning(
          `已提交 ${data.items.length} 篇，其中 ${failed.length} 篇失败`
        )
      }
      queryClient.invalidateQueries({ queryKey: ['timeline'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['history'] })
      queryClient.invalidateQueries({ queryKey: ['contents'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  /** 定时模式缺时间的，要在提交前拦下来 */
  const scheduleMissing = publishableSelected.some(
    (candidate) =>
      plans[candidate.tempId]?.mode === 'schedule' &&
      !plans[candidate.tempId]?.wallTime
  )

  /** 定时时间已经过去的条目（后端与脚本都会拒绝） */
  const scheduleInPast = publishableSelected.filter((candidate) => {
    const plan = plans[candidate.tempId]
    return (
      plan?.mode === 'schedule' &&
      Boolean(plan.wallTime) &&
      isPastWallTime(plan.wallTime, timezone)
    )
  })

  const toggle = (tempId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(tempId)) next.delete(tempId)
      else next.add(tempId)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelected(
      checked
        ? new Set(
            candidates
              .filter((candidate) => candidate.publishable)
              .map((candidate) => candidate.tempId)
          )
        : new Set()
    )
  }

  const updatePlan = (tempId: string, patch: Partial<PublishPlan>) => {
    setPlans((prev) => ({
      ...prev,
      [tempId]: { ...prev[tempId], ...patch },
    }))
  }

  const applyBatchMode = (mode: PublishPlan['mode']) => {
    setPlans((prev) => {
      const next = { ...prev }
      for (const candidate of publishableSelected) {
        next[candidate.tempId] = {
          ...next[candidate.tempId],
          mode,
          wallTime: next[candidate.tempId]?.wallTime || defaultWallTime,
        }
      }
      return next
    })
  }

  const applyBatchTime = (wallTime: string) => {
    setBatchWallTime(wallTime)
    setPlans((prev) => {
      const next = { ...prev }
      for (const candidate of publishableSelected) {
        if (next[candidate.tempId]) {
          next[candidate.tempId] = {
            ...next[candidate.tempId],
            mode: 'schedule',
            wallTime,
          }
        }
      }
      return next
    })
  }

  const blockedCount = candidates.filter(
    (candidate) => !candidate.publishable
  ).length

  return (
    <>
      <Header>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
      </Header>

      <Main>
        {/* ---------- 栏目头 ---------- */}
        <div className='mb-4 flex flex-wrap items-start justify-between gap-3'>
          <div className='space-y-1'>
            <h1 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
              <span
                className='size-3 rounded-full'
                style={{ backgroundColor: channel.color }}
              />
              {channel.nameZh ?? channel.name}
            </h1>
            <p className='flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
              <span>
                默认文件夹{' '}
                <code className='rounded bg-muted px-1'>
                  {channel.defaultFolder}/
                </code>
              </span>
              <Badge variant='secondary' className='font-normal'>
                {channel.contentType === 'blog_article' ? '博客文章' : '页面'}
              </Badge>
              {channel.blogName && <span>博客：{channel.blogName}</span>}
              {channel.template && <span>模板：{channel.template}</span>}
            </p>
          </div>
        </div>

        {USE_MOCK && (
          <Alert className='mb-4'>
            <AlertTitle>演示数据模式</AlertTitle>
            <AlertDescription>
              解析与校验是真实逻辑（与后端同规则），但发布结果由本地模拟返回。
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue='publish' className='space-y-4'>
          <TabsList>
            <TabsTrigger value='publish'>上传与发布</TabsTrigger>
            <TabsTrigger value='history'>历史记录</TabsTrigger>
          </TabsList>

          {/* ================= 上传与发布 ================= */}
          <TabsContent value='publish' className='space-y-4'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>1. 选择本地文件夹</CardTitle>
                <CardDescription>
                  JSON 结构会自动识别：数组 → 博客文章，单对象 → 页面。
                  单个文件出错不会影响其他文件。
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <FolderDropzone
                  onFiles={handleFiles}
                  disabled={publish.isPending}
                />

                {parsedFiles.length > 0 && (
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <p className='flex items-center gap-2 text-sm'>
                        <FileJson className='size-4 text-muted-foreground' />
                        已导入 <strong>{parsedFiles.length}</strong>{' '}
                        个文件，解析出 <strong>{candidates.length}</strong>{' '}
                        条内容
                        {validating && (
                          <span className='text-muted-foreground'>
                            （正在做后端权威校验…）
                          </span>
                        )}
                        {blockedCount > 0 && (
                          <span className='text-destructive'>
                            （{blockedCount} 条有错误无法发布）
                          </span>
                        )}
                      </p>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={clearFiles}
                        disabled={publish.isPending}
                      >
                        <Trash2 className='size-4' />
                        清空
                      </Button>
                    </div>

                    <div className='flex flex-wrap gap-1.5'>
                      {parsedFiles.map((file) => (
                        <Badge
                          key={file.filePath}
                          variant='outline'
                          className='max-w-[280px] font-normal'
                        >
                          <span className='truncate'>{file.fileName}</span>
                          {file.error ? (
                            <span className='text-destructive'>解析失败</span>
                          ) : (
                            <span className='text-muted-foreground'>
                              {file.candidates.length} 条 ·{' '}
                              {file.detected === 'blog_article'
                                ? '文章'
                                : '页面'}
                            </span>
                          )}
                        </Badge>
                      ))}
                    </div>

                    {fileErrors.length > 0 && (
                      <Alert variant='destructive'>
                        <AlertTitle>
                          {fileErrors.length}{' '}
                          个文件解析失败（其余文件可正常发布）
                        </AlertTitle>
                        <AlertDescription>
                          <ul className='mt-1 list-disc space-y-0.5 ps-4 text-xs'>
                            {fileErrors.map((file) => (
                              <li key={file.filePath}>
                                <span className='font-mono'>
                                  {file.fileName}
                                </span>
                                ：{file.error}
                              </li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {candidates.length > 0 && (
              <>
                {/* ---------- 批量设置 ---------- */}
                <Card>
                  <CardHeader>
                    <CardTitle className='text-base'>2. 设置发布方式</CardTitle>
                    <CardDescription>
                      可逐篇调整；下面的批量设置作用于已勾选的{' '}
                      {publishableSelected.length} 篇。时间按 {timezone}（
                      {formatTimezoneOffset(timezone)}）解释。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='flex flex-wrap items-end gap-3'>
                    <div className='space-y-1.5'>
                      <Label className='text-xs text-muted-foreground'>
                        统一发布时间
                      </Label>
                      <Input
                        type='datetime-local'
                        value={batchWallTime}
                        onChange={(event) => applyBatchTime(event.target.value)}
                        className='w-[210px]'
                        disabled={publish.isPending}
                      />
                    </div>
                    <Button
                      variant='outline'
                      onClick={() => applyBatchMode('schedule')}
                      disabled={publishableSelected.length === 0}
                    >
                      <CalendarClock className='size-4' />
                      全部定时发布
                    </Button>
                    <Button
                      variant='outline'
                      onClick={() => applyBatchMode('now')}
                      disabled={publishableSelected.length === 0}
                    >
                      <Rocket className='size-4' />
                      全部立即发布
                    </Button>
                    <Button
                      variant='outline'
                      onClick={() => applyBatchMode('draft')}
                      disabled={publishableSelected.length === 0}
                    >
                      <Clock className='size-4' />
                      全部存为草稿
                    </Button>
                  </CardContent>
                </Card>

                {/* ---------- 候选列表 ---------- */}
                <Card>
                  <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3 space-y-0'>
                    <div>
                      <CardTitle className='text-base'>3. 核对并发布</CardTitle>
                      <CardDescription>
                        状态由 JSON 内的 <code>url</code> /{' '}
                        <code>template</code> 决定，栏目只作为默认兜底。
                      </CardDescription>
                    </div>
                    <Button
                      onClick={() => publish.mutate()}
                      disabled={
                        publish.isPending ||
                        publishableSelected.length === 0 ||
                        scheduleMissing ||
                        scheduleInPast.length > 0
                      }
                    >
                      {publish.isPending ? (
                        <Loader2 className='size-4 animate-spin' />
                      ) : (
                        <Rocket className='size-4' />
                      )}
                      发布 {publishableSelected.length} 篇
                    </Button>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    {scheduleMissing && (
                      <Alert variant='destructive'>
                        <AlertTitle>有定时发布的内容缺少时间</AlertTitle>
                        <AlertDescription>
                          请为每一篇「定时发布」的内容填写发布时间，或改用「立即发布」。
                        </AlertDescription>
                      </Alert>
                    )}

                    {scheduleInPast.length > 0 && (
                      <Alert variant='destructive'>
                        <AlertTitle>
                          有 {scheduleInPast.length} 篇的发布时间已经过去
                        </AlertTitle>
                        <AlertDescription>
                          为避免内容立即公开，Shopify
                          侧不接受已过去的时间。请改到未来时间，或改用「立即发布」。
                          <span className='mt-1 block text-xs'>
                            {scheduleInPast
                              .map((candidate) => candidate.title)
                              .join('、')}
                          </span>
                        </AlertDescription>
                      </Alert>
                    )}

                    <CandidateList
                      candidates={candidates}
                      templateOptions={
                        templateFree
                          ? (templatesQuery.data?.templates ??
                            settingsQuery.data?.templateChoices)
                          : undefined
                      }
                      templateSource={templatesQuery.data?.source}
                      templateSourceReason={templatesQuery.data?.reason}
                      onTemplateChange={setTemplate}
                      plans={plans}
                      selected={selected}
                      timezone={timezone}
                      busy={publish.isPending}
                      onToggle={toggle}
                      onToggleAll={toggleAll}
                      onPlanChange={updatePlan}
                    />

                    {result && <PublishResultPanel result={result} />}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ================= 历史记录 ================= */}
          <TabsContent value='history'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>发布历史</CardTitle>
                <CardDescription>
                  该栏目每一次发布的提交时间、状态与结果。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HistoryTable channelId={channel.id} timezone={timezone} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}

/** 把墙上时间转成 Shopify 需要的带偏移 ISO；空值返回 undefined */
function wallTimeToIsoSafe(
  wallTime: string,
  timezone: string
): string | undefined {
  if (!wallTime) return undefined
  return wallTimeToIso(wallTime, timezone)
}

function PublishResultPanel({ result }: { result: PublishResult }) {
  const ok = result.items.filter((item) => item.status !== 'failed')
  const failed = result.items.filter((item) => item.status === 'failed')

  return (
    <div className='space-y-2 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center gap-3 text-sm'>
        <span className='flex items-center gap-1.5 text-emerald-600'>
          <CheckCircle2 className='size-4' />
          成功 {ok.length}
        </span>
        {failed.length > 0 && (
          <span className='flex items-center gap-1.5 text-destructive'>
            <XCircle className='size-4' />
            失败 {failed.length}
          </span>
        )}
      </div>
      <div className='max-h-56 space-y-1 overflow-y-auto'>
        {result.items.map((item) => (
          <div
            key={item.candidateTempId}
            className='flex items-start gap-2 text-xs'
          >
            <span
              className={
                item.status === 'failed'
                  ? 'mt-0.5 text-destructive'
                  : 'mt-0.5 text-emerald-600'
              }
            >
              {item.status === 'failed' ? '✕' : '✓'}
            </span>
            <span className='min-w-0 flex-1'>
              <span className='truncate'>{item.title}</span>
              {item.backlinkResult && (
                <span className='ml-2 text-muted-foreground'>
                  反链：
                  {item.backlinkResult === 'ADDED' ? '已追加' : '已存在，跳过'}
                </span>
              )}
              {item.backlinkError && (
                <span className='block text-amber-600'>
                  页面已发布，但反链失败：{item.backlinkError}
                </span>
              )}
              {item.error && (
                <span className='block text-destructive'>{item.error}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
