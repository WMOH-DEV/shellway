import { Container } from 'lucide-react'
import type { SectionModule } from '../types'
import { SectionPlaceholder } from '../SectionPlaceholder'

export const dockerSection: SectionModule = {
  id: 'docker',
  label: 'Docker',
  icon: Container,
  placement: 'main',
  Component: () => <SectionPlaceholder title="Docker" />
}
