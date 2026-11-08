import type { CreatedDnsRecord, CreatedResources, DnsRecordPlan, RunRecord, SiteServer } from '@/types/createSite'
import type { WebServerDriver } from '../webServer/driver'
import { databaseLabel, removeDatabaseScript } from './database'
import { jobFiles, removeJobsScript } from './laravelJobs'
import { stopAppScript } from './pm2'
import { removePoolScript } from './phpPool'
import { PROJECT_SHELL, ROOT_SHELL, removeCertificateScript, removeEnvFileScript, removeFolderScript, removePlaceholderFolderScript, removeSiteScript, sitePaths } from './siteScripts'
import { assertLineage } from './validate'

export type RemovalStep =
  | { kind: 'deploy-site'; title: string; siteName: string }
  | { kind: 'app'; title: string; command: string; script: string }
  | { kind: 'jobs'; title: string; command: string; script: string }
  | { kind: 'certificate'; title: string; command: string; script: string }
  | { kind: 'dns-record'; title: string; zoneId: string; recordId: string; name: string; expected: Pick<DnsRecordPlan, 'type' | 'content'> }
  | { kind: 'site-file'; title: string; path: string; command: string; script: string }
  | { kind: 'php-pool'; title: string; path: string; command: string; script: string }
  | { kind: 'env-file'; title: string; path: string; command: string; script: string }
  | { kind: 'database'; title: string; command: string; script: string }
  | { kind: 'folder'; title: string; path: string; command: string; script: string }

function deploySiteSteps({ deploySite }: CreatedResources): RemovalStep[] {
  return deploySite === null ? [] : [{ kind: 'deploy-site', title: `Deploy site ${deploySite}`, siteName: deploySite }]
}

const deployStarted = ({ steps }: RunRecord): boolean => steps.some((step) => step.id === 'first-deploy' && step.startedAt !== null)

function appSteps(record: RunRecord): RemovalStep[] {
  const script = deployStarted(record) ? stopAppScript(record.input) : null
  return script === null ? [] : [{ kind: 'app', title: `The running app ${record.input.siteName}`, command: PROJECT_SHELL, script }]
}

function jobsSteps({ jobs }: CreatedResources, input: RunRecord['input']): RemovalStep[] {
  if (jobs === null) return []
  const files = jobFiles(input.siteName, { scheduler: jobs.cronFile !== null, queueWorker: jobs.unitFile !== null })
  const names = [files.cronFile, files.unitFile].filter((path): path is string => path !== null)
  if (names.length === 0) return []
  return [{ kind: 'jobs', title: `Scheduler and queue worker ${names.join(', ')}`, command: ROOT_SHELL, script: removeJobsScript(input, files) }]
}

function certificateSteps({ certificate }: CreatedResources): RemovalStep[] {
  if (certificate === null || !certificate.issuedByRun) return []
  const lineage = assertLineage(certificate.lineage)
  return [{ kind: 'certificate', title: `Certificate ${lineage}`, command: ROOT_SHELL, script: removeCertificateScript(lineage) }]
}

function uniqueRecords(records: CreatedDnsRecord[]): CreatedDnsRecord[] {
  const seen = new Set<string>()
  return records.filter(({ recordId }) => {
    if (recordId === '' || seen.has(recordId)) return false
    seen.add(recordId)
    return true
  })
}

const expectedContent = (type: CreatedDnsRecord['type'], input: RunRecord['input']): string => (type === 'A' ? (input.dns?.serverIp ?? '') : input.domain)

function dnsSteps({ dnsRecords }: CreatedResources, input: RunRecord['input']): RemovalStep[] {
  return uniqueRecords(dnsRecords).map(({ zoneId, recordId, name, type }) => ({
    kind: 'dns-record',
    title: `DNS record ${type} ${name}`,
    zoneId,
    recordId,
    name,
    expected: { type, content: expectedContent(type, input) }
  }))
}

function siteNameOf(server: SiteServer, path: string): string {
  const siteName = path.slice(path.lastIndexOf('/') + 1).replace(/\.conf$/, '')
  if (sitePaths(server, siteName).file !== path) throw new Error(`${path} is not a site file Shellway creates`)
  return siteName
}

function siteFileStep(file: { path: string; sha256: string } | null, server: SiteServer, driver: WebServerDriver): RemovalStep[] {
  if (file === null) return []
  const siteName = siteNameOf(server, file.path)
  const script = removeSiteScript({ driver, server, siteName, sha256: file.sha256 })
  return [{ kind: 'site-file', title: `${driver.label} site ${file.path}`, path: file.path, command: ROOT_SHELL, script }]
}

function poolSteps({ phpPool }: CreatedResources, input: RunRecord['input']): RemovalStep[] {
  if (phpPool === null) return []
  return [{ kind: 'php-pool', title: `PHP pool ${phpPool.path}`, path: phpPool.path, command: ROOT_SHELL, script: removePoolScript(input, phpPool.sha256) }]
}

function envFileSteps({ envFile }: CreatedResources): RemovalStep[] {
  if (envFile === null) return []
  return [{ kind: 'env-file', title: `Env file ${envFile.path}`, path: envFile.path, command: ROOT_SHELL, script: removeEnvFileScript(envFile.path, envFile.sha256) }]
}

function databaseSteps({ database }: CreatedResources): RemovalStep[] {
  if (database === null) return []
  const title = database.engine === 'sqlite' ? `SQLite file ${database.path} and everything in it` : `${databaseLabel(database)}, with every table and row in it`
  return [{ kind: 'database', title, command: ROOT_SHELL, script: removeDatabaseScript(database) }]
}

function folderSteps({ folder }: CreatedResources): RemovalStep[] {
  if (folder === null || !folder.createdByRun) return []
  const script = folder.placeholderSha256 ? removePlaceholderFolderScript(folder.path, folder.placeholderSha256) : removeFolderScript(folder.path)
  return [{ kind: 'folder', title: `Folder ${folder.path}`, path: folder.path, command: ROOT_SHELL, script }]
}

export function keptResources({ repo, localCopy }: CreatedResources): string[] {
  return [
    ...(repo?.createdByRun ? [`The repository ${repo.url}. Delete it on GitHub if you no longer want it.`] : []),
    ...(localCopy !== null ? [`The project folder ${localCopy} on this PC.`] : [])
  ]
}

function siteConfigSteps(record: RunRecord, driver: WebServerDriver): RemovalStep[] {
  const { created, server } = record
  return [
    ...deploySiteSteps(created),
    ...appSteps(record),
    ...jobsSteps(created, record.input),
    ...dnsSteps(created, record.input),
    ...siteFileStep(created.httpsSiteFile, server, driver),
    ...siteFileStep(created.siteFile, server, driver),
    ...poolSteps(created, record.input),
    ...certificateSteps(created)
  ]
}

export const deleteSteps = siteConfigSteps

export function removalSteps(record: RunRecord, driver: WebServerDriver): RemovalStep[] {
  const { created } = record
  return [...siteConfigSteps(record, driver), ...envFileSteps(created), ...databaseSteps(created), ...folderSteps(created)]
}
