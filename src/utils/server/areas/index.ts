import type { ActionDefinition, AreaModule, ProbeDefinition } from '@/types/server/core'
import { coreArea } from './core'
import { overviewArea } from './overview'
import { sitesArea } from './sites'
import { softwareArea } from './software'
import { servicesArea } from './services'
import { dockerArea } from './docker'
import { databasesArea } from './databases'
import { jobsArea } from './jobs'
import { securityArea } from './security'
import { activityArea } from './activity'
import { settingsArea } from './settings'
import { setupArea } from './setup'

export const AREAS: readonly AreaModule[] = [coreArea, overviewArea, sitesArea, softwareArea, servicesArea, dockerArea, databasesArea, jobsArea, securityArea, activityArea, settingsArea, setupArea]

export const ALL_PROBES: readonly ProbeDefinition[] = AREAS.flatMap((area) => area.probes)

export const ALL_ACTIONS: readonly ActionDefinition[] = AREAS.flatMap((area) => area.actions)

export const findProbe = (id: string): ProbeDefinition | undefined => ALL_PROBES.find((probe) => probe.id === id)

export const findAction = (type: string): ActionDefinition | undefined => ALL_ACTIONS.find((action) => action.type === type)
