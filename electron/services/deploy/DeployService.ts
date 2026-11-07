import type { Readable } from 'stream'
import runnerScript from '../../../resources/deploy/shellway-deploy.sh?raw'
import type { ExecOptions, ExecResult } from '../../utils/sshExec'
import { shellEscape } from '../../utils/shellEscape'
import type { DeployRecord, DetectResult, DoctorReport, RunnerInfo, ShipPreview, SiteConfig, SiteSummary } from '../../../src/types/deploy'
import { isValidSiteName, serializeSiteConf, serializeSteps, validateSiteConfig } from './siteFiles'
import { parseDoctor, parseDump, parseHistory, parseKeyValues, parsePreview } from './parse'

export type RemoteExec = (command: string, options?: ExecOptions) => Promise<ExecResult>

const HOME_DIR = '"$HOME/.shellway-deploy"'
export const RUNNER = '"$HOME/.shellway-deploy/bin/shellway-deploy"'
const BUNDLED_VERSION = Number(/RUNNER_VERSION=(\d+)/.exec(runnerScript)?.[1] ?? 0)
const LIST_TIMEOUT_MS = 30_000
const SETUP_TIMEOUT_MS = 90_000
const UPLOAD_TIMEOUT_MS = 10 * 60_000
const PREVIEW_TIMEOUT_MS = 330_000
const DEPLOY_ID = /^[A-Za-z0-9-]{1,64}$/
const ENV_MISSING_EXIT = 3
const ENV_BACKUPS_KEPT = 10

