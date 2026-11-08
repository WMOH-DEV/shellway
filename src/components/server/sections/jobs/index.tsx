import { Clock } from 'lucide-react'
import type { SectionModule } from '../types'
import { JobsSection } from './JobsSection'

export const jobsSection: SectionModule = {
  id: 'jobs',
  label: 'Cron & workers',
  icon: Clock,
  placement: 'main',
  Component: JobsSection
}
