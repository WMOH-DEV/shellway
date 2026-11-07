import { Clock } from 'lucide-react'
import type { SectionModule } from '../types'
import { SectionPlaceholder } from '../SectionPlaceholder'

export const jobsSection: SectionModule = {
  id: 'jobs',
  label: 'Cron & workers',
  icon: Clock,
  placement: 'main',
  Component: () => <SectionPlaceholder title="Cron & workers" />
}
