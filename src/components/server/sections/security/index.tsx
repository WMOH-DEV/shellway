import { ShieldCheck } from 'lucide-react'
import type { SectionModule } from '../types'
import { SecurityPage } from './SecurityPage'

export const securitySection: SectionModule = {
  id: 'security',
  label: 'Security',
  icon: ShieldCheck,
  placement: 'main',
  Component: SecurityPage
}
