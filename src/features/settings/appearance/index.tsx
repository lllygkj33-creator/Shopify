import { useI18n } from '@/context/i18n-provider'
import { ContentSection } from '../components/content-section'
import { AppearanceForm } from './appearance-form'

export function SettingsAppearance() {
  const { t } = useI18n()

  return (
    <ContentSection
      title={t('settings.appearance.title')}
      desc={t('settings.appearance.desc')}
    >
      <AppearanceForm />
    </ContentSection>
  )
}
