import type { CreatedResources, RunRecord } from '../../../src/types/createSite'
import { matchesPlan } from '../../../src/utils/createSite/existingDns'
import { LEFT_IN_PLACE, leftInPlace } from '../../../src/utils/createSite/refusal'
import { deleteSteps, removalSteps, type RemovalStep } from '../../../src/utils/createSite/removal'
import { EXIT_REFUSED } from '../../../src/utils/ssl/originCa/exitCodes'
import type { WebServerDriver } from '../../../src/utils/webServer/driver'
import { lastLine } from './CreateSiteRun'
import type { CreateSitePorts } from './ports'

const REMOVE_TIMEOUT_MS = 120_000

export type RefusalPolicy = 'stop' | 'keep'

const KEEPABLE: ReadonlySet<RemovalStep['kind']> = new Set(['jobs', 'dns-record', 'site-file', 'php-pool', 'certificate'])

class LeftInPlace extends Error {}

function withoutResource(created: CreatedResources, step: RemovalStep): CreatedResources {
  switch (step.kind) {
    case 'deploy-site': return { ...created, deploySite: null }
    case 'app': return created
    case 'jobs': return { ...created, jobs: null }
    case 'certificate': return { ...created, certificate: null }
    case 'dns-record': return { ...created, dnsRecords: created.dnsRecords.filter((record) => record.recordId !== step.recordId) }
    case 'folder': return { ...created, folder: null }
    case 'php-pool': return { ...created, phpPool: null }
    case 'env-file': return { ...created, envFile: null }
    case 'database': return { ...created, database: null }
    case 'site-file':
      if (created.httpsSiteFile?.path === step.path) return { ...created, httpsSiteFile: null }
      return created.siteFile?.path === step.path ? { ...created, siteFile: null } : created
  }
}

class RemoveRun {
  constructor(private record: RunRecord, private readonly ports: CreateSitePorts, private readonly policy: RefusalPolicy) {}

  async execute(steps: RemovalStep[]): Promise<RunRecord> {
    this.update({ phase: 'removing', error: null })
    for (const step of steps) {
      this.ports.output(`Removing ${step.title}\n`)
      try {
        await this.removeOne(step)
      } catch (err) {
        if (!this.keeps(step, err)) return this.fail(`${step.title} was not removed: ${(err as Error).message}`)
        this.ports.output(`${(err as Error).message}\n`)
        this.update({ kept: [...(this.record.kept ?? []), (err as Error).message], ...(step.kind === 'site-file' ? { siteFileKept: true } : {}) })
      }
      this.update({ created: withoutResource(this.record.created, step) })
    }
    return this.update({ phase: 'removed', current: null })
  }

  private keeps(step: RemovalStep, err: unknown): boolean {
    return this.policy === 'keep' && err instanceof LeftInPlace && KEEPABLE.has(step.kind)
  }

  private fail(message: string): RunRecord {
    this.ports.output(`${message}\n`)
    return this.update({ phase: 'remove-failed', error: message })
  }

  private async removeOne(step: RemovalStep): Promise<void> {
    switch (step.kind) {
      case 'deploy-site': return this.removeDeploySite(step.siteName)
      case 'dns-record': return this.removeDnsRecord(step)
      case 'php-pool':
        if (this.record.siteFileKept) throw new LeftInPlace(leftInPlace(`${step.path} is used by the site file that was kept.`))
        return this.run(step.command, step.script)
      case 'app':
      case 'jobs':
      case 'certificate':
      case 'site-file':
      case 'env-file':
      case 'database':
      case 'folder': return this.run(step.command, step.script)
    }
  }

  private async removeDeploySite(name: string): Promise<void> {
    try {
      await this.ports.deploy.remove(name)
    } catch (err) {
      if ((await this.ports.deploy.siteNames()).includes(name)) throw err
      this.ports.output(`Deploy site ${name} is already gone.\n`)
    }
  }

  private async removeDnsRecord({ zoneId, recordId, name, expected }: Extract<RemovalStep, { kind: 'dns-record' }>): Promise<void> {
    const dns = this.ports.dns
    if (dns === null) throw new Error('Cloudflare is not connected. Connect it in SSL settings, then try again.')
    const stillThere = async () => (await dns.find(zoneId, name)).find((record) => record.id === recordId)
    const found = await stillThere()
    if (!found) {
      this.ports.output(`The DNS record for ${name} is already gone.\n`)
      return
    }
    if (!matchesPlan(found, expected)) throw new LeftInPlace(leftInPlace(`The DNS record ${found.type} ${name} now points at ${found.content}, not ${expected.content}.`))
    try {
      await dns.remove(zoneId, recordId)
    } catch (err) {
      if (await stillThere()) throw err
    }
  }

  private async run(command: string, script: string): Promise<void> {
    this.ports.output(`$ ${command}\n${script.trimEnd().split('\n').map((line) => `  ${line}`).join('\n')}\n`)
    const result = await this.ports.exec(command, { stdin: script, timeoutMs: REMOVE_TIMEOUT_MS, onOutput: this.ports.output })
    if (result.code === 0) return
    const message = lastLine(result.stderr) || `exit code ${result.code}`
    if (result.code === EXIT_REFUSED && result.stderr.includes(LEFT_IN_PLACE)) throw new LeftInPlace(message)
    throw new Error(message)
  }

  private update(changes: Partial<RunRecord>): RunRecord {
    this.record = { ...this.record, ...changes }
    this.ports.save(this.record)
    return this.record
  }
}

export function removeCreated(record: RunRecord, ports: CreateSitePorts, driver: WebServerDriver): Promise<RunRecord> {
  return new RemoveRun(record, ports, 'stop').execute(removalSteps(record, driver))
}

export function deleteSite(record: RunRecord, ports: CreateSitePorts, driver: WebServerDriver): Promise<RunRecord> {
  return new RemoveRun({ ...record, deleting: true }, ports, 'keep').execute(deleteSteps(record, driver))
}
