import type { ParsedCandidate, PublishMode } from '@/types/content'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import {
  formatTimezoneOffset,
  isPastWallTime,
  wallTimeToIso,
} from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TemplatePicker } from './template-picker'

export type PublishPlan = {
  mode: PublishMode
  /** 墙上时间（YYYY-MM-DDTHH:mm），仅在 mode='schedule' 时有意义 */
  wallTime: string
}

type CandidateListProps = {
  candidates: ParsedCandidate[]
  /** 模板自由的栏目（Custom 文章）才会传：可选模板清单 */
  templateOptions?: string[]
  templateSource?: 'shopify' | 'manual'
  templateSourceReason?: string | null
  onTemplateChange?: (tempId: string, template: string) => void
  plans: Record<string, PublishPlan>
  selected: Set<string>
  timezone: string
  busy: boolean
  onToggle: (tempId: string) => void
  onToggleAll: (checked: boolean) => void
  onPlanChange: (tempId: string, patch: Partial<PublishPlan>) => void
}

export function CandidateList({
  candidates,
  templateOptions,
  templateSource,
  templateSourceReason,
  onTemplateChange,
  plans,
  selected,
  timezone,
  busy,
  onToggle,
  onToggleAll,
  onPlanChange,
}: CandidateListProps) {
  const allSelected =
    candidates.length > 0 && candidates.every((c) => selected.has(c.tempId))

  return (
    <div className='rounded-lg border'>
      <Table>
        <TableHeader className='sticky top-0 z-10 bg-background'>
          <TableRow>
            <TableHead className='w-10'>
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
                aria-label='全选'
              />
            </TableHead>
            <TableHead className='min-w-[280px]'>文章</TableHead>
            <TableHead className='w-[220px]'>发布目标</TableHead>
            <TableHead className='w-[130px]'>校验</TableHead>
            <TableHead className='w-[330px]'>发布方式</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => {
            const plan = plans[candidate.tempId] ?? {
              mode: 'schedule' as PublishMode,
              wallTime: '',
            }
            const errors = candidate.issues.filter((i) => i.level === 'error')
            const warnings = candidate.issues.filter(
              (i) => i.level === 'warning'
            )
            const blocked = errors.length > 0

            return (
              <TableRow
                key={candidate.tempId}
                className={cn(blocked && 'bg-destructive/5')}
              >
                <TableCell className='align-top'>
                  <Checkbox
                    checked={selected.has(candidate.tempId)}
                    disabled={blocked || busy}
                    onCheckedChange={() => onToggle(candidate.tempId)}
                    aria-label={`选择 ${candidate.title}`}
                  />
                </TableCell>

                <TableCell className='align-top'>
                  <div className='space-y-1'>
                    <p className='text-sm leading-snug font-medium'>
                      {candidate.title || '(无标题)'}
                    </p>
                    <p className='truncate font-mono text-xs text-muted-foreground'>
                      {candidate.handle || '(无 handle)'}
                    </p>
                    <p className='truncate text-xs text-muted-foreground/70'>
                      {candidate.sourceFile}
                      {candidate.sourceIndex > 0 &&
                        ` #${candidate.sourceIndex + 1}`}
                    </p>
                  </div>
                </TableCell>

                <TableCell className='align-top'>
                  {candidate.contentType === 'blog_article' ? (
                    <div className='space-y-1 text-xs'>
                      <Badge variant='secondary' className='font-normal'>
                        博客文章
                      </Badge>
                      <p className='text-muted-foreground'>
                        {candidate.blogName ?? '未识别博客'}
                      </p>
                    </div>
                  ) : (
                    <div className='space-y-1 text-xs'>
                      <Badge variant='secondary' className='font-normal'>
                        页面
                      </Badge>
                      {templateOptions ? (
                        // 模板自由的栏目（Custom 文章）：可搜索选定
                        <TemplatePicker
                          value={candidate.template ?? ''}
                          options={templateOptions}
                          source={templateSource}
                          sourceReason={templateSourceReason}
                          disabled={busy}
                          onChange={(template) =>
                            onTemplateChange?.(candidate.tempId, template)
                          }
                        />
                      ) : (
                        <p className='font-mono text-muted-foreground'>
                          {candidate.template ?? '默认模板'}
                        </p>
                      )}
                    </div>
                  )}
                </TableCell>

                <TableCell className='align-top'>
                  {blocked ? (
                    <IssueBadge
                      level='error'
                      message={errors.map((e) => e.message).join('\n')}
                      count={errors.length}
                    />
                  ) : warnings.length > 0 ? (
                    <IssueBadge
                      level='warning'
                      message={warnings.map((w) => w.message).join('\n')}
                      count={warnings.length}
                    />
                  ) : (
                    <Badge
                      variant='outline'
                      className='border-emerald-500/40 text-xs font-normal text-emerald-600'
                    >
                      校验通过
                    </Badge>
                  )}
                </TableCell>

                <TableCell className='align-top'>
                  <div className='flex flex-col gap-2'>
                    <Select
                      value={plan.mode}
                      onValueChange={(value) =>
                        onPlanChange(candidate.tempId, {
                          mode: value as PublishMode,
                        })
                      }
                      disabled={busy}
                    >
                      <SelectTrigger className='h-8 w-[130px]'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='now'>立即发布</SelectItem>
                        <SelectItem value='schedule'>定时发布</SelectItem>
                        <SelectItem value='draft'>存为草稿</SelectItem>
                      </SelectContent>
                    </Select>

                    {plan.mode === 'schedule' && (
                      <div className='space-y-1'>
                        <Label className='text-[10px] text-muted-foreground'>
                          发布时间（{formatTimezoneOffset(timezone)}）
                        </Label>
                        <Input
                          type='datetime-local'
                          value={plan.wallTime}
                          disabled={busy}
                          onChange={(event) =>
                            onPlanChange(candidate.tempId, {
                              wallTime: event.target.value,
                            })
                          }
                          className='h-8 w-[200px]'
                        />
                        {plan.wallTime && (
                          <>
                            <p className='font-mono text-[10px] text-muted-foreground'>
                              提交值 {wallTimeToIso(plan.wallTime, timezone)}
                            </p>
                            {isPastWallTime(plan.wallTime, timezone) && (
                              // 后端与脚本都禁止已过去的时间（ALLOW_PAST_SCHEDULE=False），
                              // 这里提前标出来，避免点了发布才失败
                              <p className='text-[10px] font-medium text-destructive'>
                                时间已过去，无法发布
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function IssueBadge({
  level,
  message,
  count,
}: {
  level: 'error' | 'warning'
  message: string
  count: number
}) {
  const isError = level === 'error'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant='outline'
          className={cn(
            'cursor-help text-xs font-normal',
            isError
              ? 'border-destructive/50 text-destructive'
              : 'border-amber-500/50 text-amber-600'
          )}
        >
          {isError ? (
            <AlertCircle className='size-3' />
          ) : (
            <AlertTriangle className='size-3' />
          )}
          {count} 项{isError ? '错误' : '提示'}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className='max-w-sm whitespace-pre-line'>
        {message}
      </TooltipContent>
    </Tooltip>
  )
}
