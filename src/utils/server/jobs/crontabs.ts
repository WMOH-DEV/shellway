import { CRON_LOG_DIR, parseLastRun, parseSystemCrontab, parseUserCrontab } from './crontab'
import { blocksTagged, blockText, firstArgs, hasTag, splitBlocks, type Block } from './shell'
import type { CronEntry, CrontabFacts, LastRun, UserCrontab } from './types'

function lastRuns(blocks: Block[]): Map<string, LastRun> {
  const runs = new Map<string, LastRun>()
  for (const block of blocksTagged(blocks, 'last')) {
    const [id, ...rest] = block.args.split(' ')
    const run = parseLastRun(rest.join(' '))
    if (id && run) runs.set(id, run)
  }
  return runs
}

const withLastRun = (runs: Map<string, LastRun>) => (entry: CronEntry): CronEntry =>
  entry.shellway ? { ...entry, lastRun: runs.get(entry.shellway.id) ?? null } : entry

export function parseCrontabs(stdout: string): CrontabFacts {
  const blocks = splitBlocks(stdout)
  const self = firstArgs(blocks, 'self')
  if (hasTag(blocks, 'missing')) return { installed: false, self, readsOthers: false, crontabs: [], system: [] }
  const runs = lastRuns(blocks)
  const crontabs = blocksTagged(blocks, 'crontab').map((block): UserCrontab => {
    const [user, sha256 = ''] = block.args.split(' ')
    const text = blockText(block)
    return { user, sha256, text, entries: parseUserCrontab(text, user).map(withLastRun(runs)) }
  })
  const system = blocksTagged(blocks, 'system').flatMap((block) => parseSystemCrontab(blockText(block), block.args))
  return { installed: true, self, readsOthers: firstArgs(blocks, 'others') === 'yes', crontabs, system }
}

export const findCrontab = (facts: CrontabFacts, user: string): UserCrontab | undefined => facts.crontabs.find((crontab) => crontab.user === user)

export const CRONTABS_SCRIPT = `self=$(id -un)
echo "@@self $self"
if ! command -v crontab >/dev/null 2>&1; then echo '@@missing'; exit 0; fi
echo "@@crontab $self $(crontab -l 2>/dev/null | sha256sum | cut -c1-64)"
crontab -l 2>/dev/null
echo
echo '@@end'
as_root=''
if [ "$(id -u)" -eq 0 ]; then as_root='env'; elif sudo -n true 2>/dev/null; then as_root='sudo -n'; fi
if [ -n "$as_root" ]; then
  echo '@@others yes'
  users=$({ echo root; $as_root ls -1 /var/spool/cron/crontabs /var/spool/cron 2>/dev/null; } | grep -E '^[a-z_][a-z0-9_.-]*$' | sort -u | head -n 30)
  for u in $users; do
    [ "$u" = "$self" ] && continue
    getent passwd "$u" >/dev/null 2>&1 || continue
    echo "@@crontab $u $($as_root crontab -l -u "$u" 2>/dev/null | sha256sum | cut -c1-64)"
    $as_root crontab -l -u "$u" 2>/dev/null
    echo
    echo '@@end'
  done
else
  echo '@@others no'
  as_root='env'
fi
for f in $($as_root sh -c 'ls -1 ${CRON_LOG_DIR}/cron-*.log 2>/dev/null' | head -n 200); do
  id=$(basename "$f" .log)
  echo "@@last \${id#cron-} $($as_root tail -n 5 "$f" 2>/dev/null | grep 'shellway-exit' | tail -n 1)"
done
for f in /etc/crontab $(ls -1 /etc/cron.d 2>/dev/null | head -n 50 | sed 's|^|/etc/cron.d/|'); do
  [ -f "$f" ] && [ -r "$f" ] || continue
  echo "@@system $f"
  head -c 65536 "$f"
  echo
  echo '@@end'
done
`
