import { spawn, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CreateSiteInput, CreateSiteSecrets } from '../../src/types/createSite'
import { siteDatabase } from '../../src/utils/createSite/database'
import { deploySiteConfig } from '../../src/utils/createSite/deploySite'
import { buildPlan } from '../../src/utils/createSite/plan'
import { PROJECT_SHELL, folderScript } from '../../src/utils/createSite/siteScripts'
import { NGINX, baseInput } from '../../src/utils/createSite/testFixtures'
import { parseSiteEnvs, siteEnvProbe } from '../../src/utils/server/databases/siteEnv'
import { CreateSiteRun, newRunRecord } from '../services/createSite/CreateSiteRun'
import type { CreateSitePorts } from '../services/createSite/ports'
import { deleteSite } from '../services/createSite/removeRun'
import { TOOLS_SCRIPT, parseTools } from '../services/createSite/serverTools'
import { DeployCoordinator } from '../services/deploy/DeployCoordinator'
import type { RemoteExec } from '../services/deploy/DeployService'
import { LocalGit } from '../services/deploy/LocalGit'
import { asSiteUser, readSiteUsers } from '../services/deploy/siteUser'
import { makeSite } from '../services/deploy/testFixtures'
import type { ExecResult } from '../utils/sshExec'

const DOCKER = process.env.SHELLWAY_DOCKER_BIN ?? 'docker'
const ENABLED = process.env.SHELLWAY_DOCKER_IT === '1'
const BOX = process.env.SHELLWAY_IT_CREATE_SITE_SERVER ?? 'shellway-it-ubuntu'
const USER = 'itsiteuser'
const SITE = { domain: 'itsiteuser.example.com', siteName: 'itsiteuser', folder: '/var/www/itsiteuser' }
const SECRETS: CreateSiteSecrets = { dbPassword: 'Pw7kQ2mZx9RtLb4NcV8sHj3D', appKey: `base64:${'A'.repeat(42)}Q=`, envText: '' }
const LONG_MS = 15 * 60_000

const dockerExec = (user: string, home: string): RemoteExec => (command, options = {}) => new Promise<ExecResult>((resolve, reject) => {
  const child = spawn(DOCKER, ['exec', '-i', '-u', user, '-w', home, '-e', `HOME=${home}`, '-e', `USER=${user}`, BOX, 'sh', '-c', command])
  const out: Buffer[] = []
  const err: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => { out.push(chunk); options.onOutput?.(chunk.toString('utf8')) })
  child.stderr.on('data', (chunk: Buffer) => { err.push(chunk); (options.onStderr ?? options.onOutput)?.(chunk.toString('utf8')) })
  child.on('error', reject)
  child.on('close', (code) => {
    const stdout = Buffer.concat(out).toString('utf8')
    resolve({ stdout, stdoutBytes: Buffer.byteLength(stdout), stderr: Buffer.concat(err).toString('utf8'), code: code ?? -1 })
  })
  child.stdin.end(typeof options.stdin === 'string' ? options.stdin : '')
})

const rootExec = dockerExec('root', '/root')
const siteExec = asSiteUser(rootExec, USER)
const asRoot = (script: string): string => spawnSync(DOCKER, ['exec', '-i', '-u', 'root', BOX, 'sh', '-s'], { input: script, encoding: 'utf8' }).stdout

const cleanUp = (): void => {
  asRoot(`systemctl disable --now shellway-${USER}-queue.service 2>/dev/null
mysql -e 'DROP DATABASE IF EXISTS ${USER}; DROP USER IF EXISTS ${USER}@localhost;'
rm -rf /srv/itsiteuser-repo.git /srv/itsiteuser-work /var/www/itplainsite /var/www/itplainsite-deploy /home/plain/.shellway-deploy
crontab -r -u plain 2>/dev/null
rm -rf ${SITE.folder} ${SITE.folder}-deploy /etc/php/8.3/fpm/pool.d/${USER}.conf /etc/nginx/sites-available/${USER}.conf /etc/nginx/sites-enabled/${USER}.conf /etc/cron.d/shellway-${USER} /etc/systemd/system/shellway-${USER}-queue.service
crontab -r -u ${USER} 2>/dev/null
userdel -r ${USER} 2>/dev/null
systemctl daemon-reload
nginx -s reload
kill -USR2 "$(cat /run/php/php8.3-fpm.pid)"
`)
}

