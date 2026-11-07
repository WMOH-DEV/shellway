import type { ActionDefinition, ServerFacts } from '@/types/server/core'
import { fileEditStep } from '@/utils/server/fileEdit'
import { blockedPlan, commandStep, EXIT_CHANGED, factData, jobsPlan, lineDiff } from './plan'
import { quote } from './shell'
import { shellwayConfPath } from './supervisor'
import { PM2_PROBE, SUPERVISOR_PROBE, USERS_PROBE, type Pm2Facts, type SupervisorFacts, type UsersFacts } from './types'
import { hasUser } from './users'
import { checked, command, directory, flag, integer, oneOf, PM2_NAME, PROGRAM_NAME, record, supervisorCommandProblem, text, USER_NAME, WORKER_NAME } from './validate'

export const CONTROL_OPS = ['start', 'stop', 'restart'] as const
export type ControlOp = (typeof CONTROL_OPS)[number]

export interface WorkerSaveParams {
  name: string
  command: string
  directory: string
  user: string
  numprocs: number
  autostart: boolean
}

export interface WorkerNameParams {
  name: string
}

export interface WorkerControlParams {
  name: string
  op: ControlOp
}

export interface Pm2ControlParams {
  user: string
  name: string
  op: ControlOp
}

const OP_LABEL: Record<ControlOp, string> = { start: 'Start', stop: 'Stop', restart: 'Restart' }
const BACKUP_DIR = '/var/backups/shellway'

const supervisorEscape = (value: string): string => value.replace(/%/g, '%%')

export function supervisorConf(params: WorkerSaveParams): string {
  return [
    `[program:${params.name}]`,
    'process_name=%(program_name)s_%(process_num)02d',
    `command=${supervisorEscape(params.command)}`,
    `directory=${params.directory}`,
    `user=${params.user}`,
    `numprocs=${params.numprocs}`,
    `autostart=${params.autostart}`,
    'autorestart=true',
    'stopasgroup=true',
    'killasgroup=true',
    'redirect_stderr=true',
    `stdout_logfile=/var/log/supervisor/shellway-${params.name}.log`,
    'stopwaitsecs=3600',
    ''
  ].join('\n')
}

function supervisorProblem(supervisor: SupervisorFacts | null): string | null {
  if (!supervisor) return 'Shellway could not read Supervisor. Refresh and try again.'
  if (!supervisor.installed) return 'Supervisor is not installed. Install it from Software first.'
  return null
}

function planWorkerSave(params: WorkerSaveParams, facts: ServerFacts) {
  const title = `Save worker ${params.name}`
  const supervisor = factData<SupervisorFacts>(facts, SUPERVISOR_PROBE)
  const users = factData<UsersFacts>(facts, USERS_PROBE)
  const problem = supervisorProblem(supervisor)
  if (problem || !supervisor) return blockedPlan(title, problem ?? '')
  if (!users || !hasUser(users, params.user)) return blockedPlan(title, `The user ${params.user} does not exist on this server.`)
  const path = shellwayConfPath(params.name)
  const clash = supervisor.programs.find((program) => program.name === params.name && program.file !== path)
  if (clash) return blockedPlan(title, `A worker named ${params.name} already exists${clash.file ? ` in ${clash.file}` : ''}.`)
  const existing = supervisor.files.find((file) => file.path === path)
  const content = supervisorConf(params)
  return jobsPlan({
    title: existing ? `Update worker ${params.name}` : `Add worker ${params.name}`,
    summary: `Supervisor keeps ${params.numprocs === 1 ? 'one process' : `${params.numprocs} processes`} of this command running as ${params.user}.`,
    steps: [
      fileEditStep({
        id: 'write-config',
        label: 'Write the worker config and load it',
        path,
        content,
        originalSha256: existing?.sha256 ?? null,
        mode: '0644',
        owner: 'root:root',
        test: 'supervisorctl reread',
        reload: 'supervisorctl update',
        diff: lineDiff(existing?.content ?? '', content)
      })
    ]
  })
}

export const workerSaveAction: ActionDefinition<WorkerSaveParams> = {
  type: 'jobs.worker-save',
  area: 'jobs',
  needs: [SUPERVISOR_PROBE, USERS_PROBE],
  validate(raw) {
    const input = record(raw)
    return {
      name: text(input, 'name', WORKER_NAME, 'The worker name'),
      command: checked(command(input), supervisorCommandProblem),
      directory: directory(input),
      user: text(input, 'user', USER_NAME, 'The user'),
      numprocs: integer(input, 'numprocs', 1, 32),
      autostart: flag(input, 'autostart')
    }
  },
  plan: planWorkerSave
}

