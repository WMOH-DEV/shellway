import { Package } from 'lucide-react'
import type { SectionModule } from '../types'
import { SoftwareSection } from './SoftwareSection'

export const softwareSection: SectionModule = {
  id: 'software',
  label: 'Software',
  icon: Package,
  placement: 'main',
  Component: SoftwareSection
}