const FAKE_RELEASE = `set -e
root=${SITE.folder}-deploy
mkdir -p "$root/releases/1/public"
cat > "$root/releases/1/public/index.php" <<'PHP'
<?php echo 'php as ' . posix_getpwuid(posix_geteuid())['name'];
PHP
cat > "$root/releases/1/artisan" <<'PHP'
<?php if (($argv[1] ?? '') === 'queue:work') { sleep(3600); } echo "ok\\n";
PHP
ln -sfn "$root/releases/1" "$root/current"
`

const coordinator = new DeployCoordinator({
  execFor: () => rootExec,
  local: { usesDeploy: () => true, markUsesDeploy: vi.fn(), lastSeen: () => 0, setLastSeen: vi.fn() },
  git: new LocalGit('/tmp/shellway-it-pc-cache'),
  notify: vi.fn(),
  broadcast: vi.fn()
})

function ports(log: string[], input: CreateSiteInput): CreateSitePorts {
  const deploy = () => coordinator.service('c1', USER)
  return {
    exec: (command, options) => (command === PROJECT_SHELL ? siteExec : rootExec)(command, options),
    dns: null,
    deploy: {
      ensureRunner: () => deploy().installRunner(),
      siteNames: () => coordinator.siteNames('c1'),
      save: (config) => deploy().saveSite(config),
      remove: (name) => deploy().removeSite(name),
      keygen: async () => 'ssh-ed25519 AAAAexample shellway',
      repoError: async () => null,
      writeEnv: (name, content) => deploy().writeEnv(name, content),
      deployAndWait: async () => {
        const result = await siteExec('sh -s', { stdin: FAKE_RELEASE })
        if (result.code !== 0) throw new Error(result.stderr)
        return { id: 'd1', status: 'success', trigger: 'manual', commit: 'abc', started: 1, finished: 2, warnings: 0, note: '', subject: '' }
      }
    },
    project: {} as CreateSitePorts['project'],
    tools: async () => parseTools((await rootExec('sh -s', { stdin: TOOLS_SCRIPT })).stdout, []),
    siteBlockId: async () => 'block-1',
    issue: async () => ({ ok: true, failedStage: null, restored: false, backupPath: null, lineage: 'not-issued-by-this-run', output: '', hint: null }),
    resolves: async () => true,
    save: () => {},
    output: (chunk) => { log.push(chunk) },
    now: () => Date.now()
  }
}

