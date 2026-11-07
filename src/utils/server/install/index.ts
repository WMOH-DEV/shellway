import type { OsInfo } from '@/types/server/identity'
import type { InstallRecipe, InstallRequest } from './types'

export type { ComponentId, InstallRecipe, InstallRequest, RecipeBuilder } from './types'

export function installRecipe(request: InstallRequest, os: OsInfo): InstallRecipe {
  return { supported: false, reason: `${request.component} install is not built yet for ${os.prettyName}` }
}
