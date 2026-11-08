import { spawn, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CreateSiteInput, CreateSiteSecrets, RunRecord } from '../../src/types/createSite'
import { siteDatabase } from '../../src/utils/createSite/database'
import { buildPlan } from '../../src/utils/createSite/plan'
import { laravelScaffoldScript } from '../../src/utils/createSite/scaffold'
import { PROJECT_SHELL } from '../../src/utils/createSite/siteScripts'
import { NGINX, baseInput } from '../../src/utils/createSite/testFixtures'
import type { RemoteExec } from '../services/deploy/DeployService'
import { CreateSiteRun, newRunRecord } from '../services/createSite/CreateSiteRun'
import type { CreateSitePorts } from '../services/createSite/ports'
import { readArchive } from '../services/createSite/projectArchive'
import { removeCreated } from '../services/createSite/removeRun'
import { TOOLS_SCRIPT, parseTools } from '../services/createSite/serverTools'
import { ExecTimeoutError, type ExecResult } from '../utils/sshExec'

const DOCKER = process.env.SHELLWAY_DOCKER_BIN ?? 'docker'
const ENABLED = process.env.SHELLWAY_DOCKER_IT === '1'
const BOX = process.env.SHELLWAY_IT_CREATE_SITE_SERVER ?? 'shellway-it-ubuntu'
const SECRETS: CreateSiteSecrets = { dbPassword: 'Pw7kQ2mZx9RtLb4NcV8sHj3D', appKey: `base64:${'A'.repeat(42)}Q=`, envText: 'MAIL_MAILER=log\n' }
const LONG_MS = 15 * 60_000

const exec: RemoteExec = (command, options = {}) => new Promise<ExecResult>((resolve, reject) => {
  const child = spawn(DOCKER, ['exec', '-i', '-u', 'deploy', '-w', '/home/deploy', '-e', 'HOME=/home/deploy', '-e', 'USER=deploy', BOX, 'sh', '-c', command])
  const out: Buffer[] = []
  const err: Buffer[] = []
  const timeoutMs = options.timeoutMs ?? 30_000
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new ExecTimeoutError(`Command timed out after ${timeoutMs}ms`)) }, timeoutMs)
  child.stdout.on('data', (chunk: Buffer) => { out.push(chunk); options.onOutput?.(chunk.toString('utf8')) })
  child.stderr.on('data', (chunk: Buffer) => { err.push(chunk); (options.onStderr ?? options.onOutput)?.(chunk.toString('utf8')) })
  child.on('error', reject)
  child.on('close', (code) => {
    clearTimeout(timer)
    const stdout = Buffer.concat(out).toString('utf8')
    resolve({ stdout, stdoutBytes: Buffer.byteLength(stdout), stderr: Buffer.concat(err).toString('utf8'), code: code ?? -1 })
  })
  child.stdin.end(typeof options.stdin === 'string' ? options.stdin : '')
})

const asRoot = (script: string): string => spawnSync(DOCKER, ['exec', '-i', '-u', 'root', BOX, 'sh', '-s'], { input: script, encoding: 'utf8' }).stdout

const TEST_SITES = ['itlaravel', 'itplaceholder', 'itspa']

const clearTestSites = (): void => {
  asRoot(TEST_SITES.map((name) => `systemctl disable --now shellway-${name}-queue.service 2>/dev/null
rm -rf /var/www/${name} /var/www/${name}-deploy /etc/php/8.3/fpm/pool.d/${name}.conf /etc/nginx/sites-available/${name}.conf /etc/nginx/sites-enabled/${name}.conf /etc/cron.d/shellway-${name} /etc/systemd/system/shellway-${name}-queue.service
`).join('') + 'systemctl daemon-reload\nnginx -s reload\nkill -USR2 "$(cat /run/php/php8.3-fpm.pid)"\n')
}

const fetchSite = (domain: string): string => asRoot(`curl -s -H 'Host: ${domain}' http://127.0.0.1/\n`)

