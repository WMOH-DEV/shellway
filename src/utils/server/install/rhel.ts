import type { OsInfo } from '@/types/server/identity'
import { releaseSupport } from './releases'
import { unsupported } from './steps'
import type { InstallRecipe, InstallRequest } from './types'

export const rhelRecipe = (_request: InstallRequest, os: OsInfo): InstallRecipe =>
  unsupported(releaseSupport(os) ?? `${os.prettyName} is not supported yet.`)
