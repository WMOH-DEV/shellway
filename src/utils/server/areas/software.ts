import type { ActionDefinition, AreaModule } from '@/types/server/core'
import { aptInstallAction, installAction, removeAction } from '../software/actions/packages'
import { opcacheResetAction, phpCliDefaultAction, phpExtensionAction, phpFpmPoolAction, phpIniAction } from '../software/actions/php'
import { checkUpdatesAction, restartServicesAction, upgradeAction } from '../software/actions/updates'
import { softwareAttention } from '../software/attention'
import { SOFTWARE_PROBES } from '../software/probes'

const actions = [
  checkUpdatesAction,
  upgradeAction,
  restartServicesAction,
  installAction,
  removeAction,
  aptInstallAction,
  phpExtensionAction,
  phpCliDefaultAction,
  phpIniAction,
  phpFpmPoolAction,
  opcacheResetAction
] as ActionDefinition[]

export const softwareArea: AreaModule = {
  id: 'software',
  probes: SOFTWARE_PROBES,
  actions,
  attention: softwareAttention
}
