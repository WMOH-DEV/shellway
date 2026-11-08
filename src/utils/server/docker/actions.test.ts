import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { cleanupAction, cleanupGroups } from './actions/cleanup'
import { composeAction } from './actions/compose'
import { containerAction } from './actions/container'
import { imagePullAction, imageRemoveAction } from './actions/image'
import { composeFile, runAction, runCommandLine, type RunParams } from './actions/run'
import { parseContainers } from './containers'
import { CONTAINERS, DISK_USAGE, IMAGES, STATE_DAEMON_DOWN, STATE_GROUP, STATE_NO_ACCESS, VOLUMES } from './fixtures/output'
import { parseImages } from './images'
import { parseDiskUsage, parseVolumes } from './resources'
import { parseDockerState } from './state'

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 0 })

function factsWith(state: string, extra: Partial<ServerFacts> = {}): ServerFacts {
  return {
    'docker.state': ok(parseDockerState(state)),
    'docker.containers': ok(parseContainers(CONTAINERS)),
    'docker.images': ok(parseImages(IMAGES)),
    'docker.volumes': ok(parseVolumes(VOLUMES)),
    'docker.df': ok(parseDiskUsage(DISK_USAGE)),
    ...extra
  }
}

const groupFacts = factsWith(STATE_GROUP)
const sudoFacts = factsWith(STATE_GROUP.replace('access=group', 'access=sudo'))

describe('docker.container', () => {
  it('restarts by name without sudo for docker group users', () => {
    const plan = containerAction.plan(containerAction.validate({ name: 'web', op: 'restart' }), groupFacts)
    expect(plan.blocked).toBeNull()
    expect(plan.steps.map((step) => [step.display, step.root])).toEqual([['docker restart web', false]])
  })

  it('runs as root when access is through sudo', () => {
    const plan = containerAction.plan({ name: 'web', op: 'stop' }, sudoFacts)
    expect(plan.steps[0].root).toBe(true)
  })

  it('stops a running container before removing it and warns', () => {
    const plan = containerAction.plan({ name: 'web', op: 'remove' }, groupFacts)
    expect(plan.steps.map((step) => step.display)).toEqual(['docker stop web', 'docker rm web'])
    expect(plan.warnings[0]).toMatch(/deletes the container/)
  })

  it('removes a stopped container directly', () => {
    expect(containerAction.plan({ name: 'worker', op: 'remove' }, groupFacts).steps.map((step) => step.display)).toEqual(['docker rm worker'])
  })

  it('blocks unknown containers and missing access', () => {
    expect(containerAction.plan({ name: 'ghost', op: 'start' }, groupFacts).blocked?.kind).toBe('precondition')
    expect(containerAction.plan({ name: 'web', op: 'start' }, factsWith(STATE_NO_ACCESS)).blocked?.kind).toBe('sudo')
    expect(containerAction.plan({ name: 'web', op: 'start' }, factsWith(STATE_DAEMON_DOWN)).blocked?.message).toMatch(/not running/)
  })

  it.each([{ name: 'web; reboot', op: 'stop' }, { name: 'web', op: 'kill' }, null])('rejects %j', (raw) => {
    expect(() => containerAction.validate(raw)).toThrow()
  })
})

describe('docker.compose', () => {
  it('pulls and recreates in the project folder', () => {
    const plan = composeAction.plan(composeAction.validate({ project: 'status', op: 'pull' }), groupFacts)
    expect(plan.steps.map((step) => step.display)).toEqual([
      'cd /srv/status && docker compose -p status -f /srv/status/compose.yml pull',
      'cd /srv/status && docker compose -p status -f /srv/status/compose.yml up -d'
    ])
    expect(plan.steps.every((step) => step.detached)).toBe(true)
  })

  it('warns before down and blocks unknown projects', () => {
    expect(composeAction.plan({ project: 'status', op: 'down' }, groupFacts).warnings[0]).toMatch(/Volumes stay/)
    expect(composeAction.plan({ project: 'other', op: 'up' }, groupFacts).blocked?.kind).toBe('precondition')
  })

  it('rejects project names with shell characters', () => {
    expect(() => composeAction.validate({ project: 'a b', op: 'up' })).toThrow()
  })
})

