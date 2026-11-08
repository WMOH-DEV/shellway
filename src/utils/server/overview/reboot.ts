import type { ActionDefinition, ActionPlan, AttentionItem, ProbeDefinition, ServerFacts } from '@/types/server/core'
import { REBOOT_ACTION, REBOOT_PROBE, REBOOT_ROUTE } from './ids'
import { validateNoParams } from './params'

export interface RebootState {
  required: boolean
  packages: string[]
}

const REBOOT_SCRIPT = [
  'if [ -f /var/run/reboot-required ]; then echo required=1; else echo required=0; fi',
  "[ -r /var/run/reboot-required.pkgs ] && sed 's/^/pkg=/' /var/run/reboot-required.pkgs",
  'exit 0',
  ''
].join('\n')

export function parseReboot(stdout: string): RebootState {
  const lines = stdout.split('\n').map((line) => line.trim())
  const packages = [...new Set(lines.filter((line) => line.startsWith('pkg=')).map((line) => line.slice(4)).filter(Boolean))]
  return { required: lines.includes('required=1'), packages }
}

export const rebootProbe: ProbeDefinition<RebootState> = {
  id: REBOOT_PROBE,
  area: 'overview',
  root: false,
  timeoutSeconds: 10,
  script: REBOOT_SCRIPT,
  parse: parseReboot
}

const SHOWN_PACKAGES = 3

export function packageSummary(packages: string[]): string {
  if (packages.length === 0) return 'An update asked for a restart.'
  const shown = packages.slice(0, SHOWN_PACKAGES).join(', ')
  const more = packages.length > SHOWN_PACKAGES ? ` and ${packages.length - SHOWN_PACKAGES} more` : ''
  return `Updates to ${shown}${more} take effect after a restart.`
}

export function rebootAttention(facts: ServerFacts): AttentionItem[] {
  const result = facts[REBOOT_PROBE]
  if (result?.status !== 'ok' || !(result.data as RebootState).required) return []
  return [{
    id: 'overview.reboot',
    area: 'overview',
    level: 'warning',
    rank: 65,
    title: 'Reboot required',
    detail: packageSummary((result.data as RebootState).packages),
    actionLabel: 'Reboot',
    route: REBOOT_ROUTE
  }]
}

export const REBOOT_COMMAND = "setsid nohup sh -c 'sleep 2; systemctl reboot || shutdown -r now' >/dev/null 2>&1 </dev/null &"

export function rebootPlan(): ActionPlan {
  return {
    title: 'Reboot server',
    area: 'overview',
    summary: 'Restarts the server. Sites, services and workers stop until it is back up, usually in 1 to 3 minutes.',
    steps: [{
      id: 'reboot',
      label: 'Reboot the server',
      kind: 'command',
      root: true,
      script: `${REBOOT_COMMAND}\necho "Reboot starts in 2 seconds"\n`,
      display: REBOOT_COMMAND,
      timeoutSeconds: 30
    }],
    warnings: [
      'Everything on this server goes offline until it starts again.',
      'Shellway loses the connection and reconnects by itself. Open terminals and file transfers are cut.'
    ],
    blocked: null,
    secrets: []
  }
}

export const rebootAction: ActionDefinition<Record<string, never>> = {
  type: REBOOT_ACTION,
  area: 'overview',
  needs: [],
  validate: validateNoParams,
  plan: rebootPlan
}
