import type { DoctorReport, SiteConfig } from '@/types/deploy'
import { parseGitHubRepo } from './githubRepo'
import { sudoersLine } from './sudoers'

export type ReadyStatus = 'pass' | 'fail' | 'checking'
export type ReadyAction = 'copy' | 'add-to-github' | 'test-access' | 'add-by-hand'
export type ReadyItemId = 'tools' | 'key' | 'folder' | 'sudo' | 'web-site' | 'web-symlinks' | 'web-rewrite'

export type KeyAccess = { state: 'idle' | 'checking' } | { state: 'ok'; head: string } | { state: 'failed'; message: string }

export interface ReadyItem {
  id: ReadyItemId
  title: string
  detail: string
  required: boolean
  status: ReadyStatus
  code: string | null
  actions: ReadyAction[]
}

export interface ReadyInput {
  site: SiteConfig
  report: DoctorReport
  access: KeyAccess | null
  publicKey: string
}

export interface ReadySummary {
  passed: number
  total: number
  requiredLeft: number
  ready: boolean
}

export const SUDOERS_FILE = '/etc/sudoers.d/shellway-deploy'

const parentOf = (path: string): string => path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

function passing(id: ReadyItemId, title: string, detail: string, required = true): ReadyItem {
  return { id, title, detail, required, status: 'pass', code: null, actions: [] }
}

function failing(id: ReadyItemId, title: string, detail: string, extra: Partial<ReadyItem> = {}): ReadyItem {
  return { id, title, detail, required: true, status: 'fail', code: null, actions: [], ...extra }
}

function toolsItem({ site, report }: ReadyInput): ReadyItem {
  const auto = site.sourceMode === 'auto'
  const tools = [
    { name: 'git', ok: report.git },
    ...(auto ? [{ name: 'cron', ok: report.crontab }, { name: 'ssh-keygen', ok: report.sshKeygen }] : []),
    ...(site.healthUrl ? [{ name: 'curl or wget', ok: report.curl || report.wget }] : [])
  ]
  const missing = tools.filter((tool) => !tool.ok).map((tool) => tool.name)
  if (missing.length === 0) return passing('tools', 'Server tools are installed', tools.map((tool) => tool.name).join(' · '))
  return failing('tools', `Missing on the server: ${missing.join(', ')}`, "Install them with the server's package manager, then check again.")
}

function keyDetail(access: KeyAccess | null): string {
  if (access === null) return 'Open Deploy key from the site menu to create it and add it to the repository.'
  const intro = 'Add this read-only deploy key to the repository. It only grants access to this one repo.'
  return access.state === 'failed' ? `${access.message}. ${intro}` : intro
}

function keyActions(hasGitHub: boolean): ReadyAction[] {
  return hasGitHub ? ['copy', 'add-to-github', 'test-access', 'add-by-hand'] : ['copy', 'test-access']
}

function keyItem({ site, report, access, publicKey }: ReadyInput): ReadyItem | null {
  if (site.sourceMode !== 'auto') return null
  const github = parseGitHubRepo(site.repoUrl)
  const title = `Server can read ${github ? `${github.owner}/${github.repo}` : 'the repository'}`
  if (access ? access.state === 'ok' : report.deployKey) {
    return passing('key', title, access?.state === 'ok' ? `Reads ${site.branch} (${access.head.slice(0, 7)})` : 'Deploy key created')
  }
  return failing('key', title, keyDetail(access), {
    status: access?.state === 'checking' ? 'checking' : 'fail',
    code: publicKey || null,
    actions: keyActions(github !== null)
  })
}

function releasesFolderItem({ site, report }: ReadyInput): ReadyItem {
  if (report.sitePathKind === 'foreign-symlink') {
    return failing('folder', `${site.path} is a symlink Shellway did not create`, 'Remove or rename it, then check again.')
  }
  if (report.sitePathKind === 'symlink') return passing('folder', 'Site folder is set up', `${site.path} already points at the releases`)
  const parent = parentOf(site.path)
  const title = `${report.user} can write ${parent}`
  if (report.parentWritable) return passing('folder', title, `Needed to switch ${site.path} to releases`)
  return failing('folder', title, `Needed once to switch ${site.path} to releases. Run this once as an admin user, or switch this site to In place.`, {
    code: `sudo setfacl -m u:${report.user}:rwx ${parent}`,
    actions: ['copy']
  })
}

function inPlaceFolderItem({ site, report }: ReadyInput): ReadyItem {
  const title = `${report.user} can write ${site.path}`
  if (report.siteWritable || report.sitePathKind === 'missing') return passing('folder', title, site.path)
  return failing('folder', title, 'Run this once as an admin user:', { code: `sudo chown -R ${report.user} ${site.path}`, actions: ['copy'] })
}

const folderItem = (input: ReadyInput): ReadyItem => (input.site.layout === 'releases' ? releasesFolderItem(input) : inPlaceFolderItem(input))

function sudoItem({ report }: ReadyInput): ReadyItem | null {
  const { sudoNeeds, sudoOk, user } = report
  if (sudoNeeds.length > 0) {
    const commands = sudoNeeds.map((command) => `sudo ${command}`).join(', ')
    return failing('sudo', `Passwordless sudo for ${plural(sudoNeeds.length, 'command')}`, `${commands} would ask for a password and fail during a deploy. Add this line with sudo visudo -f ${SUDOERS_FILE}:`, {
      required: false,
      code: sudoersLine(user, sudoNeeds),
      actions: ['copy']
    })
  }
  if (sudoOk.length > 0) return passing('sudo', `Passwordless sudo for ${plural(sudoOk.length, 'command')}`, sudoOk.join(', '), false)
  return null
}

export function readyItems(input: ReadyInput): ReadyItem[] {
  return [toolsItem(input), keyItem(input), folderItem(input), sudoItem(input)].filter((item): item is ReadyItem => item !== null)
}

export function readySummary(items: ReadyItem[]): ReadySummary {
  const requiredLeft = items.filter((item) => item.required && item.status !== 'pass').length
  return { passed: items.filter((item) => item.status === 'pass').length, total: items.length, requiredLeft, ready: requiredLeft === 0 }
}

export const requiredLeftLabel = (requiredLeft: number): string =>
  requiredLeft === 0 ? 'All required items are ready' : `${plural(requiredLeft, 'required item')} left`
