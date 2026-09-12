import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { site } from '@/config/site'
import { t as translateStatic } from '@/i18n'
import {
  TOKEN_SOURCE_META,
  type ConnectionCheck,
  type TokenSource,
} from '@/types/content'
import { Eye, EyeOff, Loader2, Plug, Save } from 'lucide-react'
import { toast } from 'sonner'
import { settingsApi } from '@/lib/api'
import { TIMEZONE_OPTIONS } from '@/lib/datetime'
import { useI18n } from '@/context/i18n-provider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ChannelMappingCheck } from './channel-mapping-check'
import { SyncPanel } from './sync-panel'
import { TokenStatusPanel } from './token-status-panel'

/**
 * 全局设置（PRD §4.5 Token 统一管理）
 *
 * 设计原则：
 *  - **单一入口**：shop_domain / api_version / token / 默认作者 / 时区 只在这里维护，
 *    所有栏目发布器读取同一份配置，不再各自硬编码（解决原痛点「Token 分散」）。
 *  - **Token 双来源**：环境变量 .env 或手动输入。两者都支持，UI 上明确显示
 *    当前生效的是哪一个，避免「改了没生效」的困惑。
 *  - **不明文回显**：后端只返回掩码；用户不改就不提交该字段。
 */

/**
 * 校验提示用 `translateStatic`（非组件版 `t`）而不是组件里的 `t`：
 * zod 的 error 传函数后是**校验时**才求值，所以切换语言后提示会跟着变，
 * 不会固化成加载时的语言。
 */
