import type { CreatedDnsRecord, CreatedResources, RunRecord, SiteServer } from '@/types/createSite'
import type { WebServerDriver } from '../webServer/driver'
import { ROOT_SHELL, removeFolderScript, removeSiteScript, sitePaths } from './siteScripts'
import { assertLineage } from './validate'

export type RemovalStep =
  | { kind: 'deploy-site'; title: string; siteName: string }
  | { kind: 'certificate'; title: string; command: string }
  | { kind: 'dns-record'; title: string; zoneId: string; recordId: string }
  | { kind: 'site-file'; title: string; command: string; script: string }
  | { kind: 'folder'; title: string; command: string; script: string }

function deploySiteSteps({ deploySite }: CreatedResources): RemovalStep[] {
  return deploySite === null ? [] : [{ kind: 'deploy-site', title: `Deploy site ${deploySite}`, siteName: deploySite }]
}

function certificateSteps({ certificate }: CreatedResources): RemovalStep[] {
  if (certificate === null || !certificate.issuedByRun) return []
  const lineage = assertLineage(certificate.lineage)
  return [{ kind: 'certificate', title: `Certificate ${lineage}`, command: `sudo -n certbot delete --non-interactive --cert-name ${lineage}` }]
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
  return uniqueRecords(dnsRecords).map(({ zoneId, recordId, name, type }) => ({ kind: 'dns-record', title: `DNS record ${type} ${name}`, zoneId, recordId }))
}

function siteNameOf(server: SiteServer, path: string): string {
  const siteName = path.slice(path.lastIndexOf('/') + 1).replace(/\.conf$/, '')
  if (sitePaths(server, siteName).file !== path) throw new Error(`${path} is not a site file Shellway creates`)
  return siteName
}

function siteFileSteps({ siteFile }: CreatedResources, server: SiteServer, driver: WebServerDriver): RemovalStep[] {
  if (siteFile === null) return []
  const siteName = siteNameOf(server, siteFile.path)
  const script = removeSiteScript({ driver, server, siteName, sha256: siteFile.sha256 })
  return [{ kind: 'site-file', title: `${driver.label} site ${siteFile.path}`, command: ROOT_SHELL, script }]
}

function folderSteps({ folder }: CreatedResources): RemovalStep[] {
  if (folder === null || !folder.createdByRun) return []
  return [{ kind: 'folder', title: `Folder ${folder.path}`, command: ROOT_SHELL, script: removeFolderScript(folder.path) }]
}

export function removalSteps(record: RunRecord, driver: WebServerDriver): RemovalStep[] {
  const { created, server } = record
  return [...deploySiteSteps(created), ...certificateSteps(created), ...dnsSteps(created), ...siteFileSteps(created, server, driver), ...folderSteps(created)]
}
