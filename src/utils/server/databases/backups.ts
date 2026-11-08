import type { ProbeDefinition } from '@/types/server/core'
import { BACKUP_CRON, BACKUP_DIR, BACKUP_FILE, BACKUP_SCRIPT, LAST_RESULT, parseCron } from './backupScripts'
import { BACKUPS_PROBE } from './facts'
import { sectionLines, splitSections, tabFields, toInt } from './sections'
import type { BackupFacts, BackupFile, BackupLastResult, DbEngine } from './types'

const SCRIPT = `echo @@cron
[ -f ${BACKUP_CRON} ] && { sha256sum ${BACKUP_CRON} | cut -d' ' -f1; cat ${BACKUP_CRON}; }
echo @@script
[ -f ${BACKUP_SCRIPT} ] && sha256sum ${BACKUP_SCRIPT} | cut -d' ' -f1
echo @@last
[ -f ${LAST_RESULT} ] && head -n 10 ${LAST_RESULT}
echo @@files
find ${BACKUP_DIR}/mysql ${BACKUP_DIR}/postgresql -maxdepth 1 -type f \\( -name '*.sql.gz' -o -name '*.dump' \\) -printf '%T@\\t%s\\t%p\\n' 2>/dev/null | sort -rn | head -n 200
`

export function parseBackupFile(line: string): BackupFile | null {
  const [modified, size, path] = tabFields(line)
  const match = BACKUP_FILE.exec(path ?? '')
  if (!match) return null
  return { path, engine: match[1] as DbEngine, database: match[2], sizeBytes: toInt(size), modifiedAt: Math.round(Number(modified) * 1000) }
}

function parseLast(lines: string[]): BackupLastResult | null {
  const values = new Map(lines.map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
  if (!values.has('status')) return null
  return {
    ok: values.get('status') === 'ok',
    at: toInt(values.get('at')) * 1000,
    saved: toInt(values.get('saved')),
    failed: toInt(values.get('failed')),
    note: values.get('note') ?? ''
  }
}

export function parseBackups(stdout: string): BackupFacts {
  const sections = splitSections(stdout)
  const cron = sectionLines(sections, 'cron')
  const cronContent = cron.length > 0 ? `${cron.slice(1).join('\n')}\n` : null
  return {
    schedule: cronContent ? parseCron(cronContent) : null,
    cronContent,
    cronSha256: cron[0] ?? null,
    scriptSha256: sectionLines(sections, 'script')[0] ?? null,
    last: parseLast(sectionLines(sections, 'last')),
    files: sectionLines(sections, 'files').map(parseBackupFile).filter((file): file is BackupFile => file !== null)
  }
}

export const backupsProbe: ProbeDefinition<BackupFacts> = {
  id: BACKUPS_PROBE,
  area: 'databases',
  root: true,
  timeoutSeconds: 20,
  script: SCRIPT,
  parse: parseBackups
}
