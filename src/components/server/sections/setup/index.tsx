import { WandSparkles } from 'lucide-react'
import type { SectionModule } from '../types'
import { SetupView } from './SetupView'

export const setupSection: SectionModule = {
  id: 'setup',
  label: 'Set up this server',
  icon: WandSparkles,
  placement: 'hidden',
  Component: SetupView
}
