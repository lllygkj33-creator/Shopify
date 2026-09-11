import { useState } from 'react'
import { AlertTriangle, Check, ChevronsUpDown, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

type TemplatePickerProps = {
  value: string
  options: string[]
  /** 清单来源：店铺主题 / 设置里手动维护 */
  source?: 'shopify' | 'manual'
  /** 回退到手动清单的原因 */
  sourceReason?: string | null
  disabled?: boolean
  onChange: (template: string) => void
}

/**
 * 可搜索的模板选择器（Custom 文章用）。
 *
 * 为什么要「搜索 + 选定」而不是纯手输：
 * Shopify 对**不存在的 templateSuffix 是静默回退**到主题默认模板，不报错 ——
 * 模板名打错不会失败，只会发成错误样式。给一个可选清单能显著降低这种风险。
 */
export function TemplatePicker({
  value,
  options,
  source,
  sourceReason,
  disabled,
  onChange,
}: TemplatePickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className='space-y-1'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='outline'
            size='sm'
            role='combobox'
            // Radix 的 Select 触发器也是 role=combobox，测试里靠它区分
            data-testid='template-picker'
            aria-expanded={open}
            disabled={disabled}
            className='h-8 w-[210px] justify-between font-mono text-xs font-normal'
          >
            <span className='truncate'>{value || '选择模板…'}</span>
            <ChevronsUpDown className='size-3 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-[280px] p-0'>
          <Command>
            <CommandInput placeholder='搜索模板名…' className='h-9' />
            <CommandList>
              <CommandEmpty>
                没有匹配的模板。可以直接改 JSON 里的 template 字段。
              </CommandEmpty>
              <CommandGroup heading={`可选模板（${options.length}）`}>
                {options.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => {
                      onChange(option === value ? '' : option)
                      setOpen(false)
                    }}
                    className='font-mono text-xs'
                  >
                    <Check
                      className={cn(
                        'size-3',
                        option === value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className='truncate'>{option}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* 模板名不在清单里 → 大概率写错了。
          Shopify 对不存在的 templateSuffix 是**静默回退**到主题默认模板、
          不报错，所以这是没有 read_themes 权限时最需要防的一种静默失败。 */}
      {value && options.length > 0 && !options.includes(value) && (
        <p
          className='flex items-start gap-1 text-[10px] text-amber-600'
          title={source === 'manual' ? (sourceReason ?? undefined) : undefined}
        >
          <AlertTriangle className='mt-0.5 size-3 shrink-0' />
          <span>
            不在清单里
            {source === 'manual' ? '（清单来自设置）' : ''}
            ：Shopify 会静默回退到主题默认模板，请确认模板名拼写
          </span>
        </p>
      )}

      {source && (
        <p className='flex items-center gap-1 text-[10px] text-muted-foreground'>
          {source === 'shopify' ? (
            <Badge
              variant='outline'
              className='border-emerald-500/40 px-1 py-0 text-[10px] font-normal text-emerald-600'
            >
              读自店铺主题
            </Badge>
          ) : (
            <Badge
              variant='outline'
              className='px-1 py-0 text-[10px] font-normal'
              title={sourceReason ?? undefined}
            >
              来自设置清单
            </Badge>
          )}
          {source === 'manual' && <Info className='size-3' />}
        </p>
      )}
    </div>
  )
}
