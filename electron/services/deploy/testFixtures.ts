import { execFileSync, spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import type { SiteConfig } from '../../../src/types/deploy'
import type { ExecOptions, ExecResult } from '../../utils/sshExec'
import type { DeployService, RemoteExec } from './DeployService'

export function makeSite(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    name: 'example-app',
    path: '/var/www/example_app',
    repoUrl: 'git@github.com:acme/example-app.git',
    branch: 'main',
    sourceMode: 'auto',
    layout: 'releases',
    sharedPaths: ['.env', 'storage'],
    envFile: '.env',
    healthUrl: 'https://app.example.com/up',
    healthStatus: 200,
    autoRevert: true,
    keepReleases: 5,
    pollMinutes: 1,
    approveMigrations: false,
    migrationsPath: 'database/migrations',
    pcAuto: false,
    buildSteps: [{ command: 'composer install --no-dev --optimize-autoloader', optional: false }],
    activateSteps: [
      { command: 'php artisan migrate --force', optional: false },
      { command: `php artisan route:cache || echo "can't cache"`, optional: true }
    ],
    ...overrides
  }
}

export const gitTestEnv = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' }

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...gitTestEnv } }).toString().trim()
}

export function localExec(env: NodeJS.ProcessEnv): RemoteExec {
  return (command: string, options: ExecOptions = {}) => new Promise<ExecResult>((resolve) => {
    const child = spawn('sh', ['-c', command], { env })
    const stdout: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout.push(d) })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => {
      const out = Buffer.concat(stdout)
      resolve({ stdout: out.toString('utf8'), stdoutBytes: out.length, stderr, code: code ?? 1 })
    })
    const { stdin } = options
    if (stdin instanceof Readable) stdin.pipe(child.stdin)
    else child.stdin.end(stdin)
  })
}

export function fakeCrontab(dir: string): { bin: string; file: string } {
  const file = join(dir, 'crontab.txt')
  const bin = join(dir, 'fake-crontab')
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = -l ]; then cat "${file}" 2>/dev/null || exit 1; else cat > "${file}"; fi\n`, { mode: 0o755 })
  return { bin, file }
}

export async function waitForDeploy(service: DeployService, name: string, id: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const site = (await service.listSites()).find((s) => s.config.name === name)
    const record = site?.history.find((r) => r.id === id)
    if (record && record.status !== 'running' && !site?.state.busy) return record.status
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`deploy ${id} did not finish`)
}
