import { ShieldCheck } from 'lucide-react'
import type { SectionModule } from '../types'
import { SectionPlaceholder } from '../SectionPlaceholder'

export const securitySection: SectionModule = {
  id: 'security',
  label: 'Security',
  icon: ShieldCheck,
  placement: 'main',
  Component: () => <SectionPlaceholder title="Security" />
}
