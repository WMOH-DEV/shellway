import { Database } from 'lucide-react'
import type { SectionModule } from '../types'
import { DatabasesSection } from './DatabasesSection'

export const databasesSection: SectionModule = {
  id: 'databases',
  label: 'Databases',
  icon: Database,
  placement: 'main',
  Component: DatabasesSection
}
