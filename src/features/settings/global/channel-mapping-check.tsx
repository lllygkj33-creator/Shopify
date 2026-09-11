import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { CHANNELS } from '@/config/channels'
import { blogsApi } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * 栏目 → Shopify Blog 映射自检
 *
 * 存在的理由（来自一次真实排查）：GEO 的 find_blog_gid() 用 `casefold()`
 * 做**精确标题匹配**，匹配不上就抛 RuntimeError。而 GEO/config.json 里写的
 * 名称有两个与店铺实际不符：
 *
 *     'NAS Server Setup'  ≠  店铺实际 'NAS & Server Setup'
 *     'Buying Guides'     ≠  店铺实际 'Buying Guide'
 *
 * 也就是说这两个栏目实际上**根本发不出去**，但错误信息只在发布时才出现。
 *
 * 这个卡片把「配置值 vs 店铺实际值」直接摆出来，让这类不一致在设置页就暴露，
 * 而不是等发布失败才发现。
 *
 * 匹配优先级与建议给后端的一致：**先按 handle，再按标题（忽略大小写）**。
 * handle 在 Shopify 里稳定且 URL 安全，标题随时可能被运营改掉。
 */

type MatchKind = 'handle' | 'title' | 'none'

export function ChannelMappingCheck() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['blogs'],
    queryFn: () => blogsApi.list(),
  })

  const blogs = data ?? []

  const rows = CHANNELS.filter((c) => c.contentType === 'blog_article').map(
    (channel) => {
      const byHandle = blogs.find((blog) => blog.handle === channel.blogHandle)
      const byTitle = blogs.find(
        (blog) =>
          blog.name.trim().toLowerCase() ===
          (channel.blogName ?? '').trim().toLowerCase()
      )
      const matched = byHandle ?? byTitle ?? null
      const kind: MatchKind = byHandle ? 'handle' : byTitle ? 'title' : 'none'
      const mismatchByHandle =
        byHandle != null && byHandle.handle !== channel.blogHandle

      return {
        channel,
        matched,
        kind,
        mismatchByHandle,
      }
    }
  )

  const broken = rows.filter((row) => row.kind === 'none')
  const titleOnly = rows.filter((row) => row.kind === 'title')
  const usedHandles = new Set(rows.map((row) => row.matched?.handle))
  const unusedBlogs = blogs.filter((blog) => !usedHandles.has(blog.handle))

  if (isLoading) {
    return (
      <div className='space-y-2'>
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className='h-9 w-full' />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>无法获取店铺博客列表</AlertTitle>
        <AlertDescription className='space-y-2'>
          <p>{(error as Error).message}</p>
          <p className='text-xs'>
            需要先配置可用的 Token（可在上方的「连接自检」里排查）。
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <p className='text-xs text-muted-foreground'>
          共 {rows.length} 个博客栏目，店铺里有 {blogs.length} 个博客
        </p>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={isFetching ? 'size-3 animate-spin' : 'size-3'} />
          重新核对
        </Button>
      </div>

      {broken.length > 0 && (
        <Alert variant='destructive'>
          <AlertTriangle className='size-4' />
          <AlertTitle>
            有 {broken.length} 个栏目在店铺里找不到对应博客
          </AlertTitle>
          <AlertDescription>
            <span>
              {broken.map((row) => row.channel.name).join('、')}
              {' '}的名称与店铺实际不符。发布这些栏目会直接失败（运行时找不到 Blog）。
            </span>
            <span className='mt-1 block text-xs'>
              修法：把 <code>src/config/channels.ts</code> 里的 <code>blogName</code>{' '}
              改成右侧「店铺实际」的值，或在 Shopify 后台把博客改成配置里的名字。
            </span>
          </AlertDescription>
        </Alert>
      )}

      {broken.length === 0 && (
        <Alert>
          <CheckCircle2 className='size-4 text-emerald-600' />
          <AlertTitle>全部栏目都能匹配到店铺博客</AlertTitle>
          {titleOnly.length > 0 && (
            <AlertDescription>
              其中 {titleOnly.length} 个是**靠标题**匹配成功的（handle 不一致）：
              {titleOnly.map((row) => row.channel.name).join('、')}。
              标题随时可能被改动，建议把 <code>blogHandle</code> 也修正为店铺实际值。
            </AlertDescription>
          )}
        </Alert>
      )}

      <div className='rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='min-w-[150px]'>栏目</TableHead>
              <TableHead className='min-w-[190px]'>配置的 blogName</TableHead>
              <TableHead className='min-w-[150px]'>配置的 blogHandle</TableHead>
              <TableHead className='min-w-[190px]'>店铺实际</TableHead>
              <TableHead className='w-[90px]'>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.channel.id}>
                <TableCell className='text-sm'>
                  {row.channel.nameZh ?? row.channel.name}
                </TableCell>
                <TableCell className='font-mono text-xs'>
                  {row.channel.blogName}
                </TableCell>
                <TableCell className='font-mono text-xs'>
                  {row.channel.blogHandle}
                </TableCell>
                <TableCell className='font-mono text-xs'>
                  {row.matched ? (
                    <span>
                      {row.matched.name}
                      <span className='block text-muted-foreground'>
                        {row.matched.handle}
                      </span>
                    </span>
                  ) : (
                    <span className='text-destructive'>—</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.kind === 'handle' ? (
                    <Badge
                      variant='outline'
                      className='border-emerald-500/40 text-xs font-normal text-emerald-600'
                    >
                      ✓ handle
                    </Badge>
                  ) : row.kind === 'title' ? (
                    <Badge
                      variant='outline'
                      className='border-amber-500/50 text-xs font-normal text-amber-600'
                    >
                      仅标题
                    </Badge>
                  ) : (
                    <Badge
                      variant='outline'
                      className='border-destructive/50 text-xs font-normal text-destructive'
                    >
                      找不到
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {unusedBlogs.length > 0 && (
        <p className='text-xs text-muted-foreground'>
          店铺里未被任何栏目使用的博客：
          {unusedBlogs.map((blog) => `${blog.name}（${blog.handle}）`).join('、')}
        </p>
      )}
    </div>
  )
}
