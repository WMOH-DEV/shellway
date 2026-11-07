import type { ActionDefinition, ActionPlan, ActionStep, ServerFacts } from '@/types/server/core'
import { cronLogPath, CRON_LOG_DIR, crontabLines, replaceEntry, shellwayCronLine } from './crontab'
import { findCrontab } from './crontabs'
import { describeCron } from './cron'
import { blockedPlan, commandStep, EXIT_CHANGED, factData, jobsPlan } from './plan'
import { quote } from './shell'
import { CRONTABS_PROBE, USERS_PROBE, type CrontabFacts, type UserCrontab, type UsersFacts } from './types'
import { hasUser } from './users'
import { checked, command, cronCommandProblem, expression, flag, record, TASK_ID, TASK_REF, text, USER_NAME } from './validate'

export interface CronSaveParams {
  user: string
  ref: string | null
  id: string
  expression: string
  command: string
  logOutput: boolean
}

export interface CronRemoveParams {
  user: string
  ref: string
}

export interface CronRunParams {
  user: string
  command: string
}

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const HEREDOC = 'SHELLWAY_CRONTAB_EOF'
const RUN_TIMEOUT_SECONDS = 3600

interface Target {
  crontab: UserCrontab
  self: string
}

function resolveTarget(user: string, facts: ServerFacts): Target | string {
  const crontabs = factData<CrontabFacts>(facts, CRONTABS_PROBE)
  const users = factData<UsersFacts>(facts, USERS_PROBE)
  if (!crontabs || !users) return 'Shellway could not read the crontabs. Refresh and try again.'
  if (!crontabs.installed) return 'cron is not installed on this server.'
  if (!hasUser(users, user)) return `The user ${user} does not exist on this server.`
  const crontab = findCrontab(crontabs, user)
  if (crontab) return { crontab, self: crontabs.self }
  if (user !== crontabs.self && !crontabs.readsOthers) return `Shellway needs passwordless sudo to change the crontab of ${user}.`
  return { crontab: { user, sha256: EMPTY_SHA256, text: '', entries: [] }, self: crontabs.self }
}

const crontabCommand = (user: string, self: string, args: string): string => (user === self ? `crontab ${args}` : `crontab -u ${quote(user)} ${args}`)

function installScript(target: Target, text: string): string {
  const { user, sha256 } = target.crontab
  if (crontabLines(text).includes(HEREDOC)) throw new Error('The crontab contains a line Shellway cannot write safely')
  return [
    'set -e',
    `current=$(${crontabCommand(user, target.self, '-l')} 2>/dev/null | sha256sum | cut -c1-64)`,
    `if [ "$current" != ${quote(sha256)} ]; then echo ${quote(`The crontab of ${user} changed since Shellway read it. Refresh and try again.`)} >&2; exit ${EXIT_CHANGED}; fi`,
    `${crontabCommand(user, target.self, '-')} <<'${HEREDOC}'`,
    `${text}${HEREDOC}`,
    ''
  ].join('\n')
}

function installStep(target: Target, text: string, diff: string): ActionStep {
  const { user } = target.crontab
  return commandStep({
    id: 'install-crontab',
    label: `Update the crontab of ${user}`,
    root: user !== target.self,
    script: installScript(target, text),
    display: crontabCommand(user, target.self, '-'),
    diff,
    cleanExits: [EXIT_CHANGED]
  })
}

function prepareLogStep(user: string, id: string): ActionStep {
  const log = cronLogPath(id)
  const script = [`install -d -m 0755 ${CRON_LOG_DIR}`, `touch ${log}`, `chown ${quote(user)}: ${log}`, `chmod 0640 ${log}`].join('\n')
  return commandStep({ id: 'prepare-log', label: 'Create the task log', root: true, script: `set -e\n${script}\n`, display: script })
}

function entryLine(crontab: UserCrontab, ref: string | null): number | null | undefined {
  if (ref === null) return null
  return crontab.entries.find((entry) => entry.ref === ref)?.line
}

