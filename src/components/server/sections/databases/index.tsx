import { Database } from 'lucide-react'
import type { SectionModule } from '../types'
import { SectionPlaceholder } from '../SectionPlaceholder'

export const databasesSection: SectionModule = {
  id: 'databases',
  label: 'Databases',
  icon: Database,
  placement: 'main',
  Component: () => <SectionPlaceholder title="Databases" />
}
