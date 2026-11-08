import type { ServerIpcContext } from '../../../services/server/context'
import { registerOverviewIPC } from './overview'
import { registerSitesIPC } from './sites'
import { registerSoftwareIPC } from './software'
import { registerServicesIPC } from './services'
import { registerDockerIPC } from './docker'
import { registerDatabasesIPC } from './databases'
import { registerJobsIPC } from './jobs'
import { registerSecurityIPC } from './security'
import { registerActivityIPC } from './activity'
import { registerSettingsIPC } from './settings'
import { registerSetupIPC } from './setup'

export function registerServerAreaIPC(ctx: ServerIpcContext): void {
  registerOverviewIPC(ctx)
  registerSitesIPC(ctx)
  registerSoftwareIPC(ctx)
  registerServicesIPC(ctx)
  registerDockerIPC(ctx)
  registerDatabasesIPC(ctx)
  registerJobsIPC(ctx)
  registerSecurityIPC(ctx)
  registerActivityIPC(ctx)
  registerSettingsIPC(ctx)
  registerSetupIPC(ctx)
}
