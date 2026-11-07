import { describe, expect, it } from 'vitest'
import { parseContainers } from './containers'
import { CONTAINERS, DISK_USAGE, IMAGES, MANIFEST_LIST, MANIFEST_SINGLE, NETWORKS, STATE_DAEMON_DOWN, STATE_GROUP, STATE_NO_ACCESS, STATS, VOLUMES } from './fixtures/output'
import { imageLabel, parseImages } from './images'
import { parseManifest } from './manifest'
import { parseDiskUsage, parseNetworks, parseStats, parseVolumes } from './resources'
import { formatSize, parseSize } from './size'
import { isDaemonReachable, parseDockerState } from './state'

describe('parseDockerState', () => {
  it('reads a docker group user with a running daemon', () => {
    const state = parseDockerState(STATE_GROUP)
    expect(state).toEqual({ installed: true, access: 'group', sudo: true, clientVersion: '27.3.1', serverVersion: '27.3.1', composeVersion: '2.29.7', serviceActive: true })
    expect(isDaemonReachable(state)).toBe(true)
  })

  it('reports no access without a server version', () => {
    const state = parseDockerState(STATE_NO_ACCESS)
    expect(state.access).toBe('none')
    expect(state.serverVersion).toBeNull()
    expect(isDaemonReachable(state)).toBe(false)
  })

  it('reports a stopped daemon', () => {
    const state = parseDockerState(STATE_DAEMON_DOWN)
    expect(state).toMatchObject({ access: 'sudo', serverVersion: null, serviceActive: false, composeVersion: '2.21.0' })
  })

  it('returns not installed on the missing marker', () => {
    expect(parseDockerState('@@missing\n').installed).toBe(false)
  })

  it('falls back to no access on an unknown access value', () => {
    expect(parseDockerState('access=weird\n').access).toBe('none')
  })
})

describe('parseContainers', () => {
  const { items, truncated } = parseContainers(CONTAINERS)

  it('parses every inspected container', () => {
    expect(items.map((container) => container.name)).toEqual(['status-app', 'status-db', 'web', 'worker'])
    expect(truncated).toBe(false)
  })

  it('reads compose labels', () => {
    expect(items[0].compose).toEqual({ project: 'status', service: 'app', workingDir: '/srv/status', configFiles: ['/srv/status/compose.yml'] })
    expect(items[2].compose).toBeNull()
  })

  it('prefers live port bindings and falls back to configured ones', () => {
    expect(items[2].ports).toEqual([
      { hostIp: '0.0.0.0', hostPort: 8080, containerPort: 80, protocol: 'tcp' },
      { hostIp: '::', hostPort: 8080, containerPort: 80, protocol: 'tcp' }
    ])
    expect(items[3].ports).toEqual([{ hostIp: '0.0.0.0', hostPort: 9000, containerPort: 9000, protocol: 'tcp' }])
    expect(items[1].ports).toEqual([])
  })

  it('reads mounts, networks, state and restart policy', () => {
    expect(items[1].mounts).toEqual([{ type: 'volume', name: 'status_pgdata', source: '/var/lib/docker/volumes/status_pgdata/_data', destination: '/var/lib/postgresql/data', readOnly: false }])
    expect(items[0].networks).toEqual(['status_default'])
    expect(items[0].health).toBe('healthy')
    expect(items[3]).toMatchObject({ status: 'exited', exitCode: 1, restartPolicy: 'unless-stopped' })
  })

  it('flags a truncated list', () => {
    expect(parseContainers(CONTAINERS.replace('count=4', 'count=250')).truncated).toBe(true)
  })

  it('returns nothing for markers', () => {
    expect(parseContainers('@@down\n').items).toEqual([])
    expect(parseContainers('@@noaccess\n').items).toEqual([])
  })
})

describe('parseImages', () => {
  const images = parseImages(IMAGES)

  it('marks used and dangling images', () => {
    expect(images.filter((image) => image.usedBy > 0).map(imageLabel)).toEqual(['acme/status-page:1.4', 'postgres:16-alpine', 'nginx:1.27', 'acme/example-app:2.0'])
    const dangling = images.find((image) => image.dangling)
    expect(dangling && imageLabel(dangling)).toBe('666666666666')
    expect(dangling?.size).toBe(512_000_000)
  })

  it('parses sizes', () => {
    expect(images.find((image) => image.repository === 'node')?.size).toBe(1_100_000_000)
  })
})

describe('resources', () => {
  it('parses volumes with dangling flags', () => {
    const volumes = parseVolumes(VOLUMES)
    expect(volumes.map((volume) => [volume.name.slice(0, 13), volume.dangling])).toEqual([['status_pgdata', false], ['0d1e2f3a4b5c6', false], ['old-data', true]])
  })

  it('parses networks', () => {
    expect(parseNetworks(NETWORKS).map((network) => [network.name, network.driver, network.internal])).toEqual([['bridge', 'bridge', false], ['host', 'host', false], ['status_default', 'bridge', true]])
  })

  it('parses system df', () => {
    expect(parseDiskUsage(DISK_USAGE)).toEqual({
      images: { total: 6, active: 4, size: 3_476_000_000, reclaimable: 1_612_000_000 },
      containers: { total: 4, active: 3, size: 48_200_000, reclaimable: 12_500 },
      volumes: { total: 3, active: 2, size: 1_750_000_000, reclaimable: 1_070_000_000 },
      buildCache: { total: 38, active: 0, size: 420_300_000, reclaimable: 420_300_000 }
    })
  })

  it('parses stats', () => {
    expect(parseStats(STATS)).toEqual([
      { name: 'status-app', cpu: '0.80%', memory: '120.4MiB' },
      { name: 'status-db', cpu: '0.31%', memory: '64.2MiB' }
    ])
  })
})

describe('sizes', () => {
  it.each([['0B', 0], ['12.5kB', 12_500], ['1.2GB', 1_200_000_000], ['64MiB', 67_108_864], ['nonsense', 0]])('parses %s', (text, bytes) => {
    expect(parseSize(text)).toBe(bytes)
  })

  it.each([[512, '512 B'], [84_200_000, '84 MB'], [3_200_000_000, '3.2 GB']])('formats %d', (bytes, text) => {
    expect(formatSize(bytes)).toBe(text)
  })
})

describe('parseManifest', () => {
  it('sums layer sizes of a single manifest', () => {
    expect(parseManifest(MANIFEST_SINGLE, '', 0)).toEqual({ found: true, size: 84_000_000, platforms: 1, message: 'found' })
  })

  it('counts real platforms of a manifest list', () => {
    expect(parseManifest(MANIFEST_LIST, '', 0)).toMatchObject({ found: true, size: null, platforms: 2 })
  })

  it('reports a missing tag', () => {
    expect(parseManifest('', 'no such manifest: docker.io/acme/api:9.9\n', 1).found).toBe(false)
  })

  it('throws on other failures', () => {
    expect(() => parseManifest('', 'Get "https://registry-1.docker.io/v2/": dial tcp: i/o timeout\n', 1)).toThrow(/timeout/)
  })
})
