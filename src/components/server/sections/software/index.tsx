import { Package } from 'lucide-react'
import type { SectionModule } from '../types'
import { SectionPlaceholder } from '../SectionPlaceholder'

export const softwareSection: SectionModule = {
  id: 'software',
  label: 'Software',
  icon: Package,
  placement: 'main',
  Component: () => <SectionPlaceholder title="Software" />
}
