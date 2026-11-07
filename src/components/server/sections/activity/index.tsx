import { History } from 'lucide-react'
import type { SectionModule } from '../types'
import { SectionPlaceholder } from '../SectionPlaceholder'

export const activitySection: SectionModule = {
  id: 'activity',
  label: 'Activity',
  icon: History,
  placement: 'main',
  Component: () => <SectionPlaceholder title="Activity" />
}
