import { History } from 'lucide-react'
import type { SectionModule } from '../types'
import { ActivitySection } from './ActivitySection'

export const activitySection: SectionModule = {
  id: 'activity',
  label: 'Activity',
  icon: History,
  placement: 'main',
  Component: ActivitySection
}