function removeScript(path: string, sha256: string, name: string): string {
  return [
    'set -e',
    `f=${quote(path)}`,
    `if [ "$(sha256sum < "$f" | cut -c1-64)" != ${quote(sha256)} ]; then echo 'The worker config changed since Shellway read it. Refresh and try again.' >&2; exit ${EXIT_CHANGED}; fi`,
    `mkdir -p ${BACKUP_DIR}`,
    `backup=${BACKUP_DIR}/shellway-${name}.conf.$(date +%Y%m%d%H%M%S)`,
    'cp "$f" "$backup"',
    'echo "SHELLWAY_STATE backup=$backup"',
    `supervisorctl stop ${quote(`${name}:*`)} || true`,
    'rm "$f"',
    ''
  ].join('\n')
}

export const workerRemoveAction: ActionDefinition<WorkerNameParams> = {
  type: 'jobs.worker-remove',
  area: 'jobs',
  needs: [SUPERVISOR_PROBE],
  validate: (raw) => ({ name: text(record(raw), 'name', WORKER_NAME, 'The worker name') }),
  plan(params, facts) {
    const title = `Remove worker ${params.name}`
    const supervisor = factData<SupervisorFacts>(facts, SUPERVISOR_PROBE)
    const path = shellwayConfPath(params.name)
    const file = supervisor?.files.find((candidate) => candidate.path === path)
    if (!file) return blockedPlan(title, 'Shellway can only remove workers it created. Refresh and try again.')
    return jobsPlan({
      title,
      summary: `Stops the worker and deletes ${path}. A backup is kept in ${BACKUP_DIR}.`,
      steps: [
        commandStep({
          id: 'remove-config',
          label: 'Stop the worker and remove its config',
          root: true,
          script: removeScript(path, file.sha256, params.name),
          display: [`cp ${path} ${BACKUP_DIR}/`, `supervisorctl stop '${params.name}:*'`, `rm ${path}`].join('\n'),
          diff: lineDiff(file.content, ''),
          rollback: `cp "$backup" ${quote(path)}\nsupervisorctl reread\nsupervisorctl update\n`,
          cleanExits: [EXIT_CHANGED]
        }),
        commandStep({ id: 'update', label: 'Tell Supervisor', root: true, script: 'set -e\nsupervisorctl reread\nsupervisorctl update\n', display: 'supervisorctl reread\nsupervisorctl update' })
      ]
    })
  }
}

export const workerControlAction: ActionDefinition<WorkerControlParams> = {
  type: 'jobs.worker-control',
  area: 'jobs',
  needs: [SUPERVISOR_PROBE],
  validate(raw) {
    const input = record(raw)
    return { name: text(input, 'name', PROGRAM_NAME, 'The worker name'), op: oneOf(input, 'op', CONTROL_OPS) }
  },
  plan(params, facts) {
    const title = `${OP_LABEL[params.op]} worker ${params.name}`
    const supervisor = factData<SupervisorFacts>(facts, SUPERVISOR_PROBE)
    if (!supervisor?.programs.some((program) => program.name === params.name)) return blockedPlan(title, `Supervisor has no worker named ${params.name}.`)
    const script = `supervisorctl ${params.op} ${quote(`${params.name}:*`)}`
    return jobsPlan({ title, summary: `${OP_LABEL[params.op]}s every process of ${params.name}.`, steps: [commandStep({ id: params.op, label: title, root: true, script })] })
  }
}

export function pm2Script(user: string, self: string, args: string): { root: boolean; script: string } {
  if (user === self) return { root: false, script: `pm2 ${args}` }
  return { root: true, script: `sudo -n -u ${quote(user)} -H pm2 ${args}` }
}

export const pm2ControlAction: ActionDefinition<Pm2ControlParams> = {
  type: 'jobs.pm2-control',
  area: 'jobs',
  needs: [PM2_PROBE, USERS_PROBE],
  validate(raw) {
    const input = record(raw)
    return { user: text(input, 'user', USER_NAME, 'The user'), name: text(input, 'name', PM2_NAME, 'The app name'), op: oneOf(input, 'op', CONTROL_OPS) }
  },
  plan(params, facts) {
    const title = `${OP_LABEL[params.op]} ${params.name}`
    const pm2 = factData<Pm2Facts>(facts, PM2_PROBE)
    const users = factData<UsersFacts>(facts, USERS_PROBE)
    if (!users || !pm2?.apps.some((app) => app.user === params.user && app.name === params.name)) return blockedPlan(title, `pm2 of ${params.user} has no app named ${params.name}.`)
    const { root, script } = pm2Script(params.user, users.self, `${params.op} ${quote(params.name)}`)
    return jobsPlan({ title, summary: `${OP_LABEL[params.op]}s the pm2 app ${params.name} of ${params.user}.`, steps: [commandStep({ id: params.op, label: title, root, script })] })
  }
}