const FAKE_RELEASE = (folder: string) => `set -e
root=${folder}-deploy
mkdir -p "$root/releases/1/public"
cat > "$root/releases/1/public/index.php" <<'PHP'
<?php echo 'php ' . PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION . ' as ' . posix_getpwuid(posix_geteuid())['name'] . ' in ' . __DIR__;
PHP
cat > "$root/releases/1/artisan" <<'PHP'
<?php if (($argv[1] ?? '') === 'queue:work') { sleep(3600); } echo "ok\\n";
PHP
ln -sfn "$root/releases/1" "$root/current"
`

function ports(log: string[], input: CreateSiteInput): CreateSitePorts {
  return {
    exec,
    dns: null,
    deploy: {
      ensureRunner: async () => {},
      siteNames: async () => [],
      save: async () => {},
      remove: async () => {},
      keygen: async () => 'ssh-ed25519 AAAAexample shellway',
      repoError: async () => null,
      writeEnv: async (_name, content) => {
        const result = await exec(`cat > '${input.folder}-deploy/shared/.env'`, { stdin: content })
        if (result.code !== 0) throw new Error(result.stderr)
      },
      deployAndWait: async () => {
        const result = await exec('sh -s', { stdin: FAKE_RELEASE(input.folder) })
        if (result.code !== 0) throw new Error(result.stderr)
        return { id: 'd1', status: 'success', trigger: 'manual', commit: 'abc', started: 1, finished: 2, warnings: 0, note: '', subject: '' }
      }
    },
    project: {} as CreateSitePorts['project'],
    tools: async () => parseTools((await exec('sh -s', { stdin: TOOLS_SCRIPT })).stdout, []),
    siteBlockId: async () => 'block-1',
    issue: async () => ({ ok: true, failedStage: null, restored: false, backupPath: null, lineage: 'not-issued-by-this-run', output: '', hint: null }),
    resolves: async () => true,
    save: () => {},
    output: (chunk) => { log.push(chunk) },
    now: () => Date.now()
  }
}

async function createSite(overrides: Partial<CreateSiteInput>, secrets: CreateSiteSecrets | null): Promise<{ record: RunRecord; log: string[]; sitePorts: CreateSitePorts }> {
  const input = baseInput({ dns: { zoneId: null, zoneName: null, serverIp: '203.0.113.10', proxied: false }, https: { email: 'admin@example.com', redirect: false, staging: true }, ...overrides })
  const log: string[] = []
  const sitePorts = ports(log, input)
  const plan = buildPlan(input, await sitePorts.tools(), NGINX.driver)
  const record = await new CreateSiteRun(newRunRecord(`it-${input.siteName}`, 'it-session', input, plan, Date.now()), sitePorts, NGINX.driver, secrets).run('start')
  return { record, log, sitePorts }
}

const failure = (record: RunRecord, log: string[]): string => `${record.error}\n${log.join('').slice(-4000)}`

