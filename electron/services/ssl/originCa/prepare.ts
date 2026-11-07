import { createHash } from 'node:crypto'
import type { OriginCertificate } from '../CloudflareClient'
import type { ServerBlock, SslReport, SwitchPrepared, SwitchRequest } from '../../../../src/types/ssl'
import { isIssuableName } from '../../../../src/utils/ssl/https/issueCommands'
import { originPaths } from '../../../../src/utils/ssl/originCa/originPaths'
import type { OriginPaths } from '../../../../src/utils/ssl/originCa/originPaths'
import { certWriteScript, csrScript, removeFilesCommand, switchScript } from '../../../../src/utils/ssl/originCa/scripts'
import { switchCheck } from '../../../../src/utils/ssl/originCa/switchCheck'
import { servingDriver, type WebServerDriver } from '../../../../src/utils/webServer'
import { shellEscape } from '../../../utils/shellEscape'
import type { RemoteExec } from '../../deploy/DeployService'
import type { OutputSink } from '../SslService'
import { RemoteRunner, SHORT_TIMEOUT_MS, SUDO_SHELL } from './remoteRun'

const KEYGEN_TIMEOUT_MS = 60_000
const CSR_PEM = /-----BEGIN (?:NEW )?CERTIFICATE REQUEST-----[\s\S]+-----END (?:NEW )?CERTIFICATE REQUEST-----/

export interface PrepareHooks {
  now: () => number
  newId: () => string
  onOutput: OutputSink
}

export interface PrepareInput {
  exec: RemoteExec
  cloudflare: { createOriginCert: (csr: string, hostnames: string[], keyType: SwitchRequest['keyType'], years: SwitchRequest['validityYears']) => Promise<OriginCertificate> }
  report: SslReport
  request: SwitchRequest
}

const SITE_CHANGED = 'The site file changed while preparing. Check again.'

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((value, i) => value === b[i])

const sha256 =(text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

function targetBlock(report: SslReport, request: SwitchRequest) {
  const check = switchCheck(report, request.blockId)
  if (check.blockedReason) throw new Error(check.blockedReason)
  const block = report.blocks.find((b) => b.id === request.blockId)!
  const names = block.names.map((name) => name.toLowerCase())
  const bad = names.find((name) => !isIssuableName(name))
  if (bad !== undefined) throw new Error(`${bad} cannot get an Origin CA certificate`)
  return { block, names }
}

class PrepareRun {
  private readonly runner: RemoteRunner
  private readonly paths: OriginPaths
  private readonly block: ServerBlock
  private readonly names: string[]
  private readonly driver: WebServerDriver

  constructor(private readonly input: PrepareInput, private readonly hooks: PrepareHooks) {
    const target = targetBlock(input.report, input.request)
    this.block = target.block
    this.names = target.names
    this.driver = servingDriver(input.report.facts)
    this.paths = originPaths(this.names[0], Math.floor(hooks.now() / 1000))
    this.runner = new RemoteRunner(input.exec, hooks.onOutput)
  }

  async execute(): Promise<SwitchPrepared> {
    try {
      return await this.build()
    } catch (err) {
      await this.discard()
      throw err
    }
  }

  private async build(): Promise<SwitchPrepared> {
    const csr = await this.makeCsr()
    this.runner.note(`Asking Cloudflare to sign the certificate for ${this.names.join(', ')}`)
    const signed = await this.input.cloudflare.createOriginCert(csr, this.names, this.input.request.keyType, this.input.request.validityYears)
    await this.writeCertificate(signed.certificate)
    const siteText = await this.readSiteFile()
    this.assertUnchanged(siteText)
    const swapped = this.driver.swapCertLines(siteText, this.block.line, this.paths.certPath, this.paths.keyPath)
    return {
      switchId: this.hooks.newId(),
      blockId: this.block.id,
      file: this.block.file,
      blockLine: this.block.line,
      names: this.names,
      certPath: this.paths.certPath,
      keyPath: this.paths.keyPath,
      keyType: this.input.request.keyType,
      validityYears: this.input.request.validityYears,
      notAfter: signed.notAfter,
      backupPath: this.paths.backupPath,
      diff: swapped.diff,
      webServer: this.driver.kind,
      apacheLayout: this.driver.kind === 'apache' ? this.input.report.facts.apache?.layout ?? null : null,
      script: switchScript({ driver: this.driver, file: this.block.file, expectedSha256: sha256(siteText), backupPath: this.paths.backupPath, newText: swapped.text })
    }
  }

  private async makeCsr(): Promise<string> {
    const script = csrScript(this.names, this.input.request.keyType, this.paths.keyPath)
    const made = await this.runner.run(SUDO_SHELL, KEYGEN_TIMEOUT_MS, { stdin: script, shown: 'create the private key on the server and a signing request', stream: false })
    const csr = CSR_PEM.exec(made.stdout)?.[0]
    if (made.code !== 0 || !csr) throw new Error('Could not create the private key and signing request on the server.')
    return `${csr}\n`
  }

  private async writeCertificate(pem: string): Promise<void> {
    const written = await this.runner.run(SUDO_SHELL, SHORT_TIMEOUT_MS, { stdin: certWriteScript(pem, this.paths.certPath), shown: `save the signed certificate as ${this.paths.certPath}` })
    if (written.code !== 0) throw new Error('Could not save the signed certificate on the server.')
  }

  private async readSiteFile(): Promise<string> {
    const read = await this.runner.run(`sudo -n base64 -w0 ${shellEscape(this.block.file)}`, SHORT_TIMEOUT_MS, { stream: false })
    const encoded = read.stdout.trim()
    if (read.code !== 0 || encoded === '') throw new Error(`Could not read ${this.block.file} on the server.`)
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(encoded, 'base64'))
    } catch {
      throw new Error(`${this.block.file} has characters Shellway cannot read safely. Edit it by hand.`)
    }
  }

  private assertUnchanged(siteText: string): void {
    if (!this.matchesScan(siteText)) throw new Error(SITE_CHANGED)
  }

  private matchesScan(siteText: string): boolean {
    try {
      const found = this.driver.siteIdentity(siteText, this.block.line)
      return found.certPath === this.block.certPath && found.keyPath === this.block.keyPath && sameList(found.names, this.names)
    } catch {
      return false
    }
  }

  private async discard(): Promise<void> {
    await this.runner.run(removeFilesCommand(this.paths.keyPath, this.paths.certPath), SHORT_TIMEOUT_MS)
  }
}

export async function runPrepare(input: PrepareInput, hooks: PrepareHooks): Promise<SwitchPrepared> {
  return new PrepareRun(input, hooks).execute()
}
