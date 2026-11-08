import type { Leftover, RunRecord } from '@/types/createSite'
import { databaseSizeCommand, engineLabel, manualDropCommand } from './database'
import { keptResources, type RemovalStep } from './removal'
import { deployRootOf } from './siteScripts'
import { assertFolder, assertSiteName } from './validate'

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export function deletePreview(step: RemovalStep): string {
  switch (step.kind) {
    case 'deploy-site': return `Deploy site ${step.siteName}: automatic deploys stop, and its settings and deploy key on the server are deleted.`
    case 'app': return `${step.title} is stopped.`
    case 'jobs': return 'The scheduler and queue worker, if their files are unchanged.'
    case 'dns-record': return `${step.title}, if it still points at ${step.expected.content}.`
    case 'site-file': return `${step.title}, if unchanged. The web server keeps running.`
    case 'php-pool': return `${step.title}, if unchanged.`
    case 'certificate': return `${step.title}, if nothing else on the server uses it.`
    case 'env-file':
    case 'database':
    case 'folder': return step.title
  }
}

interface ServerLeftover extends Leftover {
  sizeCommand: string
}

function folderLeftover(record: RunRecord): ServerLeftover[] {
  const { folder } = record.created
  if (folder === null) return []
  const path = assertFolder(folder.path)
  if (record.input.codeSource === 'none') {
    return [{ id: 'folder', title: `The site folder ${path}`, command: `sudo rm -rf ${quote(path)}`, size: null, sizeCommand: `du -sh ${quote(path)} 2>/dev/null | cut -f1` }]
  }
  const root = deployRootOf(path)
  return [{
    id: 'folder',
    title: `The site folder ${root} with every release, uploaded files and the .env file, and the link ${path}`,
    command: `sudo rm -rf ${quote(root)} ${quote(path)}`,
    size: null,
    sizeCommand: `du -sh ${quote(root)} 2>/dev/null | cut -f1`
  }]
}

function databaseLeftover({ created }: RunRecord): ServerLeftover[] {
  const { database } = created
  if (database === null) return []
  const sizeCommand = databaseSizeCommand(database)
  if (database.engine === 'sqlite') return [{ id: 'database', title: `The SQLite database ${database.path}, inside the site folder`, command: null, size: null, sizeCommand }]
  const title = `The ${engineLabel(database.engine)} database ${database.name} with every table and row, and its user ${database.user}`
  return [{ id: 'database', title, command: manualDropCommand(database.engine, database.name, database.user), size: null, sizeCommand }]
}

function serverLeftovers(record: RunRecord): ServerLeftover[] {
  return [...folderLeftover(record), ...databaseLeftover(record)]
}

function otherLeftovers(record: RunRecord): Leftover[] {
  const { input } = record
  const repo = record.deployKey === null ? [] : [`The read-only deploy key on the repository ${input.repoUrl}. It no longer works, so you can delete it there.`]
  const compose = input.template === 'compose' && input.codeSource !== 'none'
    ? [`The Docker images and volumes of ${assertSiteName(input.siteName)}. List the volumes with: docker volume ls --filter label=com.docker.compose.project=${input.siteName}`]
    : []
  const shared = 'Packages and Apache modules Shellway installed, because other sites may use them.'
  return [...keptResources(record.created), ...repo, ...compose, shared].map((title, index) => ({ id: `other-${index}`, title, command: null, size: null }))
}

export function leftoversOf(record: RunRecord): Leftover[] {
  return [...serverLeftovers(record).map(({ sizeCommand: _sizeCommand, ...item }) => item), ...otherLeftovers(record)]
}

export function leftoverSizesScript(record: RunRecord): string {
  return [...serverLeftovers(record).map(({ id, sizeCommand }) => `printf '%s\\t%s\\n' ${id} "$(${sizeCommand})"`), ''].join('\n')
}

export function withSizes(items: Leftover[], probeOutput: string): Leftover[] {
  const sizes = new Map(probeOutput.split('\n').map((line) => line.split('\t')).filter((parts) => parts.length === 2 && parts[1].trim() !== '').map(([id, size]) => [id, size.trim()]))
  return items.map((item) => ({ ...item, size: sizes.get(item.id) ?? null }))
}
