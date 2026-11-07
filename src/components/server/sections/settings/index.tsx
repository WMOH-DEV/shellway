import { Settings } from 'lucide-react'
import type { SectionModule } from '../types'
import { SectionPlaceholder } from '../SectionPlaceholder'

export const settingsSection: SectionModule = {
  id: 'settings',
  label: 'Server settings',
  icon: Settings,
  placement: 'bottom',
  Component: () => <SectionPlaceholder title="Server settings" />
}
