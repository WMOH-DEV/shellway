import type {
  DeployProgress,
  DeployRecord,
  DeployStage,
  DeployStatus,
  DoctorReport,
  SitePathKind,
  SiteState,
  SiteSummary
} from '../../../src/types/deploy'
import { parseSiteFiles } from './siteFiles'

const STATUSES: ReadonlySet<string> = new Set(['running', 'success', 'warning', 'failed', 'waiting', 'reverted', 'cancelled'])
const STAGES: ReadonlySet<string> = new Set(['fetch', 'build', 'activate', 'health'])
const PATH_KINDS: ReadonlySet<string> = new Set(['missing', 'dir', 'symlink', 'foreign-symlink', 'file'])

export function parseKeyValues(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0 && !line.includes('\t')) values[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return values
}

const toNumberOrNull = (value: string | undefined): number | null => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseRecord(line: string): DeployRecord | null {
  const [id, status, trigger, commit, started, finished, warnings, note] = line.split('\t')
  if (!id || !STATUSES.has(status)) return null
  return {
    id,
    status: status as DeployStatus,
    trigger: trigger ?? '',
    commit: commit === '-' ? '' : commit ?? '',
    started: toNumberOrNull(started) ?? 0,
    finished: toNumberOrNull(finished),
    warnings: toNumberOrNull(warnings) ?? 0,
    note: note ?? ''
  }
}

export function parseHistory(tsv: string): DeployRecord[] {
  const latest = new Map<string, DeployRecord>()
  for (const line of tsv.split('\n')) {
    const record = parseRecord(line)
    if (record) latest.set(record.id, record)
  }
  return [...latest.values()].sort((a, b) => b.started - a.started || b.id.localeCompare(a.id))
}

function parseProgress(v: Record<string, string>): DeployProgress | null {
  if (v.BUSY !== '1' || !STAGES.has(v.STAGE ?? '')) return null
  return {
    stage: v.STAGE as DeployStage,
    step: toNumberOrNull(v.STEP) ?? 0,
    steps: toNumberOrNull(v.STEPS) ?? 0,
    command: v.COMMAND ?? ''
  }
}

export function parseState(text: string): SiteState {
  const v = parseKeyValues(text)
  return {
    current: v.CURRENT ?? '',
    currentRelease: v.CURRENT_RELEASE ?? '',
    lastAttempted: v.LAST_ATTEMPTED ?? '',
    remoteHead: v.REMOTE_HEAD ?? '',
    heartbeat: toNumberOrNull(v.HEARTBEAT),
    mirrorHead: v.MIRROR_HEAD ?? '',
    pending: v.PENDING ?? '',
    behind: toNumberOrNull(v.BEHIND),
    busy: v.BUSY === '1',
    currentSubject: v.CURRENT_SUBJECT ?? '',
    progress: parseProgress(v),
    cancelling: v.BUSY === '1' && v.CANCELLING === '1',
    now: toNumberOrNull(v.NOW) ?? Math.floor(Date.now() / 1000)
  }
}

function tabbedValues(text: string, key: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith(`${key}\t`))
    .map((line) => line.slice(key.length + 1))
}

export function parseDoctor(text: string): DoctorReport {
  const v = parseKeyValues(text)
  const kind = v.SITE_PATH_KIND ?? 'missing'
  return {
    user: v.USER ?? '',
    git: v.GIT === '1',
    curl: v.CURL === '1',
    wget: v.WGET === '1',
    crontab: v.CRONTAB === '1',
    sshKeygen: v.SSH_KEYGEN === '1',
    sitePathKind: (PATH_KINDS.has(kind) ? kind : 'missing') as SitePathKind,
    parentWritable: v.PARENT_WRITABLE === '1',
    siteWritable: v.SITE_WRITABLE === '1',
    deployKey: v.DEPLOY_KEY === '1',
    sudoOk: tabbedValues(text, 'SUDO_OK'),
    sudoNeeds: tabbedValues(text, 'SUDO_NEEDS')
  }
}

type Section = 'CONF' | 'BUILD' | 'ACTIVATE' | 'STATUS' | 'HISTORY'

interface DumpBlock {
  name: string
  sections: Record<Section, string[]>
}

const emptySections = (): Record<Section, string[]> => ({ CONF: [], BUILD: [], ACTIVATE: [], STATUS: [], HISTORY: [] })

function splitDump(text: string): DumpBlock[] {
  const blocks: DumpBlock[] = []
  let block: DumpBlock | null = null
  let section: Section | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('@@SITE ')) {
      block = { name: line.slice(7), sections: emptySections() }
      blocks.push(block)
      section = null
    } else if (line === '@@END') {
      block = null
    } else if (block && /^@@(CONF|BUILD|ACTIVATE|STATUS|HISTORY)$/.test(line)) {
      section = line.slice(2) as Section
    } else if (block && section) {
      block.sections[section].push(line)
    }
  }
  return blocks
}

export function parseDump(text: string): SiteSummary[] {
  return splitDump(text).map(({ name, sections }) => ({
    config: parseSiteFiles(name, sections.CONF.join('\n'), sections.BUILD.join('\n'), sections.ACTIVATE.join('\n')),
    state: parseState(sections.STATUS.join('\n')),
    history: parseHistory(sections.HISTORY.join('\n'))
  }))
}
