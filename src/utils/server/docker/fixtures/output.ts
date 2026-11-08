export const STATE_GROUP = `access=group
sudo=yes
active=active
client=27.3.1
server=27.3.1
compose=v2.29.7
`

export const STATE_NO_ACCESS = `access=none
sudo=no
active=active
client=27.3.1
`

export const STATE_DAEMON_DOWN = `access=sudo
sudo=yes
active=inactive
client=24.0.7
server=
compose=2.21.0
`

export const CONTAINERS = [
  'count=4',
  '{"id":"4f1c2a9e8b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e","name":"/status-app","image":"acme/status-page:1.4","imageId":"sha256:1111111111111111111111111111111111111111111111111111111111111111","created":"2026-10-01T10:00:00.000000000Z","status":"running","exitCode":0,"oomKilled":false,"startedAt":"2026-10-12T08:00:00.000000000Z","finishedAt":"0001-01-01T00:00:00Z","health":"healthy","restart":"unless-stopped","bindings":{"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"3001"}]},"ports":{"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"3001"}]},"networks":["status_default",null],"mounts":[{"Type":"bind","Source":"/srv/status/data","Destination":"/app/data","Mode":"","RW":true,"Propagation":"rprivate"}],"project":"status","service":"app","workingDir":"/srv/status","configFiles":"/srv/status/compose.yml"}',
  '{"id":"5a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b","name":"/status-db","image":"postgres:16-alpine","imageId":"sha256:2222222222222222222222222222222222222222222222222222222222222222","created":"2026-10-01T10:00:00.000000000Z","status":"running","exitCode":0,"oomKilled":false,"startedAt":"2026-10-12T08:00:00.000000000Z","finishedAt":"0001-01-01T00:00:00Z","health":null,"restart":"unless-stopped","bindings":{},"ports":{"5432/tcp":null},"networks":["status_default",null],"mounts":[{"Type":"volume","Name":"status_pgdata","Source":"/var/lib/docker/volumes/status_pgdata/_data","Destination":"/var/lib/postgresql/data","Driver":"local","Mode":"z","RW":true,"Propagation":""}],"project":"status","service":"db","workingDir":"/srv/status","configFiles":"/srv/status/compose.yml"}',
  '{"id":"6b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c","name":"/web","image":"nginx:1.27","imageId":"sha256:3333333333333333333333333333333333333333333333333333333333333333","created":"2026-09-20T09:00:00.000000000Z","status":"running","exitCode":0,"oomKilled":false,"startedAt":"2026-10-12T08:00:00.000000000Z","finishedAt":"0001-01-01T00:00:00Z","health":null,"restart":"always","bindings":{"80/tcp":[{"HostIp":"","HostPort":"8080"}]},"ports":{"80/tcp":[{"HostIp":"0.0.0.0","HostPort":"8080"},{"HostIp":"::","HostPort":"8080"}]},"networks":["bridge",null],"mounts":[],"project":"","service":"","workingDir":"","configFiles":""}',
  '{"id":"7c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d","name":"/worker","image":"acme/example-app:2.0","imageId":"sha256:4444444444444444444444444444444444444444444444444444444444444444","created":"2026-09-20T09:00:00.000000000Z","status":"exited","exitCode":1,"oomKilled":false,"startedAt":"2026-11-01T08:00:00.000000000Z","finishedAt":"2026-11-01T08:00:03.000000000Z","health":null,"restart":"unless-stopped","bindings":{"9000/tcp":[{"HostIp":"0.0.0.0","HostPort":"9000"}]},"ports":{},"networks":[null],"mounts":[{"Type":"volume","Name":"0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e","Source":"/var/lib/docker/volumes/0d1e/_data","Destination":"/cache","Driver":"local","Mode":"","RW":true,"Propagation":""}],"project":"","service":"","workingDir":"","configFiles":""}',
  ''
].join('\n')

export const IMAGES = [
  '{"Containers":"N/A","CreatedAt":"2026-10-01 09:00:00 +0000 UTC","CreatedSince":"5 weeks ago","Digest":"<none>","ID":"sha256:1111111111111111111111111111111111111111111111111111111111111111","Repository":"acme/status-page","SharedSize":"N/A","Size":"184MB","Tag":"1.4","UniqueSize":"N/A","VirtualSize":"184.2MB"}',
  '{"Containers":"N/A","CreatedAt":"2026-09-15 09:00:00 +0000 UTC","CreatedSince":"7 weeks ago","Digest":"<none>","ID":"sha256:2222222222222222222222222222222222222222222222222222222222222222","Repository":"postgres","SharedSize":"N/A","Size":"276MB","Tag":"16-alpine","UniqueSize":"N/A","VirtualSize":"276MB"}',
  '{"Containers":"N/A","CreatedAt":"2026-09-01 09:00:00 +0000 UTC","CreatedSince":"2 months ago","Digest":"<none>","ID":"sha256:3333333333333333333333333333333333333333333333333333333333333333","Repository":"nginx","SharedSize":"N/A","Size":"192MB","Tag":"1.27","UniqueSize":"N/A","VirtualSize":"192MB"}',
  '{"Containers":"N/A","CreatedAt":"2026-09-01 09:00:00 +0000 UTC","CreatedSince":"2 months ago","Digest":"<none>","ID":"sha256:4444444444444444444444444444444444444444444444444444444444444444","Repository":"acme/example-app","SharedSize":"N/A","Size":"1.2GB","Tag":"2.0","UniqueSize":"N/A","VirtualSize":"1.2GB"}',
  '{"Containers":"N/A","CreatedAt":"2026-08-01 09:00:00 +0000 UTC","CreatedSince":"3 months ago","Digest":"<none>","ID":"sha256:5555555555555555555555555555555555555555555555555555555555555555","Repository":"node","SharedSize":"N/A","Size":"1.1GB","Tag":"20","UniqueSize":"N/A","VirtualSize":"1.1GB"}',
  '{"Containers":"N/A","CreatedAt":"2026-08-01 09:00:00 +0000 UTC","CreatedSince":"3 months ago","Digest":"<none>","ID":"sha256:6666666666666666666666666666666666666666666666666666666666666666","Repository":"<none>","SharedSize":"N/A","Size":"512MB","Tag":"<none>","UniqueSize":"N/A","VirtualSize":"512MB"}',
  '@@section used',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  'sha256:4444444444444444444444444444444444444444444444444444444444444444',
  ''
].join('\n')

