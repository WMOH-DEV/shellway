import { Settings } from 'lucide-react'
import type { SectionModule } from '../types'
import { SettingsSection } from './SettingsSection'

export const settingsSection: SectionModule = {
  id: 'settings',
  label: 'Server settings',
  icon: Settings,
  placement: 'bottom',
  Component: SettingsSection
}
