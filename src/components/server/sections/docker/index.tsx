import { Container } from 'lucide-react'
import type { SectionModule } from '../types'
import { DockerSection } from './DockerSection'

export const dockerSection: SectionModule = {
  id: 'docker',
  label: 'Docker',
  icon: Container,
  placement: 'main',
  Component: DockerSection
}
