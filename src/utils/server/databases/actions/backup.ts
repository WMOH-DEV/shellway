import type { ActionDefinition, ActionPlan, ActionStep, ServerFacts } from '@/types/server/core'
import { fileEditStep } from '../../fileEdit'
import { BACKUP_CRON, BACKUP_SCRIPT, BACKUP_SCRIPT_DIR, cronContent, dumpDisplay, dumpScript, SCHEDULED_SCRIPT } from '../backupScripts'
import { backupFacts, BACKUPS_PROBE, MYSQL_PROBE, POSTGRES_PROBE } from '../facts'
import { DB_NAME, ENGINES } from '../identifiers'
import { asParams, flag, integer, matching, pick } from '../params'
import { blockedPlan, hasDatabase, makePlan, withEngine } from '../plan'
import type { BackupFacts, BackupSchedule, DbEngine } from '../types'

export interface BackupNowParams {
  engine: DbEngine
  name: string
}

export interface ScheduleParams {
  enabled: boolean
  schedule: BackupSchedule
}

const DUMP_TIMEOUT_SECONDS = 3600

export function dumpStep(engine: DbEngine, name: string, id = 'backup'): ActionStep {
  return {
    id,
    label: `Back up ${name}`,
    kind: 'command',
    root: true,
    script: dumpScript(engine, name),
    display: dumpDisplay(engine, name),
    timeoutSeconds: DUMP_TIMEOUT_SECONDS,
    detached: true
  }
}

export const backupNowAction: ActionDefinition<BackupNowParams> = {
  type: 'databases.backup-now',
  area: 'databases',
  needs: [MYSQL_PROBE, POSTGRES_PROBE],
  validate(raw) {
    const params = asParams(raw)
    return { engine: pick(params, 'engine', ENGINES), name: matching(params, 'name', DB_NAME) }
  },
  plan({ engine, name }, facts) {
    const title = `Back up ${name}`
    return withEngine(facts, engine, title, (data) => {
      if (!hasDatabase(data, name)) return blockedPlan(title, `There is no database named ${name}.`)
      return makePlan({ title, summary: `Saves a copy of ${name} in the backups folder on the server. Only root can read it.`, steps: [dumpStep(engine, name)] })
    })
  }
}

const scriptDirStep: ActionStep = {
  id: 'script-dir',
  label: 'Create the folder for the backup script',
  kind: 'command',
  root: true,
  script: `mkdir -p ${BACKUP_SCRIPT_DIR} && chmod 755 ${BACKUP_SCRIPT_DIR}\n`,
  display: `mkdir -p ${BACKUP_SCRIPT_DIR}`,
  timeoutSeconds: 30,
  rollback: `rmdir ${BACKUP_SCRIPT_DIR} 2>/dev/null || true\n`
}

const pad = (value: number): string => String(value).padStart(2, '0')

export const scheduleLabel = (schedule: BackupSchedule): string => `${pad(schedule.hour)}:${pad(schedule.minute)}`

function enableSteps(schedule: BackupSchedule, current: BackupFacts): ActionStep[] {
  return [
    ...(current.scriptSha256 ? [] : [scriptDirStep]),
    fileEditStep({ id: 'script', label: 'Write the backup script', path: BACKUP_SCRIPT, content: SCHEDULED_SCRIPT, originalSha256: current.scriptSha256, mode: '755', owner: 'root:root' }),
    fileEditStep({ id: 'cron', label: 'Schedule the nightly backup', path: BACKUP_CRON, content: cronContent(schedule), originalSha256: current.cronSha256, mode: '644', owner: 'root:root' })
  ]
}

function disableStep(previous: string): ActionStep {
  return {
    id: 'unschedule',
    label: 'Stop the nightly backup',
    kind: 'command',
    root: true,
    script: `rm -f ${BACKUP_CRON}\n`,
    display: `rm -f ${BACKUP_CRON}`,
    timeoutSeconds: 30,
    rollback: `cat > ${BACKUP_CRON} <<'SHELLWAY_CRON'\n${previous}SHELLWAY_CRON\nchmod 644 ${BACKUP_CRON}\n`
  }
}

function planSchedule(params: ScheduleParams, facts: ServerFacts): ActionPlan {
  const title = params.enabled ? 'Schedule database backups' : 'Stop database backups'
  const current = backupFacts(facts)
  if (!current) return blockedPlan(title, 'Shellway could not check the backup settings. Refresh and try again.')
  if (!params.enabled) {
    if (!current.cronContent) return blockedPlan(title, 'Backups are not scheduled.')
    return makePlan({ title, summary: 'Stops the nightly backup. Existing backup files stay.', steps: [disableStep(current.cronContent)] })
  }
  const { schedule } = params
  return makePlan({
    title,
    summary: `Backs up every database each night at ${scheduleLabel(schedule)} (server time) and keeps ${schedule.keepDays} days of backups.`,
    steps: enableSteps(schedule, current),
    warnings: ['Old backups are deleted after the kept days, including ones you made by hand. Nothing is deleted when a night fails.']
  })
}

export const scheduleBackupsAction: ActionDefinition<ScheduleParams> = {
  type: 'databases.schedule-backups',
  area: 'databases',
  needs: [BACKUPS_PROBE],
  validate(raw) {
    const params = asParams(raw)
    const enabled = flag(params, 'enabled')
    return {
      enabled,
      schedule: { hour: integer(params, 'hour', 0, 23), minute: integer(params, 'minute', 0, 59), keepDays: integer(params, 'keepDays', 1, 365) }
    }
  },
  plan: planSchedule
}
