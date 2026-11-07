import { WandSparkles } from 'lucide-react'
import type { SectionModule } from '../types'
import { SectionPlaceholder } from '../SectionPlaceholder'

export const setupSection: SectionModule = {
  id: 'setup',
  label: 'Set up this server',
  icon: WandSparkles,
  placement: 'hidden',
  Component: () => <SectionPlaceholder title="Set up this server" />
}