export const VOLUMES = [
  '{"Availability":"N/A","Driver":"local","Group":"N/A","Labels":"com.docker.compose.project=status,com.docker.compose.volume=pgdata","Links":"N/A","Mountpoint":"/var/lib/docker/volumes/status_pgdata/_data","Name":"status_pgdata","Scope":"local","Size":"N/A","Status":"N/A"}',
  '{"Availability":"N/A","Driver":"local","Group":"N/A","Labels":"","Links":"N/A","Mountpoint":"/var/lib/docker/volumes/0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e/_data","Name":"0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e","Scope":"local","Size":"N/A","Status":"N/A"}',
  '{"Availability":"N/A","Driver":"local","Group":"N/A","Labels":"","Links":"N/A","Mountpoint":"/var/lib/docker/volumes/old-data/_data","Name":"old-data","Scope":"local","Size":"N/A","Status":"N/A"}',
  '@@section dangling',
  'old-data',
  ''
].join('\n')

export const NETWORKS = [
  '{"CreatedAt":"2026-09-01 09:00:00.000000000 +0000 UTC","Driver":"bridge","ID":"a1b2c3d4e5f6","IPv4":"true","IPv6":"false","Internal":"false","Labels":"","Name":"bridge","Scope":"local"}',
  '{"CreatedAt":"2026-09-01 09:00:00.000000000 +0000 UTC","Driver":"host","ID":"b2c3d4e5f6a1","IPv4":"true","IPv6":"false","Internal":"false","Labels":"","Name":"host","Scope":"local"}',
  '{"CreatedAt":"2026-10-01 10:00:00.000000000 +0000 UTC","Driver":"bridge","ID":"c3d4e5f6a1b2","IPv4":"true","IPv6":"false","Internal":"true","Labels":"com.docker.compose.network=default,com.docker.compose.project=status","Name":"status_default","Scope":"local"}',
  ''
].join('\n')

export const DISK_USAGE = [
  '{"Active":"4","Reclaimable":"1.612GB (46%)","Size":"3.476GB","TotalCount":"6","Type":"Images"}',
  '{"Active":"3","Reclaimable":"12.5kB (0%)","Size":"48.2MB","TotalCount":"4","Type":"Containers"}',
  '{"Active":"2","Reclaimable":"1.07GB (61%)","Size":"1.75GB","TotalCount":"3","Type":"Local Volumes"}',
  '{"Active":"0","Reclaimable":"420.3MB","Size":"420.3MB","TotalCount":"38","Type":"Build Cache"}',
  ''
].join('\n')

export const STATS = [
  '{"BlockIO":"12.3MB / 0B","CPUPerc":"0.80%","Container":"4f1c2a9e8b7d","ID":"4f1c2a9e8b7d","MemPerc":"1.47%","MemUsage":"120.4MiB / 7.773GiB","Name":"status-app","NetIO":"1.2MB / 3.4MB","PIDs":"11"}',
  '{"BlockIO":"40MB / 12MB","CPUPerc":"0.31%","Container":"5a2b3c4d5e6f","ID":"5a2b3c4d5e6f","MemPerc":"0.81%","MemUsage":"64.2MiB / 7.773GiB","Name":"status-db","NetIO":"3.4MB / 1.2MB","PIDs":"8"}',
  ''
].join('\n')

export const MANIFEST_SINGLE = JSON.stringify({
  schemaVersion: 2,
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  config: { mediaType: 'application/vnd.docker.container.image.v1+json', size: 7023, digest: 'sha256:aaaa' },
  layers: [
    { mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: 31_000_000, digest: 'sha256:bbbb' },
    { mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: 53_000_000, digest: 'sha256:cccc' }
  ]
})

export const MANIFEST_LIST = JSON.stringify({
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.index.v1+json',
  manifests: [
    { mediaType: 'application/vnd.oci.image.manifest.v1+json', size: 1234, digest: 'sha256:dddd', platform: { architecture: 'amd64', os: 'linux' } },
    { mediaType: 'application/vnd.oci.image.manifest.v1+json', size: 1234, digest: 'sha256:eeee', platform: { architecture: 'arm64', os: 'linux' } },
    { mediaType: 'application/vnd.oci.image.manifest.v1+json', size: 566, digest: 'sha256:ffff', platform: { architecture: 'unknown', os: 'unknown' } }
  ]
})
