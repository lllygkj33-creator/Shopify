import { createFileRoute } from '@tanstack/react-router'
import { SettingsGlobal } from '@/features/settings/global'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: SettingsGlobal,
})
