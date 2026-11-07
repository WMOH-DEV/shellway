import type { ActionDefinition, ActionPlan } from '@/types/server/core'

export type FixId = 'redis-log-owner'

export interface FixParams {
  fix: FixId
  unit: string
}

const REDIS_UNITS = new Set(['redis-server', 'redis'])
const REDIS_LOG = '/var/log/redis/redis-server.log'

export function validateFix(raw: unknown): FixParams {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid fix')
  const { fix, unit } = raw as Record<string, unknown>
  if (fix !== 'redis-log-owner') throw new Error('Unknown fix')
  if (typeof unit !== 'string' || !REDIS_UNITS.has(unit)) throw new Error('Invalid service name')
  return { fix, unit }
}

const OWN_LOG = [
  `grep -Eq '^logfile "?${REDIS_LOG}"?$' /etc/redis/redis.conf || { echo "Redis writes its log somewhere else. Check logfile in /etc/redis/redis.conf."; exit 1; }`,
  'install -d -o redis -g redis -m 0750 /var/log/redis',
  `touch ${REDIS_LOG}`,
  `chown redis:redis ${REDIS_LOG}`
].join('\n')

export function planFix({ unit }: FixParams): ActionPlan {
  const start = `systemctl reset-failed ${unit}.service\nsystemctl start ${unit}.service`
  return {
    title: `Fix the Redis log file and start ${unit}`,
    area: 'services',
    summary: 'Gives the redis user its log file back, then starts Redis.',
    steps: [
      { id: 'own-log', label: 'Give the redis user its log file', kind: 'command', root: true, script: `set -e\n${OWN_LOG}`, display: OWN_LOG.split('\n').slice(1).join('\n'), timeoutSeconds: 30 },
      { id: 'start', label: `Start ${unit}`, kind: 'command', root: true, script: `set -e\n${start}`, display: start, timeoutSeconds: 120 }
    ],
    warnings: [],
    blocked: null,
    secrets: []
  }
}

export const fixAction: ActionDefinition<FixParams> = {
  type: 'services.fix',
  area: 'services',
  needs: [],
  validate: validateFix,
  plan: planFix
}
