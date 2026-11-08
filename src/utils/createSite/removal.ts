import type { CreatedDnsRecord, CreatedResources, RunRecord, SiteServer } from '@/types/createSite'
import type { WebServerDriver } from '../webServer/driver'
import { databaseLabel, removeDatabaseScript } from './database'
import { jobFiles, removeJobsScript } from './laravelJobs'
import { removePoolScript } from './phpPool'
import { ROOT_SHELL, removeCertificateScript, removeEnvFileScript, removeFolderScript, removeSiteScript, sitePaths } from './siteScripts'
import { assertLineage } from './validate'

export type RemovalStep =
  | { kind: 'deploy-site'; title: string; siteName: string }
  | { kind: 'jobs'; title: string; command: string; script: string }
  | { kind: 'certificate'; title: string; command: string; script: string }
  | { kind: 'dns-record'; title: string; zoneId: string; recordId: string; name: string }
  | { kind: 'site-file'; title: string; path: string; command: string; script: string }
  | { kind: 'php-pool'; title: string; path: string; command: string; script: string }
  | { kind: 'env-file'; title: string; path: string; command: string; script: string }
  | { kind: 'database'; title: string; command: string; script: string }
  | { kind: 'folder'; title: string; path: string; command: string; script: string }

function deploySiteSteps({ deploySite }: CreatedResources): RemovalStep[] {
  return deploySite === null ? [] : [{ kind: 'deploy-site', title: `Deploy site ${deploySite}`, siteName: deploySite }]
}

function jobsSteps({ jobs }: CreatedResources, input: RunRecord['input']): RemovalStep[] {
  if (jobs === null) return []
  const files = jobFiles(input.siteName, { scheduler: jobs.cronFile !== null, queueWorker: jobs.unitFile !== null })
  const names = [files.cronFile, files.unitFile].filter((path): path is string => path !== null)
  if (names.length === 0) return []
  return [{ kind: 'jobs', title: `Scheduler and queue worker ${names.join(', ')}`, command: ROOT_SHELL, script: removeJobsScript(input.siteName, files) }]
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

function dnsSteps({ dnsRecords }: CreatedResources): RemovalStep[] {
  return uniqueRecords(dnsRecords).map(({ zoneId, recordId, name, type }) => ({ kind: 'dns-record', title: `DNS record ${type} ${name}`, zoneId, recordId, name }))
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
  return [{ kind: 'folder', title: `Folder ${folder.path}`, path: folder.path, command: ROOT_SHELL, script: removeFolderScript(folder.path) }]
}

export function removalSteps(record: RunRecord, driver: WebServerDriver): RemovalStep[] {
  const { created, server } = record
  return [
    ...deploySiteSteps(created),
    ...jobsSteps(created, record.input),
    ...dnsSteps(created),
    ...siteFileStep(created.httpsSiteFile, server, driver),
    ...siteFileStep(created.siteFile, server, driver),
    ...poolSteps(created, record.input),
    ...certificateSteps(created),
    ...envFileSteps(created),
    ...databaseSteps(created),
    ...folderSteps(created)
  ]
}