describe('docker images', () => {
  it('pulls a quoted reference', () => {
    const plan = imagePullAction.plan(imagePullAction.validate({ image: 'registry.example.com:5000/acme/api:2.1' }), groupFacts)
    expect(plan.steps[0]).toMatchObject({ display: 'docker pull registry.example.com:5000/acme/api:2.1', detached: true })
  })

  it('blocks removing an image a container uses', () => {
    expect(imageRemoveAction.plan({ image: 'nginx:1.27' }, groupFacts).blocked?.message).toMatch(/used by 1 container/)
    expect(imageRemoveAction.plan({ image: 'node:20' }, groupFacts).blocked).toBeNull()
  })

  it.each(['Acme/API', 'nginx:', 'nginx:1:2', 'nginx;id', '../etc'])('rejects %s', (image) => {
    expect(() => imagePullAction.validate({ image })).toThrow()
  })
})

describe('docker.cleanup', () => {
  it('lists exactly what each choice removes', () => {
    const groups = cleanupGroups(groupFacts, { containers: true, images: 'unused', volumes: true, buildCache: true })
    expect(groups.map((group) => [group.key, group.names])).toEqual([
      ['containers', ['worker']],
      ['images', ['acme/example-app:2.0', 'node:20', '666666666666']],
      ['volumes', ['0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e', 'old-data']],
      ['buildCache', []]
    ])
    expect(groups[3].bytes).toBe(420_300_000)
  })

  it('keeps images of stopped containers when containers are kept', () => {
    const [images] = cleanupGroups(groupFacts, { containers: false, images: 'unused', volumes: false, buildCache: false })
    expect(images.names).toEqual(['node:20', '666666666666'])
  })

  it('removes dangling images only by default', () => {
    const plan = cleanupAction.plan(cleanupAction.validate({ images: 'dangling' }), groupFacts)
    expect(plan.steps.map((step) => step.display)).toEqual(['docker image prune -f'])
    expect(plan.summary).toBe('Untagged (dangling) images (1), 512 MB: 666666666666')
    expect(plan.warnings).toEqual([])
  })

  it('adds -a for volumes on Docker 23+ and warns about data loss', () => {
    const plan = cleanupAction.plan({ containers: true, images: 'none', volumes: true, buildCache: true }, groupFacts)
    expect(plan.steps.map((step) => step.display)).toEqual(['docker container prune -f', 'docker volume prune -a -f', 'docker builder prune -a -f'])
    expect(plan.warnings[0]).toMatch(/deleted for good/)
  })

  it('requires at least one choice', () => {
    expect(() => cleanupAction.validate({})).toThrow(/at least one/)
  })
})

const baseRun: RunParams = {
  image: 'acme/api',
  tag: '2.1',
  name: 'acme-api',
  restart: 'unless-stopped',
  ports: [{ host: 8081, container: 8080, protocol: 'tcp', bind: '127.0.0.1' }],
  volumes: [{ source: '/srv/acme-api/data', target: '/data', readOnly: false }],
  env: [{ key: 'APP_ENV', value: 'production' }, { key: 'DATABASE_URL', value: 'postgres://app:hunter22@db/app' }],
  saveAsCompose: false
}

