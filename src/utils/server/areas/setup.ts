import type { ActionDefinition, AreaModule } from '@/types/server/core'
import { IDENTITY_PROBE } from '@/types/server/identity'
import { FILES_PROBE, INVENTORY_PROBE, filesProbe, inventoryProbe } from '../setup/inventory'
import { buildSetupPlan } from '../setup/plan'
import type { SetupParams } from '../setup/types'
import { validateSetupParams } from '../setup/validate'

export const SETUP_RUN = 'setup.run'

const runSetup: ActionDefinition<SetupParams> = {
  type: SETUP_RUN,
  area: 'setup',
  needs: [IDENTITY_PROBE, INVENTORY_PROBE, FILES_PROBE],
  validate: validateSetupParams,
  plan: buildSetupPlan
}

export const setupArea: AreaModule = {
  id: 'setup',
  probes: [inventoryProbe, filesProbe],
  actions: [runSetup as ActionDefinition],
  attention: () => []
}
