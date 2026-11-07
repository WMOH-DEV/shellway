import type { OsFamily, OsInfo } from '@/types/server/identity'
import { debianRecipe } from './debian'
import { rhelRecipe } from './rhel'
import { releaseSupport } from './releases'
import { unsupported } from './steps'
import type { InstallRecipe, InstallRequest, RecipeBuilder } from './types'

export type { ComponentId, InstallRecipe, InstallRequest, RecipeBuilder } from './types'

export { releaseSupport as installSupport } from './releases'

const unsupportedOs: RecipeBuilder = (_request, os) => unsupported(releaseSupport(os) ?? `${os.prettyName} is not supported.`)

const BUILDERS: Record<OsFamily, RecipeBuilder> = {
  ubuntu: debianRecipe,
  debian: debianRecipe,
  rhel: rhelRecipe,
  other: unsupportedOs
}

export function installRecipe(request: InstallRequest, os: OsInfo): InstallRecipe {
  return (BUILDERS[os.family] ?? unsupportedOs)(request, os)
}
