import type { KernelStatus, NeedRestart, UpdatesFacts, UpgradePackage } from './types'
import { hasSection, sectionLines, splitSections, type OutputSection } from './sections'

export const UPDATES_SCRIPT = `if ! command -v apt-get >/dev/null 2>&1; then echo '@@unsupported'; exit 0; fi
echo '@@upgrade'
LC_ALL=C apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep '^Inst '
echo '@@held'
apt-mark showhold 2>/dev/null
echo '@@stamp'
for f in /var/lib/apt/periodic/update-success-stamp /var/lib/apt/lists; do
  if [ -e "$f" ]; then stat -c %Y "$f"; break; fi
done
echo '@@now'
date +%s
echo '@@reboot'
[ -f /var/run/reboot-required ] && echo yes
echo '@@reboot-pkgs'
cat /var/run/reboot-required.pkgs 2>/dev/null
echo '@@needrestart'
if command -v needrestart >/dev/null 2>&1; then needrestart -b 2>/dev/null; else echo missing; fi
exit 0
`

const INST = /^Inst (\S+) (?:\[([^\]]*)\] )?\((\S+) ([^)]*)\)/

export function parseInstLine(line: string): UpgradePackage | null {
  const match = INST.exec(line)
  if (!match) return null
  return { name: match[1], from: match[2] ?? '', to: match[3], security: match[4].includes('-security') }
}

const KERNEL_STATUS: Record<string, KernelStatus> = { '1': 'current', '2': 'pending', '3': 'pending' }

function parseNeedRestart(lines: string[]): NeedRestart {
  if (lines.length === 0 || lines[0].trim() === 'missing') return { installed: false, services: [], kernel: 'unknown' }
  const values = lines.map((line) => /^NEEDRESTART-([A-Z]+):\s*(.*)$/.exec(line.trim())).filter((match): match is RegExpExecArray => match !== null)
  const services = values.filter(([, key]) => key === 'SVC').map(([, , value]) => value)
  const kernel = values.find(([, key]) => key === 'KSTA')?.[2] ?? ''
  return { installed: true, services: [...new Set(services)], kernel: KERNEL_STATUS[kernel] ?? 'unknown' }
}

const firstNumber = (sections: OutputSection[], name: string): number | null => {
  const value = Number.parseInt(sectionLines(sections, name)[0] ?? '', 10)
  return Number.isFinite(value) ? value : null
}

const UNSUPPORTED: UpdatesFacts = {
  supported: false,
  packages: [],
  held: [],
  checkedAt: null,
  serverNow: null,
  rebootRequired: false,
  rebootPackages: [],
  needRestart: { installed: false, services: [], kernel: 'unknown' }
}

export function parseUpdates(stdout: string): UpdatesFacts {
  const sections = splitSections(stdout)
  if (hasSection(sections, 'unsupported') || !hasSection(sections, 'upgrade')) return UNSUPPORTED
  const trimmed = (name: string) => sectionLines(sections, name).map((line) => line.trim())
  return {
    supported: true,
    packages: sectionLines(sections, 'upgrade').map(parseInstLine).filter((item): item is UpgradePackage => item !== null),
    held: trimmed('held'),
    checkedAt: firstNumber(sections, 'stamp'),
    serverNow: firstNumber(sections, 'now'),
    rebootRequired: trimmed('reboot').includes('yes'),
    rebootPackages: [...new Set(trimmed('reboot-pkgs'))],
    needRestart: parseNeedRestart(sectionLines(sections, 'needrestart'))
  }
}

export const securityUpdates = (facts: UpdatesFacts): UpgradePackage[] => facts.packages.filter((item) => item.security)

export function daysSinceCheck(facts: UpdatesFacts): number | null {
  if (facts.checkedAt === null || facts.serverNow === null) return null
  return Math.max(0, Math.floor((facts.serverNow - facts.checkedAt) / 86_400))
}