export function newDeployId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${stamp}-${suffix}`
}

function siteDir(name: string): string {
  if (!isValidSiteName(name)) throw new Error('Invalid site name')
  return `"$HOME/.shellway-deploy/sites/${name}"`
}

function checkId(id: string): string {
  if (!DEPLOY_ID.test(id)) throw new Error('Invalid deploy id')
  return id
}

function failure(result: ExecResult, fallback: string): Error {
  const message = (result.stderr || result.stdout).trim().replace(/^error:\s*/, '')
  return new Error(message || fallback)
}

export class DeployService {
  constructor(private readonly exec: RemoteExec) {}

  static get bundledVersion(): number {
    return BUNDLED_VERSION
  }

  async runnerInfo(): Promise<RunnerInfo> {
    const result = await this.exec(`${RUNNER} version 2>/dev/null`)
    const version = result.code === 0 ? Number.parseInt(result.stdout.trim(), 10) : NaN
    return {
      installed: Number.isFinite(version),
      version: Number.isFinite(version) ? version : null,
      bundledVersion: BUNDLED_VERSION
    }
  }

  async installRunner(): Promise<void> {
    const command = `mkdir -p ${HOME_DIR}/bin && cat > ${RUNNER}.tmp && chmod 755 ${RUNNER}.tmp && mv -f ${RUNNER}.tmp ${RUNNER}`
    await this.run(command, { stdin: runnerScript.replace(/\r\n/g, '\n') }, 'Could not install the deploy runner')
  }

  async listSites(): Promise<SiteSummary[]> {
    const result = await this.run(`${RUNNER} dump`, { timeoutMs: LIST_TIMEOUT_MS }, 'Could not read sites')
    return parseDump(result.stdout)
  }

  async saveSite(config: SiteConfig): Promise<void> {
    const invalid = validateSiteConfig(config)
    if (invalid) throw new Error(invalid)
    const dir = siteDir(config.name)
    await this.run(`mkdir -p ${dir} && chmod 700 ${dir}`, {}, 'Could not create the site folder')
    await this.writeFile(`${dir}/steps.build`, serializeSteps(config.buildSteps))
    await this.writeFile(`${dir}/steps.activate`, serializeSteps(config.activateSteps))
    await this.writeFile(`${dir}/site.conf`, serializeSiteConf(config))
    await this.run(`${RUNNER} sync-cron`, {}, 'Site saved, but the auto-deploy schedule could not be updated')
  }

  async removeSite(name: string): Promise<void> {
    siteDir(name)
    await this.run(`${RUNNER} remove ${name}`, {}, 'Could not remove the site')
  }

  async startDeploy(name: string, id: string, extraArgs: string[] = []): Promise<void> {
    siteDir(name)
    await this.detached(['deploy', name, '--id', checkId(id), ...extraArgs])
  }

  async startRollback(name: string, targetId: string, id: string): Promise<void> {
    siteDir(name)
    await this.detached(['rollback', name, checkId(targetId), '--id', checkId(id)])
  }

  async startApprove(name: string, id: string): Promise<void> {
    siteDir(name)
    await this.detached(['approve', name, '--id', checkId(id)])
  }

  async startApply(name: string, id: string): Promise<void> {
    siteDir(name)
    await this.detached(['apply', name, '--id', checkId(id)])
  }

  async cancel(name: string): Promise<void> {
    siteDir(name)
    await this.run(`${RUNNER} cancel ${name}`, { timeoutMs: LIST_TIMEOUT_MS }, 'Could not cancel the deploy')
  }

  async resume(name: string): Promise<void> {
    siteDir(name)
    await this.run(`${RUNNER} resume ${name}`, { timeoutMs: SETUP_TIMEOUT_MS }, 'Could not resume the auto check')
  }

  async history(name: string): Promise<DeployRecord[]> {
    siteDir(name)
    const result = await this.run(`${RUNNER} history ${name} 50`, {}, 'Could not read deploy history')
    return parseHistory(result.stdout)
  }

  async preview(name: string): Promise<ShipPreview> {
    siteDir(name)
    const result = await this.run(`${RUNNER} preview ${name}`, { timeoutMs: PREVIEW_TIMEOUT_MS }, 'Could not read what is about to ship')
    return parsePreview(result.stdout)
  }

  async readLog(name: string, id: string, offset: number): Promise<{ text: string; offset: number }> {
    siteDir(name)
    const start = Number.isInteger(offset) && offset > 0 ? offset : 0
    const result = await this.run(`${RUNNER} log ${name} ${checkId(id)} ${start}`, {}, 'Could not read the deploy log')
    return { text: result.stdout, offset: start + result.stdoutBytes }
  }

  async doctor(name: string): Promise<DoctorReport> {
    siteDir(name)
    const result = await this.run(`${RUNNER} doctor ${name}`, {}, 'Could not check the server')
    return parseDoctor(result.stdout)
  }

  async keygen(name: string): Promise<string> {
    siteDir(name)
    const result = await this.run(`${RUNNER} keygen ${name}`, {}, 'Could not create the deploy key')
    return result.stdout.trim()
  }

  async checkRemote(name: string): Promise<string> {
    siteDir(name)
    const result = await this.run(`${RUNNER} check-remote ${name}`, { timeoutMs: SETUP_TIMEOUT_MS }, 'The server could not read the repository')
    return result.stdout.trim()
  }

  async readEnv(name: string): Promise<{ exists: boolean; content: string; path: string }> {
    siteDir(name)
    const command = `p=$(${RUNNER} env-path ${name}) || exit 1; printf '%s\\n' "$p"; [ -f "$p" ] || exit ${ENV_MISSING_EXIT}; cat "$p"`
    const result = await this.exec(command)
    const newline = result.stdout.indexOf('\n')
    const path = result.stdout.slice(0, newline)
    if (result.code === ENV_MISSING_EXIT) return { exists: false, content: '', path }
    if (result.code !== 0) throw failure(result, 'Could not read the env file')
    return { exists: true, content: result.stdout.slice(newline + 1), path }
  }

  async writeEnv(name: string, content: string): Promise<void> {
    const backups = `${siteDir(name)}/env-backups`
    const command = [
      `p=$(${RUNNER} env-path ${name}) || exit 1`,
      'mkdir -p "$(dirname "$p")" || exit 1',
      `mkdir -p ${backups} && chmod 700 ${backups} || exit 1`,
      `[ -f "$p" ] && { cp -p "$p" ${backups}/env-$(date +%Y%m%d%H%M%S)-$$ || exit 1; }`,
      `ls -1 ${backups} | sort -r | tail -n +${ENV_BACKUPS_KEPT + 1} | while read -r old; do rm -f ${backups}/"$old"; done`,
      '(umask 077 && cat > "$p.shellway-tmp") && cat "$p.shellway-tmp" > "$p" && rm -f "$p.shellway-tmp"'
    ].join('; ')
    await this.run(command, { stdin: content }, 'Could not save the env file')
  }

  async detect(path: string): Promise<DetectResult> {
    if (!path.startsWith('/')) throw new Error('Path must be absolute')
    const command = [
      `cd ${shellEscape(path)} 2>/dev/null || { echo EXISTS=0; exit 0; }`,
      'echo EXISTS=1',
      'echo "REPO=$(git config --get remote.origin.url 2>/dev/null)"',
      'echo "BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"',
      'grep -q \'"build"[[:space:]]*:\' package.json 2>/dev/null && echo BUILD_SCRIPT=1',
      'ls -1A | while read -r f; do printf \'FILE\\t%s\\n\' "$f"; done'
    ].join('; ')
    const result = await this.run(command, {}, 'Could not inspect the folder')
    const values = parseKeyValues(result.stdout)
    return {
      exists: values.EXISTS === '1',
      repoUrl: values.REPO ?? '',
      branch: values.BRANCH && values.BRANCH !== 'HEAD' ? values.BRANCH : '',
      buildScript: values.BUILD_SCRIPT === '1',
      files: result.stdout.split('\n').filter((l) => l.startsWith('FILE\t')).map((l) => l.slice(5))
    }
  }

  async uploadBundle(name: string, bundle: Readable): Promise<void> {
    const target = `${siteDir(name)}/incoming.bundle`
    await this.run(`cat > ${target}`, { stdin: bundle, timeoutMs: UPLOAD_TIMEOUT_MS }, 'Could not upload the code bundle')
  }

  async bundleFits(name: string): Promise<boolean> {
    const dir = siteDir(name)
    const result = await this.exec(`git --git-dir=${dir}/repo.git bundle verify ${dir}/incoming.bundle >/dev/null 2>&1`, { timeoutMs: SETUP_TIMEOUT_MS })
    return result.code === 0
  }

  private async detached(args: string[]): Promise<void> {
    const quoted = args.map(shellEscape).join(' ')
    await this.run(`nohup ${RUNNER} ${quoted} >/dev/null 2>&1 </dev/null &`, {}, 'Could not start the deploy')
  }

  private async writeFile(remotePath: string, content: string): Promise<void> {
    await this.run(`cat > ${remotePath}.tmp && mv -f ${remotePath}.tmp ${remotePath}`, { stdin: content }, 'Could not write site settings')
  }

  private async run(command: string, options: ExecOptions, fallback: string): Promise<ExecResult> {
    const result = await this.exec(command, options)
    if (result.code !== 0) throw failure(result, fallback)
    return result
  }
}
