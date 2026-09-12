import { LANGS, type Lang } from '@/i18n'
import { Check, Languages } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/context/i18n-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * 语言名跟着界面语言走。
 *
 * 原本是「用各自的语言写」（中文界面写 `中文`、英文界面写 `English`），对看得懂
 * 当前语言的人更友好；但英文界面要整屏截图/演示，不能留任何汉字，所以英文侧
 * 改成 `Chinese` / `English`，中文侧保持原来的写法不变。
 */
const LABEL_KEYS: Record<Lang, string> = {
  zh: 'shell.lang.zh',
  en: 'shell.lang.en',
}

export function LangSwitch() {
  const { lang, setLang, t } = useI18n()

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='scale-95 rounded-full'>
          <Languages className='size-[1.2rem]' />
          <span className='sr-only'>{t('common.language')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {LANGS.map((value) => (
          <DropdownMenuItem key={value} onClick={() => setLang(value)}>
            {t(LABEL_KEYS[value])}
            <Check
              size={14}
              className={cn('ms-auto', lang !== value && 'hidden')}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
