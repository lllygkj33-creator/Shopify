import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Channel } from '@/config/channels'
import { channelLabel } from '@/i18n/channel-label'
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
import { useI18n } from '@/context/i18n-provider'
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
import { LangSwitch } from '@/components/lang-switch'
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
  const { t, lang } = useI18n()
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
        toast.success(
          t('channels.toast.submitted', { count: data.items.length })
        )
      } else {
        toast.warning(
          t('channels.toast.partial', {
            total: data.items.length,
            failed: failed.length,
          })
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
        <LangSwitch />
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
              {channelLabel(channel, lang)}
            </h1>
            <p className='flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
              <span>
                {t('channels.folder')}{' '}
                <code className='rounded bg-muted px-1'>
                  {channel.defaultFolder}/
                </code>
              </span>
              <Badge variant='secondary' className='font-normal'>
                {channel.contentType === 'blog_article'
                  ? t('channels.contentType.blog')
                  : t('channels.contentType.page')}
              </Badge>
              {channel.blogName && (
                <span>{t('channels.blog', { name: channel.blogName })}</span>
              )}
              {channel.template && (
                <span>
                  {t('channels.template', { name: channel.template })}
                </span>
              )}
            </p>
          </div>
        </div>

        {USE_MOCK && (
          <Alert className='mb-4'>
            <AlertTitle>{t('channels.mock.title')}</AlertTitle>
            <AlertDescription>
              {t('channels.mock.description')}
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue='publish' className='space-y-4'>
          <TabsList>
            <TabsTrigger value='publish'>
              {t('channels.tab.publish')}
            </TabsTrigger>
            <TabsTrigger value='history'>
              {t('channels.tab.history')}
            </TabsTrigger>
          </TabsList>

          {/* ================= 上传与发布 ================= */}
          <TabsContent value='publish' className='space-y-4'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>
                  {t('channels.step.folder.title')}
                </CardTitle>
                <CardDescription>
                  {t('channels.step.folder.description')}
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
                        {t('channels.file.imported', {
                          files: bold(parsedFiles.length),
                          items: bold(candidates.length),
                        })}
                        {validating && (
                          <span className='text-muted-foreground'>
                            {t('channels.file.validating')}
                          </span>
                        )}
                        {blockedCount > 0 && (
                          <span className='text-destructive'>
                            {t('channels.file.blocked', {
                              count: blockedCount,
                            })}
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
                        {t('channels.file.clear')}
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
                            <span className='text-destructive'>
                              {t('channels.file.parseFailed')}
                            </span>
                          ) : (
                            <span className='text-muted-foreground'>
                              {t('channels.file.count', {
                                count: file.candidates.length,
                              })}{' '}
                              ·{' '}
                              {file.detected === 'blog_article'
                                ? t('channels.file.kind.article')
                                : t('channels.file.kind.page')}
                            </span>
                          )}
                        </Badge>
                      ))}
                    </div>

                    {fileErrors.length > 0 && (
                      <Alert variant='destructive'>
                        <AlertTitle>
                          {t('channels.file.error.title', {
                            count: fileErrors.length,
                          })}
                        </AlertTitle>
                        <AlertDescription>
                          <ul className='mt-1 list-disc space-y-0.5 ps-4 text-xs'>
                            {fileErrors.map((file) => (
                              <li key={file.filePath}>
                                {t('channels.file.error.item', {
                                  file: mono(file.fileName),
                                  message: file.error ?? '',
                                })}
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
                    <CardTitle className='text-base'>
                      {t('channels.step.plan.title')}
                    </CardTitle>
                    <CardDescription>
                      {t('channels.step.plan.description', {
                        count: publishableSelected.length,
                        timezone,
                        offset: formatTimezoneOffset(timezone),
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='flex flex-wrap items-end gap-3'>
                    <div className='space-y-1.5'>
                      <Label className='text-xs text-muted-foreground'>
                        {t('channels.batch.time')}
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
                      {t('channels.batch.scheduleAll')}
                    </Button>
                    <Button
                      variant='outline'
                      onClick={() => applyBatchMode('now')}
                      disabled={publishableSelected.length === 0}
                    >
                      <Rocket className='size-4' />
                      {t('channels.batch.publishAllNow')}
                    </Button>
                    <Button
                      variant='outline'
                      onClick={() => applyBatchMode('draft')}
                      disabled={publishableSelected.length === 0}
                    >
                      <Clock className='size-4' />
                      {t('channels.batch.draftAll')}
                    </Button>
                  </CardContent>
                </Card>

                {/* ---------- 候选列表 ---------- */}
                <Card>
                  <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3 space-y-0'>
                    <div>
                      <CardTitle className='text-base'>
                        {t('channels.step.review.title')}
                      </CardTitle>
                      <CardDescription>
                        {t('channels.step.review.description')}
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
                      {t('channels.publish.submit', {
                        count: publishableSelected.length,
                      })}
                    </Button>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    {scheduleMissing && (
                      <Alert variant='destructive'>
                        <AlertTitle>
                          {t('channels.alert.scheduleMissing.title')}
                        </AlertTitle>
                        <AlertDescription>
                          {t('channels.alert.scheduleMissing.description')}
                        </AlertDescription>
                      </Alert>
                    )}

                    {scheduleInPast.length > 0 && (
                      <Alert variant='destructive'>
                        <AlertTitle>
                          {t('channels.alert.scheduleInPast.title', {
                            count: scheduleInPast.length,
                          })}
                        </AlertTitle>
                        <AlertDescription>
                          {t('channels.alert.scheduleInPast.description')}
                          <span className='mt-1 block text-xs'>
                            {scheduleInPast
                              .map((candidate) => candidate.title)
                              .join(lang === 'zh' ? '、' : ', ')}
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
                <CardTitle className='text-base'>
                  {t('channels.history.title')}
                </CardTitle>
                <CardDescription>
                  {t('channels.history.description')}
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

/**
 * 把 `<strong>` 这类行内元素当普通值塞进文案。
 *
 * `t()` 的签名只收 `string | number`，但占位符替换是纯字符串替换：JSX 元素被
 * `String()` 转成 `[object Object]` 后仍留在结果字符串里，而 React 渲染字符串时
 * 读的是 `$$typeof`，所以加粗的数字照常显示。类型上必须 `as never`。
 */
function bold(value: string | number): never {
  return (<strong>{value}</strong>) as never
}

function mono(value: string): never {
  return (<span className='font-mono'>{value}</span>) as never
}

function PublishResultPanel({ result }: { result: PublishResult }) {
  const { t } = useI18n()
  const ok = result.items.filter((item) => item.status !== 'failed')
  const failed = result.items.filter((item) => item.status === 'failed')

  return (
    <div className='space-y-2 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center gap-3 text-sm'>
        <span className='flex items-center gap-1.5 text-emerald-600'>
          <CheckCircle2 className='size-4' />
          {t('channels.result.ok', { count: ok.length })}
        </span>
        {failed.length > 0 && (
          <span className='flex items-center gap-1.5 text-destructive'>
            <XCircle className='size-4' />
            {t('channels.result.failed', { count: failed.length })}
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
                  {t('channels.result.backlink', {
                    status:
                      item.backlinkResult === 'ADDED'
                        ? t('channels.result.backlink.added')
                        : t('channels.result.backlink.skipped'),
                  })}
                </span>
              )}
              {item.backlinkError && (
                <span className='block text-amber-600'>
                  {t('channels.result.backlinkFailed', {
                    message: item.backlinkError,
                  })}
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