const schema = z.object({
  shopDomain: z
    .string()
    .min(1, { error: () => translateStatic('settings.shop.domain.required') })
    .regex(/^[a-z0-9-]+\.myshopify\.com$/i, {
      error: () => translateStatic('settings.shop.domain.format'),
    }),
  apiVersion: z.string().min(1, {
    error: () => translateStatic('settings.shop.apiVersion.required'),
  }),
  tokenSource: z.enum(['auto', 'env', 'manual']),
  accessToken: z.string().optional(),
  defaultAuthor: z.string().min(1, {
    error: () => translateStatic('settings.defaultAuthor.required'),
  }),
  defaultReviewers: z.string().optional(),
  relatedProductTitles: z.string().optional(),
  defaultTimezone: z.string().min(1),
  defaultPublishTime: z.string().regex(/^\d{2}:\d{2}$/, {
    error: () => translateStatic('settings.publishTime.format'),
  }),
  templateChoices: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

/**
 * 时区下拉的文案在 `@/lib/datetime`（其他区域维护，只有中文），
 * 这里按 value 映射到本区域的词条。
 *
 * 映射不到时（lib 以后新增了时区）：中文界面回落原 label，**英文界面回落 value**
 * —— 英文界面宁可显示 `Asia/Kolkata`，也不能漏出汉字。
 */
const TIMEZONE_LABEL_KEY: Record<string, string> = {
  'Asia/Shanghai': 'settings.timezone.asiaShanghai',
  'America/New_York': 'settings.timezone.americaNewYork',
  'America/Los_Angeles': 'settings.timezone.americaLosAngeles',
  'Europe/London': 'settings.timezone.europeLondon',
  'Europe/Berlin': 'settings.timezone.europeBerlin',
  'Asia/Tokyo': 'settings.timezone.asiaTokyo',
  'Asia/Singapore': 'settings.timezone.asiaSingapore',
  'Australia/Sydney': 'settings.timezone.australiaSydney',
  UTC: 'settings.timezone.utc',
}

/** 连接自检结果的一行摘要 */
function verifySummary(
  check: ConnectionCheck,
  translate: (key: string, params?: Record<string, string | number>) => string
): string {
  if (!check.ok) {
    return translate('settings.token.verify.failed', {
      error: check.error ?? '',
    })
  }

  const name = `${check.shopName ?? ''}${
    check.shopDomain ? ` (${check.shopDomain})` : ''
  }`
  const scopes = check.scopes?.join(', ') || translate('common.unknown')
  const blogMissing = check.blogMissingScopes?.length
    ? translate('settings.token.verify.blogMissing', {
        scopes: check.blogMissingScopes.join(
          translate('settings.listSeparator')
        ),
      })
    : ''

  return `${translate('settings.token.verify.shop', { name })} · ${translate(
    'settings.token.verify.scopes',
    { scopes }
  )}${blogMissing}`
}

const toLines = (value?: string) =>
  (value ?? '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)

export function GlobalSettingsForm() {
  const { t, lang } = useI18n()
  const queryClient = useQueryClient()
  const [showToken, setShowToken] = useState(false)
  const [check, setCheck] = useState<ConnectionCheck | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      shopDomain: '',
      apiVersion: '2026-04',
      tokenSource: 'auto',
      accessToken: '',
      defaultAuthor: site.defaultAuthor,
      defaultReviewers: '',
      relatedProductTitles: '',
      defaultTimezone: 'Asia/Shanghai',
      defaultPublishTime: '09:30',
      templateChoices: '',
    },
  })

  useEffect(() => {
    if (!data) return
    form.reset({
      shopDomain: data.shopDomain,
      apiVersion: data.apiVersion,
      tokenSource: data.tokenSource,
      accessToken: '',
      defaultAuthor: data.defaultAuthor,
      defaultReviewers: data.defaultReviewers.join('\n'),
      relatedProductTitles: data.relatedProductTitles.join('\n'),
      defaultTimezone: data.defaultTimezone,
      defaultPublishTime: data.defaultPublishTime,
      templateChoices: data.templateChoices.join('\n'),
    })
  }, [data, form])

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      settingsApi.update({
        shopDomain: values.shopDomain.trim(),
        apiVersion: values.apiVersion.trim(),
        tokenSource: values.tokenSource,
        // 只有用户真的填了 token 才提交，避免把掩码写回去
        ...(values.accessToken?.trim()
          ? { accessToken: values.accessToken.trim() }
          : {}),
        defaultAuthor: values.defaultAuthor.trim(),
        defaultReviewers: toLines(values.defaultReviewers),
        relatedProductTitles: toLines(values.relatedProductTitles),
        defaultTimezone: values.defaultTimezone,
        defaultPublishTime: values.defaultPublishTime,
        templateChoices: toLines(values.templateChoices),
      }),
    onSuccess: () => {
      toast.success(t('settings.save.success'))
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      form.setValue('accessToken', '')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const verify = useMutation({
    mutationFn: () => settingsApi.verify(),
    onSuccess: (result) => {
      setCheck(result)
      if (result.ok) toast.success(t('settings.verify.success'))
      else toast.error(result.error ?? t('settings.verify.failed'))
    },
    onError: (error: Error) => {
      setCheck({
        ok: false,
        checkedAt: new Date().toISOString(),
        error: error.message,
      })
      toast.error(error.message)
    },
  })

  // 用 useWatch 订阅单个字段，避免 form.watch() 让 React Compiler 跳过记忆化
  const refresh = useMutation({
    mutationFn: () => settingsApi.refreshToken(),
    onSuccess: (next) => {
      toast.success(t('settings.token.refresh.success'))
      queryClient.setQueryData(['settings'], next)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const tokenSource = useWatch({ control: form.control, name: 'tokenSource' })

  if (isLoading) {
    return (
      <div className='space-y-4'>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className='h-12 w-full' />
        ))}
      </div>
    )
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
        className='space-y-8'
      >
        {/* ---------------- Shopify 连接 ---------------- */}
        <section className='space-y-4'>
          <div>
            <h3 className='text-base font-medium'>
              {t('settings.section.connection')}
            </h3>
            <p className='text-sm text-muted-foreground'>
              {t('settings.section.connection.desc')}
            </p>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='shopDomain'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('settings.shop.domain')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('settings.shop.domain.placeholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='apiVersion'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('settings.shop.apiVersion')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('settings.shop.apiVersion.placeholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('settings.shop.apiVersion.desc')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <Separator />

        {/* ---------------- Token ---------------- */}
        <section className='space-y-4'>
          <div>
            <h3 className='text-base font-medium'>
              {t('settings.token.section')}
            </h3>
            <p className='text-sm text-muted-foreground'>
              {t('settings.token.section.desc')}
            </p>
          </div>

          <Alert>
            <AlertTitle className='text-xs'>
              {t('settings.token.notice.title')}
            </AlertTitle>
            <AlertDescription className='text-xs'>
              {t('settings.token.notice.before')}
              <code>client_credentials</code>
              {t('settings.token.notice.after')}
            </AlertDescription>
          </Alert>

          <FormField
            control={form.control}
            name='tokenSource'
            render={({ field }) => (
              <FormItem className='space-y-3'>
                <FormLabel>{t('settings.token.source')}</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className='gap-3'
                  >
                    {(['auto', 'env', 'manual'] as TokenSource[]).map(
                      (value) => {
                        const meta = TOKEN_SOURCE_META[value]
                        const disabled =
                          value === 'auto' && data
                            ? !data.hasClientCredentials
                            : false
                        return (
                          <div
                            key={value}
                            className='flex items-start gap-3 rounded-md border p-3'
                          >
                            <RadioGroupItem
                              value={value}
                              id={`token-${value}`}
                              className='mt-0.5'
                              disabled={disabled}
                            />
                            <div className='space-y-1'>
                              <label
                                htmlFor={`token-${value}`}
                                className='flex items-center gap-2 text-sm font-medium'
                              >
                                {meta.label}
                                {meta.autoRenew && (
                                  <Badge
                                    variant='outline'
                                    className='border-emerald-500/40 text-[10px] font-normal text-emerald-600'
                                  >
                                    {t('settings.token.neverExpires')}
                                  </Badge>
                                )}
                              </label>
                              <p className='text-xs text-muted-foreground'>
                                {meta.hint}
                              </p>
                              {disabled && (
                                <p className='text-xs text-amber-600'>
                                  {t('settings.token.missingCredentials')}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      }
                    )}
                  </RadioGroup>
                </FormControl>
              </FormItem>
            )}
          />

          {data && (
            <TokenStatusPanel
              settings={data}
              timezone={data.defaultTimezone}
              refreshing={refresh.isPending}
              onRefresh={() => refresh.mutate()}
            />
          )}

          {/*
            数据同步放在 token 之后：导入/对账都依赖凭据，凭据不对时
            用户应该先在上面解决，再往下看到「不能点」的按钮。
          */}
          {data && (
            <SyncPanel
              hasCredentials={data.hasAccessToken || data.hasClientCredentials}
              timezone={data.defaultTimezone}
            />
          )}

          {tokenSource === 'manual' && (
            <FormField
              control={form.control}
              name='accessToken'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('settings.token.newToken')}</FormLabel>
                  <FormControl>
                    <div className='flex gap-2'>
                      <Input
                        type={showToken ? 'text' : 'password'}
                        placeholder={t('settings.token.placeholder')}
                        autoComplete='off'
                        className='font-mono'
                        {...field}
                      />
                      <Button
                        type='button'
                        variant='outline'
                        size='icon'
                        onClick={() => setShowToken((prev) => !prev)}
                        title={
                          showToken
                            ? t('settings.token.hide')
                            : t('settings.token.reveal')
                        }
                      >
                        {showToken ? (
                          <EyeOff className='size-4' />
                        ) : (
                          <Eye className='size-4' />
                        )}
                      </Button>
                    </div>
                  </FormControl>
                  <FormDescription>{t('settings.token.desc')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => verify.mutate()}
              disabled={verify.isPending}
            >
              {verify.isPending ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <Plug className='size-4' />
              )}
              {t('settings.token.verify')}
            </Button>
            {check && (
              <span className='text-xs text-muted-foreground'>
                {verifySummary(check, t)}
              </span>
            )}
          </div>

          {check && !check.ok && (
            <Alert variant='destructive'>
              <AlertTitle>{t('settings.token.verify.errorTitle')}</AlertTitle>
              <AlertDescription>
                {check.error}
                {check.missingScopes && check.missingScopes.length > 0 && (
                  <span className='mt-1 block'>
                    {t('settings.token.verify.missingScopes', {
                      scopes: check.missingScopes.join(', '),
                    })}
                  </span>
                )}
                {check.blogMissingScopes &&
                  check.blogMissingScopes.length > 0 && (
                    <span className='mt-1 block text-xs'>
                      {t('settings.token.verify.blogScopesHint', {
                        scopes: check.blogMissingScopes.join(
                          t('settings.listSeparator')
                        ),
                      })}
                    </span>
                  )}
              </AlertDescription>
            </Alert>
          )}
        </section>

        <Separator />

        {/* ---------------- 栏目 → 博客映射自检 ---------------- */}
        <section className='space-y-4'>
          <div>
            <h3 className='text-base font-medium'>
              {t('settings.mapping.section')}
            </h3>
            <p className='text-sm text-muted-foreground'>
              {t('settings.mapping.section.desc')}
            </p>
          </div>
          <ChannelMappingCheck />
        </section>

        <Separator />

        {/* ---------------- 发布默认值 ---------------- */}
        <section className='space-y-4'>
          <div>
            <h3 className='text-base font-medium'>
              {t('settings.section.defaults')}
            </h3>
            <p className='text-sm text-muted-foreground'>
              {t('settings.section.defaults.desc')}
            </p>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='defaultAuthor'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('settings.defaultAuthor')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('settings.defaultAuthor.placeholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('settings.defaultAuthor.desc')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='defaultTimezone'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('settings.timezone')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {TIMEZONE_LABEL_KEY[option.value]
                            ? t(TIMEZONE_LABEL_KEY[option.value])
                            : lang === 'zh'
                              ? option.label
                              : option.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t('settings.timezone.desc')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='defaultPublishTime'
            render={({ field }) => (
              <FormItem className='max-w-[200px]'>
                <FormLabel>{t('settings.publishTime')}</FormLabel>
                <FormControl>
                  <Input type='time' {...field} />
                </FormControl>
                <FormDescription>
                  {t('settings.publishTime.desc')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='defaultReviewers'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('settings.defaultReviewers')}</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={t('settings.defaultReviewers.placeholder')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('settings.defaultReviewers.desc')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='templateChoices'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('settings.templateChoices')}</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={t('settings.templateChoices.placeholder')}
                    className='min-h-24 font-mono text-xs'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('settings.templateChoices.desc')}
                  <br />
                  {t('settings.templateChoices.desc2.before')}
                  <code>read_themes</code>
                  {t('settings.templateChoices.desc2.middle')}
                  <code>templates/page.*.liquid</code>
                  {t('settings.templateChoices.desc2.after')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='relatedProductTitles'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('settings.relatedProductTitles')}</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={t('settings.relatedProductTitles.placeholder')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('settings.relatedProductTitles.desc.before')}
                  <code>[[related_products_1]]</code>
                  {t('settings.relatedProductTitles.desc.after')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <div className='flex items-center gap-3'>
          <Button type='submit' disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Save className='size-4' />
            )}
            {t('settings.save')}
          </Button>
          <p className='text-xs text-muted-foreground'>
            {t('settings.save.hint')}
          </p>
        </div>
      </form>
    </Form>
  )
}
