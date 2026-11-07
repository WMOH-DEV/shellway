import type { ServerSectionContext } from '../sections/types'
import type { ActionLauncher } from './types'

export function useActionLauncher(_ctx: ServerSectionContext): ActionLauncher {
  return { launch: () => {} }
}
