import { MYSQL_CLIENT } from './mysql'
import { AS_POSTGRES, PSQL } from './postgres'
import { shellQuote } from './identifiers'
import type { BackupSchedule, DbEngine } from './types'

export const BACKUP_DIR = '/var/backups/shellway/db'
export const BACKUP_CRON = '/etc/cron.d/shellway-db-backups'
export const BACKUP_SCRIPT_DIR = '/usr/local/lib/shellway'
export const BACKUP_SCRIPT = `${BACKUP_SCRIPT_DIR}/db-backup.sh`
export const LAST_RESULT = `${BACKUP_DIR}/last-result`

export const BACKUP_FILE = /^\/var\/backups\/shellway\/db\/(mysql|postgresql)\/([A-Za-z0-9_]{1,64})-(\d{8}-\d{6})\.(sql\.gz|dump)$/

export const DUMP_FUNCTIONS = `B=${BACKUP_DIR}
umask 077
new_file() {
  mkdir -p "$B/$1" && chmod 700 "$B" "$B/$1" || return 1
  while :; do
    f="$B/$1/$2-$(date +%Y%m%d-%H%M%S).$3"
    [ -e "$f" ] || [ -e "$f.part" ] || return 0
    sleep 1
  done
}
dump_mysql() {
  new_file mysql "$1" sql.gz || return 1
  rm -f "$f.failed"
  { mysqldump --single-transaction --routines --triggers "$1" || : > "$f.failed"; } | gzip > "$f.part" || : > "$f.failed"
  [ -e "$f.failed" ] || gzip -t "$f.part" 2>/dev/null || : > "$f.failed"
  if [ -e "$f.failed" ]; then rm -f "$f.part" "$f.failed"; return 1; fi
  mv "$f.part" "$f" && echo "saved $f"
}
dump_postgresql() {
  new_file postgresql "$1" dump || return 1
  if (cd /tmp && ${AS_POSTGRES} pg_dump -Fc "$1") > "$f.part"; then mv "$f.part" "$f" && echo "saved $f"; else rm -f "$f.part"; return 1; fi
}`

export function dumpScript(engine: DbEngine, database: string): string {
  return `${DUMP_FUNCTIONS}\ndump_${engine} ${shellQuote(database)}\n`
}

export function dumpDisplay(engine: DbEngine, database: string): string {
  const target = `${BACKUP_DIR}/${engine}/${database}-<time>`
  if (engine === 'mysql') return `mysqldump --single-transaction --routines --triggers ${database} | gzip > ${target}.sql.gz`
  return `sudo -u postgres pg_dump -Fc ${database} > ${target}.dump`
}

const SKIP_MYSQL = "'mysql','information_schema','performance_schema','sys'"

export const SCHEDULED_SCRIPT = `#!/bin/sh
KEEP="\${1:-7}"
${DUMP_FUNCTIONS}
saved=0
failed=0
note=''
is_name() { case "$1" in ''|*[!A-Za-z0-9_]*) return 1 ;; esac; }
prune() { find "$B/$1" -maxdepth 1 -type f -name "$2-[0-9]*" -mmin +$((KEEP * 1440)) -delete 2>/dev/null; }
run_all() {
  for db in $2; do
    is_name "$db" || continue
    if dump_$1 "$db" >/dev/null; then saved=$((saved + 1)); prune "$1" "$db"; else failed=$((failed + 1)); note="$note $1:$db"; fi
  done
}
if command -v mysql >/dev/null 2>&1; then
  if names=$(${MYSQL_CLIENT} -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN (${SKIP_MYSQL})" 2>/dev/null); then
    run_all mysql "$names"
  else
    failed=$((failed + 1)); note="$note mysql:sign-in"
  fi
fi
if command -v psql >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  if names=$(cd /tmp && ${PSQL} -A -t -c "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'" 2>/dev/null); then
    run_all postgresql "$names"
  else
    failed=$((failed + 1)); note="$note postgresql:sign-in"
  fi
fi
status=ok
[ "$failed" -eq 0 ] || status=failed
mkdir -p "$B"
printf 'status=%s\\nat=%s\\nsaved=%s\\nfailed=%s\\nnote=%s\\n' "$status" "$(date +%s)" "$saved" "$failed" "\${note# }" > "${LAST_RESULT}.tmp" && mv "${LAST_RESULT}.tmp" "${LAST_RESULT}"
[ "$failed" -eq 0 ]
`

export function cronContent(schedule: BackupSchedule): string {
  return [
    '# Shellway database backups',
    'SHELL=/bin/sh',
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    `${schedule.minute} ${schedule.hour} * * * root ${BACKUP_SCRIPT} ${schedule.keepDays} >/dev/null 2>&1`,
    ''
  ].join('\n')
}

const CRON_LINE = /^(\d{1,2}) (\d{1,2}) \* \* \* root \/usr\/local\/lib\/shellway\/db-backup\.sh (\d+)/m

export function parseCron(content: string): BackupSchedule | null {
  const match = CRON_LINE.exec(content)
  if (!match) return null
  return { minute: Number(match[1]), hour: Number(match[2]), keepDays: Number(match[3]) }
}
