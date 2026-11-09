import type { ActionDefinition, ActionPlan, ActionStep, PlanBlock, ServerFacts } from '@/types/server/core'
import type { ControlVerb } from './list'
import { probeData } from './list'
import { LOAD_NODE } from './pm2'
import { PROBE } from './probes'
import { shellQuote } from './sections'
import type { ContainersData, Pm2Data, ServiceKind } from './types'

export interface ControlParams {
  kind: ServiceKind
  name: string
  verb: ControlVerb
  user: string | null
}

const VERBS: Record<ServiceKind, readonly ControlVerb[]> = {
  systemd: ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'reset-failed'],
  supervisor: ['start', 'stop', 'restart'],
  pm2: ['start', 'stop', 'restart'],
  container: ['start', 'stop', 'restart']
}

const NAMES: Record<ServiceKind, RegExp> = {
  systemd: /^[A-Za-z0-9][A-Za-z0-9@._:-]{0,127}$/,
  supervisor: /^[A-Za-z0-9_.-]{1,64}(:[A-Za-z0-9_.-]{1,64})?$/,
  pm2: /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/,
  container: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
}

const USER = /^[a-z_][a-z0-9_-]{0,31}$/

const VERB_LABEL: Record<ControlVerb, string> = { start: 'Start', stop: 'Stop', restart: 'Restart', reload: 'Reload', enable: 'Start on boot:', disable: 'Do not start on boot:', 'reset-failed': 'Clear the failed state of' }

const SSH_UNITS = new Set(['ssh', 'sshd'])

export const isServiceKind = (value: unknown): value is ServiceKind => typeof value === 'string' && Object.hasOwn(VERBS, value)

export const isValidServiceName = (kind: ServiceKind, name: unknown): name is string => typeof name === 'string' && NAMES[kind].test(name)

export const isValidUser = (user: unknown): user is string => typeof user === 'string' && USER.test(user)

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid service action')
  return raw as Record<string, unknown>
}

export function validateControl(raw: unknown): ControlParams {
  const { kind, name, verb, user } = record(raw)
  if (!isServiceKind(kind)) throw new Error('Invalid service kind')
  if (typeof verb !== 'string' || !VERBS[kind].includes(verb as ControlVerb)) throw new Error('Invalid service action')
  if (!isValidServiceName(kind, name)) throw new Error('Invalid service name')
  if (kind !== 'pm2') return { kind, name, verb: verb as ControlVerb, user: null }
  if (!isValidUser(user)) throw new Error('Invalid user')
  return { kind, name, verb: verb as ControlVerb, user }
}

const CONFIG_TEST: Record<string, string> = { nginx: 'nginx -t', apache2: 'apache2ctl configtest' }

function systemdScript({ name, verb }: ControlParams): string {
  const command = `systemctl ${verb} ${shellQuote(`${name}.service`)}`
  const test = verb === 'reload' || verb === 'restart' ? CONFIG_TEST[name] : undefined
  return test ? `${test}\n${command}` : command
}

function pm2Owner(facts: ServerFacts): string | null {
  const data = probeData<Pm2Data>(facts, PROBE.pm2)
  return data?.installed ? (data.users[0]?.user ?? null) : null
}

function pm2Step(params: ControlParams, facts: ServerFacts): Pick<ActionStep, 'root' | 'script' | 'display'> {
  const user = params.user ?? ''
  const command = `pm2 ${params.verb} ${shellQuote(params.name)}`
  if (pm2Owner(facts) === user) return { root: false, script: `${LOAD_NODE}\n${command}`, display: command }
  return { root: true, script: `sudo -n -u ${user} -H sh -c ${shellQuote(`${LOAD_NODE}\n${command}`)}`, display: `sudo -n -u ${user} ${command}` }
}

function containerStep({ name, verb }: ControlParams, facts: ServerFacts): Pick<ActionStep, 'root' | 'script' | 'display'> {
  const data = probeData<ContainersData>(facts, PROBE.containers)
  const command = `docker ${verb} ${shellQuote(name)}`
  return { root: !(data?.installed && data.access === 'direct'), script: command, display: command }
}

function commandFor(params: ControlParams, facts: ServerFacts): Pick<ActionStep, 'root' | 'script' | 'display'> {
  if (params.kind === 'systemd') {
    const script = systemdScript(params)
    return { root: true, script: `set -e\n${script}`, display: script }
  }
  if (params.kind === 'supervisor') {
    const command = `supervisorctl ${params.verb} ${shellQuote(params.name)}`
    return { root: true, script: command, display: command }
  }
  return params.kind === 'pm2' ? pm2Step(params, facts) : containerStep(params, facts)
}

function blockFor(params: ControlParams, facts: ServerFacts): PlanBlock | null {
  if (params.kind === 'systemd' && SSH_UNITS.has(params.name) && (params.verb === 'stop' || params.verb === 'disable')) {
    return { kind: 'precondition', message: 'Stopping SSH would cut off this connection and lock you out.' }
  }
  const containers = probeData<ContainersData>(facts, PROBE.containers)
  if (params.kind === 'container' && containers?.installed && containers.access === null) {
    return { kind: 'sudo', message: 'Docker needs root or the docker group, and neither is available for this login.' }
  }
  return null
}

function warningsFor(params: ControlParams): string[] {
  if (params.verb === 'stop') return [`Anything that depends on ${params.name} stops working until you start it again.`]
  if (params.verb === 'disable') return [`${params.name} will not start by itself after a reboot.`]
  return []
}

const KIND_LABEL: Record<ServiceKind, string> = { systemd: 'system service', supervisor: 'Supervisor program', pm2: 'pm2 app', container: 'container' }

export function planControl(params: ControlParams, facts: ServerFacts): ActionPlan {
  const title = `${VERB_LABEL[params.verb]} ${params.name}`
  const command = commandFor(params, facts)
  return {
    title,
    area: 'services',
    summary: `${title} (${KIND_LABEL[params.kind]}${params.user ? ` of ${params.user}` : ''}).`,
    steps: [{ id: 'control', label: title, kind: 'command', timeoutSeconds: 120, ...command }],
    warnings: warningsFor(params),
    blocked: blockFor(params, facts),
    secrets: []
  }
}

export const controlAction: ActionDefinition<ControlParams> = {
  type: 'services.control',
  area: 'services',
  needs: [PROBE.pm2, PROBE.containers],
  validate: validateControl,
  plan: planControl
}