describe.skipIf(!ENABLED)('Create site on a Docker server', () => {
  beforeAll(clearTestSites)
  afterAll(clearTestSites)

  it('makes a Laravel site with its own PHP pool, a MySQL database, an env file and the queue worker, then removes them', async () => {
    const site = { domain: 'itlaravel.example.com', siteName: 'itlaravel', folder: '/var/www/itlaravel' }
    const { record, log, sitePorts } = await createSite({ ...site, database: siteDatabase('mysql', site), jobs: { scheduler: true, queueWorker: true } }, SECRETS)
    expect(record.phase, failure(record, log)).toBe('done')

    expect(fetchSite(site.domain)).toBe('php 8.3 as deploy in /var/www/itlaravel-deploy/releases/1/public')
    expect(asRoot(`mysql -u itlaravel -p'${SECRETS.dbPassword}' -h localhost itlaravel -N -e 'select 42'\n`).trim()).toBe('42')
    const env = asRoot('cat /var/www/itlaravel-deploy/shared/.env\n')
    expect(env).toContain('MAIL_MAILER=log\n')
    expect(env).toContain('DB_DATABASE=itlaravel\n')
    expect(asRoot('stat -c %a /var/www/itlaravel-deploy/shared/.env\n').trim()).toBe('600')
    expect(asRoot('cat /etc/cron.d/shellway-itlaravel\n')).toContain('artisan schedule:run')
    expect(asRoot('systemctl is-active shellway-itlaravel-queue.service\n').trim()).toBe('active')

    const removed = await removeCreated(record, sitePorts, NGINX.driver)
    expect(removed.phase).toBe('remove-failed')
    expect(removed.error).toContain('/var/www/itlaravel')
    expect(asRoot('ls /etc/php/8.3/fpm/pool.d/itlaravel.conf /etc/nginx/sites-available/itlaravel.conf /etc/cron.d/shellway-itlaravel /etc/systemd/system/shellway-itlaravel-queue.service /var/www/itlaravel-deploy/shared/.env 2>/dev/null; echo end\n').trim()).toBe('end')
    expect(asRoot("mysql -N -e \"select count(*) from mysql.user where user = 'itlaravel'\"\n").trim()).toBe('0')
    expect(asRoot('systemctl is-active php8.3-fpm nginx\n').trim()).toBe('active\nactive')
  }, LONG_MS)

  it('makes a site with no code yet that serves its placeholder page, then removes it', async () => {
    const site = { domain: 'itplaceholder.example.com', siteName: 'itplaceholder', folder: '/var/www/itplaceholder' }
    const { record, log, sitePorts } = await createSite({ ...site, codeSource: 'none', template: 'static', database: null, env: false, buildSteps: [], activateSteps: [] }, { dbPassword: null, appKey: null, envText: '' })
    expect(record.phase, failure(record, log)).toBe('done')
    expect(fetchSite(site.domain)).toContain('This site is ready. Put its files in /var/www/itplaceholder on the server.')
    const removed = await removeCreated(record, sitePorts, NGINX.driver)
    expect(removed.phase, removed.error ?? '').toBe('removed')
    expect(asRoot('ls -d /var/www/itplaceholder /etc/nginx/sites-available/itplaceholder.conf 2>/dev/null; echo end\n').trim()).toBe('end')
  }, LONG_MS)

  it('serves a single-page app from its build output, falling back to index.html', async () => {
    const site = { domain: 'itspa.example.com', siteName: 'itspa', folder: '/var/www/itspa' }
    const { record, log, sitePorts } = await createSite({ ...site, template: 'static', buildOutput: 'dist', spa: true, database: null, env: false, buildSteps: [], activateSteps: [] }, { dbPassword: null, appKey: null, envText: '' })
    expect(record.phase, failure(record, log)).toBe('done')
    asRoot('set -e\nmkdir -p /var/www/itspa-deploy/releases/1/dist\necho app-shell > /var/www/itspa-deploy/releases/1/dist/index.html\nchown -R deploy: /var/www/itspa-deploy/releases\n')
    expect(asRoot("curl -s -H 'Host: itspa.example.com' http://127.0.0.1/some/client/route\n").trim()).toBe('app-shell')
    await removeCreated(record, sitePorts, NGINX.driver)
  }, LONG_MS)

  it('makes a new Laravel project on the server as the login user and sends it back as a safe archive', async () => {
    const script = laravelScaffoldScript({ phpVersion: '8.3', server: { kind: 'nginx' } })
    const result = await exec(PROJECT_SHELL, { stdin: script, timeoutMs: LONG_MS, maxOutputBytes: 64 * 1024 * 1024 })
    expect(result.code, result.stderr.slice(-4000)).toBe(0)
    const paths = readArchive(Buffer.from(result.stdout, 'base64')).map((entry) => entry.path)
    expect(paths).toEqual(expect.arrayContaining(['artisan', 'composer.json', 'composer.lock', '.env.example', 'public/index.php']))
    expect(paths.some((path) => path.startsWith('vendor/') || path === '.env')).toBe(false)
    expect(asRoot('ls -d /home/deploy/.shellway-new-* 2>/dev/null; echo end\n').trim()).toBe('end')
  }, LONG_MS)
})