function planCronSave(params: CronSaveParams, facts: ServerFacts): ActionPlan {
  const title = params.ref ? 'Update scheduled task' : 'Add scheduled task'
  const target = resolveTarget(params.user, facts)
  if (typeof target === 'string') return blockedPlan(title, target)
  const line = entryLine(target.crontab, params.ref)
  if (line === undefined) return blockedPlan(title, 'This task is no longer in the crontab. Refresh and try again.')
  const next = shellwayCronLine(params)
  const old = line === null ? null : crontabLines(target.crontab.text)[line]
  const diff = [...(old === null ? [] : [`- ${old}`]), `+ ${next}`].join('\n')
  return jobsPlan({
    title,
    summary: `${describeCron(params.expression)}, runs as ${params.user}. The result is kept in ${cronLogPath(params.id)}.`,
    steps: [prepareLogStep(params.user, params.id), installStep(target, replaceEntry(target.crontab.text, line, next), diff)]
  })
}

function validateRef(raw: Record<string, unknown>, id: string): string | null {
  if (raw.ref === null || raw.ref === undefined) return null
  const ref = text(raw, 'ref', TASK_REF, 'The task')
  if (ref.startsWith('shellway:') && ref !== `shellway:${id}`) throw new Error('The task id does not match')
  return ref
}

export const cronSaveAction: ActionDefinition<CronSaveParams> = {
  type: 'jobs.cron-save',
  area: 'jobs',
  needs: [CRONTABS_PROBE, USERS_PROBE],
  validate(raw) {
    const input = record(raw)
    const id = text(input, 'id', TASK_ID, 'The task id')
    return {
      user: text(input, 'user', USER_NAME, 'The user'),
      ref: validateRef(input, id),
      id,
      expression: expression(input),
      command: checked(command(input), cronCommandProblem),
      logOutput: flag(input, 'logOutput')
    }
  },
  plan: planCronSave
}

export const cronRemoveAction: ActionDefinition<CronRemoveParams> = {
  type: 'jobs.cron-remove',
  area: 'jobs',
  needs: [CRONTABS_PROBE, USERS_PROBE],
  validate(raw) {
    const input = record(raw)
    return { user: text(input, 'user', USER_NAME, 'The user'), ref: text(input, 'ref', TASK_REF, 'The task') }
  },
  plan(params, facts) {
    const title = 'Remove scheduled task'
    const target = resolveTarget(params.user, facts)
    if (typeof target === 'string') return blockedPlan(title, target)
    const line = entryLine(target.crontab, params.ref)
    if (line === undefined || line === null) return blockedPlan(title, 'This task is no longer in the crontab. Refresh and try again.')
    const old = crontabLines(target.crontab.text)[line]
    return jobsPlan({ title, summary: `Removes one line from the crontab of ${params.user}.`, steps: [installStep(target, replaceEntry(target.crontab.text, line, null), `- ${old}`)] })
  }
}

export function runNowScript(user: string, self: string, task: string): string {
  if (user === self) return `cd "$HOME" && sh -c ${quote(task)}`
  return `cd / && sudo -n -u ${quote(user)} -H sh -c ${quote(`cd "$HOME" && ${task}`)}`
}

export const cronRunNowAction: ActionDefinition<CronRunParams> = {
  type: 'jobs.cron-run-now',
  area: 'jobs',
  needs: [USERS_PROBE],
  validate(raw) {
    const input = record(raw)
    return { user: text(input, 'user', USER_NAME, 'The user'), command: command(input) }
  },
  plan(params, facts) {
    const title = 'Run task once now'
    const users = factData<UsersFacts>(facts, USERS_PROBE)
    if (!users || !hasUser(users, params.user)) return blockedPlan(title, `The user ${params.user} does not exist on this server.`)
    const script = runNowScript(params.user, users.self, params.command)
    return jobsPlan({
      title,
      summary: `Runs the command once as ${params.user} and shows its output. It keeps running if you disconnect.`,
      steps: [commandStep({ id: 'run', label: `Run as ${params.user}`, root: params.user !== users.self, script, timeoutSeconds: RUN_TIMEOUT_SECONDS, detached: true })]
    })
  }
}
