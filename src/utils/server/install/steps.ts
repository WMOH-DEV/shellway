import type { ActionStep } from '@/types/server/core'
import { APT_ENV, APT_GET, APT_INSTALL, assertPackageName } from '../apt'
import type { InstallRecipe } from './types'

export interface StepTiming {
  detached: boolean
  timeoutSeconds: number
}

export const LONG: StepTiming = { detached: true, timeoutSeconds: 900 }

export const SHORT: StepTiming = { detached: false, timeoutSeconds: 300 }

const isCommandLine = (line: string): boolean => line.trim() !== '' && line !== 'set -e'

export function rootStep(id: string, label: string, lines: string[], timing: StepTiming = LONG): ActionStep {
  const commands = lines.filter(isCommandLine)
  return {
    id,
    label,
    kind: 'command',
    root: true,
    script: ['set -e', ...commands, ''].join('\n'),
    display: commands.join('\n'),
    timeoutSeconds: timing.timeoutSeconds,
    detached: timing.detached
  }
}

export const aptUpdate = (): string[] => [APT_ENV, `${APT_GET} update`]

export const aptInstall = (packages: string[]): string[] => [...aptUpdate(), `${APT_INSTALL} ${packages.map(assertPackageName).join(' ')}`]

export const withSystemd = (command: string): string => `if [ -d /run/systemd/system ]; then ${command}; fi`

export const enableService = (unit: string): string => withSystemd(`systemctl enable --now ${unit}`)

export const unsupported = (reason: string): InstallRecipe => ({ supported: false, reason })
