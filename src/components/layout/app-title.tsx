import { Link } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { Button } from '../ui/button'

/** 侧边栏顶部品牌区（替代模板的 workspace 切换器） */
export function AppTitle() {
  const { setOpenMobile } = useSidebar()
  const { brand } = sidebarData

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size='lg'
          className='gap-0 py-0 hover:bg-transparent active:bg-transparent'
          asChild
        >
          <div>
            <Link
              to='/'
              onClick={() => setOpenMobile(false)}
              className='flex flex-1 items-center gap-2 text-start text-sm leading-tight'
            >
              <div className='flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
                <brand.logo className='size-4' />
              </div>
              <div className='grid flex-1 text-start leading-tight'>
                <span className='truncate font-semibold'>{brand.name}</span>
                <span className='truncate text-xs text-muted-foreground'>
                  {brand.subtitle}
                </span>
              </div>
            </Link>
            <ToggleSidebar />
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function ToggleSidebar({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar='trigger'
      data-slot='sidebar-trigger'
      variant='ghost'
      size='icon'
      className={cn('aspect-square size-8 max-md:scale-125', className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <X className='md:hidden' />
      <Menu className='max-md:hidden' />
      <span className='sr-only'>Toggle Sidebar</span>
    </Button>
  )
}