describe.skipIf(!ENABLED)('Site user when logged in as root, on a Docker server', () => {
  beforeAll(cleanUp)
  afterAll(cleanUp)

  it('lists the regular users only to root', async () => {
    const users = await readSiteUsers(rootExec)
    expect(users?.map((user) => user.name)).toEqual(expect.arrayContaining(['deploy', 'plain']))
    expect(await readSiteUsers(dockerExec('deploy', '/home/deploy'))).toBeNull()
  })

  it('runs commands as the site user from their home folder', async () => {
    const result = await asSiteUser(rootExec, 'plain')('id -un; pwd; cat')
    expect(result.stdout).toBe('plain\n/home/plain\n')
    expect((await asSiteUser(rootExec, 'plain')('cat', { stdin: 'kept' })).stdout).toBe('kept')
  })

  it('creates a Laravel site for a new user: the user, pool, env file, jobs and Deploy site all belong to it, and root can delete it', async () => {
    const input = baseInput({
      ...SITE,
      owner: USER,
      createOwner: true,
      database: siteDatabase('mysql', SITE),
      jobs: { scheduler: true, queueWorker: true },
      dns: { zoneId: null, zoneName: null, serverIp: '203.0.113.10', proxied: false },
      https: { email: 'admin@example.com', redirect: false, staging: true }
    })
    const log: string[] = []
    const sitePorts = ports(log, input)
    const plan = buildPlan(input, await sitePorts.tools(), NGINX.driver)
    expect(plan[0].id).toBe('user')
    const record = await new CreateSiteRun(newRunRecord('it-siteuser', 'it-session', input, plan, Date.now()), sitePorts, NGINX.driver, SECRETS).run('start')
    expect(record.phase, `${record.error}\n${log.join('').slice(-4000)}`).toBe('done')

    expect(asRoot(`id -un ${USER}\n`).trim()).toBe(USER)
    expect(asRoot(`curl -s -H 'Host: ${SITE.domain}' http://127.0.0.1/\n`)).toBe(`php as ${USER}`)
    expect(asRoot(`stat -c '%U %a' ${SITE.folder}-deploy/shared/.env\n`).trim()).toBe(`${USER} 600`)
    expect(asRoot(`cat /etc/cron.d/shellway-${USER}\n`)).toContain(` ${USER} cd `)
    expect(asRoot(`systemctl show -p User --value shellway-${USER}-queue.service\n`).trim()).toBe(USER)
    expect(asRoot(`ls /home/${USER}/.shellway-deploy/sites/\n`).trim()).toBe(SITE.siteName)

    const [listed] = (await coordinator.list('c1', 's1')).filter((site) => site.config.name === SITE.siteName)
    expect(listed).toMatchObject({ user: USER, config: deploySiteConfig(input) })
    expect(await coordinator.runnerInfo('c1')).toMatchObject({ installed: true })
    const envs = parseSiteEnvs((await rootExec('sh -s', { stdin: siteEnvProbe.script })).stdout)
    expect(envs.sites.find((site) => site.site === SITE.siteName)).toMatchObject({ owner: `${USER}:${USER}`, db: { database: USER } })

    const deleted = await deleteSite(record, sitePorts, NGINX.driver)
    expect(deleted.phase, `${deleted.error}\n${log.join('').slice(-4000)}`).toBe('removed')
    expect(asRoot(`ls -A /home/${USER}/.shellway-deploy/sites/; ls /etc/php/8.3/fpm/pool.d/${USER}.conf /etc/cron.d/shellway-${USER} 2>/dev/null; echo end\n`).trim()).toBe('end')
    expect(asRoot(`id -un ${USER}\n`).trim()).toBe(USER)
  }, LONG_MS)

  it('starts a real deploy from root that runs as the site user', async () => {
    asRoot(`set -e
git init -q --bare -b main /srv/itsiteuser-repo.git
git init -q -b main /srv/itsiteuser-work
cd /srv/itsiteuser-work
echo deployed > index.html
git -c user.name=T -c user.email=t@t add -A
git -c user.name=T -c user.email=t@t commit -q -m v1
git push -q /srv/itsiteuser-repo.git main
chown -R plain: /srv/itsiteuser-repo.git
`)
    asRoot(folderScript('/var/www/itplainsite', 'plain'))
    const plain = coordinator.service('c1', 'plain')
    await plain.installRunner()
    await plain.saveSite(makeSite({ name: 'itplainsite', path: '/var/www/itplainsite', repoUrl: '/srv/itsiteuser-repo.git', sharedPaths: [], healthUrl: '', buildSteps: [], activateSteps: [], sourceMode: 'auto' }))
    const id = await coordinator.deploy('c1', 'itplainsite')
    await vi.waitFor(async () => {
      const record = (await coordinator.service('c1', 'plain').history('itplainsite')).find((r) => r.id === id)
      expect(record?.status).not.toBe('running')
      expect(record, (await coordinator.service('c1', 'plain').readLog('itplainsite', id, 0)).text).toMatchObject({ status: 'success' })
    }, { timeout: 120_000, interval: 1_000 })
    expect(asRoot('cat /var/www/itplainsite/index.html; stat -c %U /var/www/itplainsite-deploy/current/index.html\n').trim()).toBe('deployed\nplain')
    await (await coordinator.siteService('c1', 'itplainsite')).removeSite('itplainsite')
  }, LONG_MS)
})

