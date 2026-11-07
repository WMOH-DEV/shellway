import type { ServerSection } from '@/types/server/core'
import type { SectionModule } from './types'
import { overviewSection } from './overview'
import { sitesSection } from './sites'
import { softwareSection } from './software'
import { servicesSection } from './services'
import { dockerSection } from './docker'
import { databasesSection } from './databases'
import { jobsSection } from './jobs'
import { securitySection } from './security'
import { activitySection } from './activity'
import { settingsSection } from './settings'
import { setupSection } from './setup'

export const SECTIONS: readonly SectionModule[] = [
  overviewSection,
  sitesSection,
  softwareSection,
  servicesSection,
  dockerSection,
  databasesSection,
  jobsSection,
  securitySection,
  activitySection,
  settingsSection,
  setupSection
]

export const sectionById = (id: ServerSection): SectionModule => SECTIONS.find((section) => section.id === id) ?? overviewSection