describe('docker.run', () => {
  it('validates and defaults the form', () => {
    const params = runAction.validate({ image: 'acme/api', name: 'acme-api', ports: [{ host: 8081, container: 8080 }] })
    expect(params).toMatchObject({ tag: 'latest', restart: 'unless-stopped', ports: [{ bind: '127.0.0.1', protocol: 'tcp' }], env: [], saveAsCompose: false })
  })

  it.each([
    [{ name: 'Acme' }, /Name/],
    [{ tag: 'bad tag' }, /Tag/],
    [{ ports: [{ host: 70000, container: 80 }] }, /Ports/],
    [{ ports: [{ host: 80, container: 80, bind: '10.0.0.1' }] }, /Bind address/],
    [{ volumes: [{ source: '/srv/../etc', target: '/data' }] }, /Volume source/],
    [{ volumes: [{ source: '/', target: '/data' }] }, /Volume source/],
    [{ env: [{ key: 'BAD-KEY', value: 'x' }] }, /not a valid variable/],
    [{ env: [{ key: 'A', value: 'two\nlines' }] }, /one line/],
    [{ env: [{ key: 'A', value: "it's" }], saveAsCompose: true }, /single quote/]
  ])('rejects %j', (override, message) => {
    expect(() => runAction.validate({ ...baseRun, ...override })).toThrow(message)
  })

  it('builds the docker run command with the env file and no secrets', () => {
    expect(runCommandLine(baseRun)).toBe('docker run -d --name acme-api --restart unless-stopped -p 127.0.0.1:8081:8080 -v /srv/acme-api/data:/data --env-file /etc/shellway/docker/acme-api.env acme/api:2.1')
  })

  it('writes the env file through the script, never the display or command line', () => {
    const plan = runAction.plan(baseRun, groupFacts)
    expect(plan.blocked).toBeNull()
    expect(plan.steps.map((step) => step.id)).toEqual(['env-file', 'pull', 'run'])
    const [envStep, , runStep] = plan.steps
    expect(envStep.root).toBe(true)
    expect(envStep.script).toContain("cat > /etc/shellway/docker/acme-api.env.tmp <<'SHELLWAY_ENV'\nAPP_ENV=production\nDATABASE_URL=postgres://app:hunter22@db/app\nSHELLWAY_ENV")
    expect(envStep.script).toContain('chmod 600')
    expect(envStep.script).toContain('chown "$SUDO_USER"')
    expect(envStep.display).toBe('write /etc/shellway/docker/acme-api.env (mode 0600)\nAPP_ENV=••••\nDATABASE_URL=••••')
    expect(plan.steps.map((step) => step.display).join('\n')).not.toContain('hunter22')
    expect(runStep.script).not.toContain('hunter22')
    expect(runStep.rollback).toContain('docker rm -f acme-api')
    expect(plan.secrets).toEqual(['production', 'postgres://app:hunter22@db/app'])
  })

  it('skips the chown when docker runs through sudo', () => {
    expect(runAction.plan(baseRun, sudoFacts).steps[0].script).not.toContain('chown')
  })

  it('warns when a port is opened to the internet', () => {
    const plan = runAction.plan({ ...baseRun, ports: [{ host: 80, container: 80, protocol: 'tcp', bind: '0.0.0.0' }] }, groupFacts)
    expect(plan.warnings[0]).toMatch(/open to the internet.*ufw/)
  })

  it('blocks name clashes and env files without sudo', () => {
    expect(runAction.plan({ ...baseRun, name: 'web' }, groupFacts).blocked?.message).toMatch(/already exists/)
    const noSudo = factsWith(STATE_GROUP.replace('sudo=yes', 'sudo=no'))
    expect(runAction.plan(baseRun, noSudo).blocked?.kind).toBe('sudo')
    expect(runAction.plan({ ...baseRun, env: [] }, noSudo).blocked).toBeNull()
  })

  it('saves a compose stack and starts it', () => {
    const params: RunParams = { ...baseRun, saveAsCompose: true, volumes: [...baseRun.volumes, { source: 'acme-cache', target: '/cache', readOnly: true }] }
    expect(composeFile(params)).toBe([
      'services:',
      '  acme-api:',
      '    image: "acme/api:2.1"',
      '    container_name: "acme-api"',
      '    restart: "unless-stopped"',
      '    ports:',
      '      - "127.0.0.1:8081:8080"',
      '    volumes:',
      '      - "/srv/acme-api/data:/data"',
      '      - "acme-cache:/cache:ro"',
      '    env_file:',
      '      - ".env"',
      'volumes:',
      '  acme-cache:',
      '    name: "acme-cache"',
      ''
    ].join('\n'))
    const plan = runAction.plan(params, groupFacts)
    expect(plan.steps.map((step) => step.id)).toEqual(['stack-files', 'up'])
    expect(plan.steps[0].script).toContain("APP_ENV='production'")
    expect(plan.steps[0].display).not.toContain('hunter22')
    expect(plan.steps[1].display).toBe('cd /opt/stacks/acme-api && docker compose up -d')
    expect(plan.steps[1].rollback).toContain('docker compose down')
  })
})
