import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Loader2, Plug, Save } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { settingsApi } from '@/lib/api'
import { TIMEZONE_OPTIONS } from '@/lib/datetime'
import {
  TOKEN_SOURCE_META,
  type ConnectionCheck,
  type TokenSource,
} from '@/types/content'
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
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { ChannelMappingCheck } from './channel-mapping-check'
import { SyncPanel } from './sync-panel'
import { site } from '@/config/site'
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

const schema = z.object({
  shopDomain: z
    .string()
    .min(1, '请填写店铺域名')
    .regex(/^[a-z0-9-]+\.myshopify\.com$/i, '格式应为 xxx.myshopify.com'),
  apiVersion: z.string().min(1, '请填写 API 版本'),
  tokenSource: z.enum(['auto', 'env', 'manual']),
  accessToken: z.string().optional(),
  defaultAuthor: z.string().min(1, '请填写默认作者'),
  defaultReviewers: z.string().optional(),
  relatedProductTitles: z.string().optional(),
  defaultTimezone: z.string().min(1),
  defaultPublishTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, '格式应为 HH:mm'),
  templateChoices: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

const toLines = (value?: string) =>
  (value ?? '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)

export function GlobalSettingsForm() {
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
      toast.success('设置已保存，所有栏目发布器立即生效')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      form.setValue('accessToken', '')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const verify = useMutation({
    mutationFn: () => settingsApi.verify(),
    onSuccess: (result) => {
      setCheck(result)
      if (result.ok) toast.success('Shopify 连接正常')
      else toast.error(result.error ?? '连接失败')
    },
    onError: (error: Error) => {
      setCheck({ ok: false, checkedAt: new Date().toISOString(), error: error.message })
      toast.error(error.message)
    },
  })

  // 用 useWatch 订阅单个字段，避免 form.watch() 让 React Compiler 跳过记忆化
  const refresh = useMutation({
    mutationFn: () => settingsApi.refreshToken(),
    onSuccess: (next) => {
      toast.success('已换新令牌')
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
            <h3 className='text-base font-medium'>Shopify 连接</h3>
            <p className='text-sm text-muted-foreground'>
              店铺域名与 Admin API 版本。这两项所有发布器共用。
            </p>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='shopDomain'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>店铺域名</FormLabel>
                  <FormControl>
                    <Input placeholder='your-store.myshopify.com' {...field} />
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
                  <FormLabel>Admin API 版本</FormLabel>
                  <FormControl>
                    <Input placeholder='2026-04' {...field} />
                  </FormControl>
                  <FormDescription>
                    原脚本使用 2026-04，升级前请先做一次连接自检。
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
            <h3 className='text-base font-medium'>访问 Token</h3>
            <p className='text-sm text-muted-foreground'>
              Token 只需在这一处维护，保存后全部 10 个栏目立即生效。
            </p>
          </div>

          <Alert>
            <AlertTitle className='text-xs'>
              注意：自动换发的 token 只有约 24 小时有效期
            </AlertTitle>
            <AlertDescription className='text-xs'>
              Shopify 的 <code>client_credentials</code> 换来的 shpat_ 令牌实测
              86398 秒（24 小时）后失效。所以平台把它当作**派生凭据**而不是配置：
              长期保存的是 CLIENT_ID / CLIENT_SECRET，access token 在内存里缓存并在
              到期前自动续期。请优先使用「自动续期」。
            </AlertDescription>
          </Alert>

          <FormField
            control={form.control}
            name='tokenSource'
            render={({ field }) => (
              <FormItem className='space-y-3'>
                <FormLabel>Token 来源</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className='gap-3'
                  >
                    {(['auto', 'env', 'manual'] as TokenSource[]).map((value) => {
                      const meta = TOKEN_SOURCE_META[value]
                      const disabled =
                        value === 'auto' && data ? !data.hasClientCredentials : false
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
                                  不会过期
                                </Badge>
                              )}
                            </label>
                            <p className='text-xs text-muted-foreground'>
                              {meta.hint}
                            </p>
                            {disabled && (
                              <p className='text-xs text-amber-600'>
                                未检测到 CLIENT_ID / CLIENT_SECRET，请在 .env 中配置后重启后端。
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
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
              hasCredentials={
                data.hasAccessToken || data.hasClientCredentials
              }
              timezone={data.defaultTimezone}
            />
          )}

          {tokenSource === 'manual' && (
            <FormField
              control={form.control}
              name='accessToken'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>新的 Token</FormLabel>
                  <FormControl>
                    <div className='flex gap-2'>
                      <Input
                        type={showToken ? 'text' : 'password'}
                        placeholder='shpat_...（留空表示不修改）'
                        autoComplete='off'
                        className='font-mono'
                        {...field}
                      />
                      <Button
                        type='button'
                        variant='outline'
                        size='icon'
                        onClick={() => setShowToken((prev) => !prev)}
                        title={showToken ? '隐藏' : '显示'}
                      >
                        {showToken ? (
                          <EyeOff className='size-4' />
                        ) : (
                          <Eye className='size-4' />
                        )}
                      </Button>
                    </div>
                  </FormControl>
                  <FormDescription>
                    保存到本地 0600 权限文件，界面只显示掩码。若 token 已在仓库中出现过，
                    建议在 Shopify 后台重新签发。
                  </FormDescription>
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
              连接自检
            </Button>
            {check && (
              <span className='text-xs text-muted-foreground'>
                {check.ok
                  ? `店铺 ${check.shopName ?? ''}${check.shopDomain ? ` (${check.shopDomain})` : ''} · 权限 ${
                      check.scopes?.join(', ') || '未知'
                    }${
                      check.blogMissingScopes?.length
                        ? `（发博客还缺：${check.blogMissingScopes.join('、')}）`
                        : ''
                    }`
                  : `失败：${check.error}`}
              </span>
            )}
          </div>

          {check && !check.ok && (
            <Alert variant='destructive'>
              <AlertTitle>连接自检失败</AlertTitle>
              <AlertDescription>
                {check.error}
                {check.missingScopes && check.missingScopes.length > 0 && (
                  <span className='mt-1 block'>
                    缺少权限：{check.missingScopes.join(', ')}
                  </span>
                )}
                {check.blogMissingScopes && check.blogMissingScopes.length > 0 && (
                  <span className='mt-1 block text-xs'>
                    发页面不受影响；但发博客文章还需要：
                    {check.blogMissingScopes.join('、')}
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
            <h3 className='text-base font-medium'>栏目 → 博客映射自检</h3>
            <p className='text-sm text-muted-foreground'>
              把配置里的 blogName / blogHandle 与店铺实际数据逐条对比。
              Shopify 侧的博客标题一旦被改，按标题匹配的发布器就会立刻失效，
              所以这里提前暴露不一致。
            </p>
          </div>
          <ChannelMappingCheck />
        </section>

        <Separator />

        {/* ---------------- 发布默认值 ---------------- */}
        <section className='space-y-4'>
          <div>
            <h3 className='text-base font-medium'>发布默认值</h3>
            <p className='text-sm text-muted-foreground'>
              新建排期与发布时的默认值，可在栏目页逐篇覆盖。
            </p>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='defaultAuthor'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>默认作者</FormLabel>
                  <FormControl>
                    <Input placeholder='Author Name' {...field} />
                  </FormControl>
                  <FormDescription>
                    作为 Shopify metaobject 引用写入文章。
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
                  <FormLabel>默认时区</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    定时发布的时间按此时区解释并转换为带偏移的 ISO 时间。
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
                <FormLabel>默认发布时间</FormLabel>
                <FormControl>
                  <Input type='time' {...field} />
                </FormControl>
                <FormDescription>新建排期时的默认时刻。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='defaultReviewers'
            render={({ field }) => (
              <FormItem>
                <FormLabel>默认审核人</FormLabel>
                <FormControl>
                  <Textarea placeholder='每行一个，或用逗号分隔' {...field} />
                </FormControl>
                <FormDescription>
                  reviewer metaobject 引用，缺失时发布器会跳过该字段。
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
                <FormLabel>页面模板清单</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder='每行一个 templateSuffix，例如 community_post'
                    className='min-h-24 font-mono text-xs'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  「Custom 文章」的模板选择器会列出这些模板。留空则用内置的 5 个栏目模板。
                  <br />
                  如果能读店铺主题（需要 <code>read_themes</code> 权限），会优先列出主题里
                  实际的 <code>templates/page.*.liquid</code>，这份清单作为兜底。
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
                <FormLabel>关联产品标题池</FormLabel>
                <FormControl>
                  <Textarea placeholder='每行一个产品标题' {...field} />
                </FormControl>
                <FormDescription>
                  用于替换正文中的 <code>[[related_products_1]]</code> 占位符，
                  发布器按标题解析为 product GID。
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
            保存并下发
          </Button>
          <p className='text-xs text-muted-foreground'>
            保存后所有栏目发布器读取同一份配置。
          </p>
        </div>
      </form>
    </Form>
  )
}
