import { DOWN_MARKER, listProbeScript, parseJsonLines, str } from './shell'
import type { ComposeLabels, DockerContainer, DockerList, DockerMount, PortBinding } from './types'

export const CONTAINER_LIMIT = 200

const label = (key: string): string => `{{json (index .Config.Labels "${key}")}}`

export const INSPECT_TEMPLATE = [
  '{"id":{{json .Id}}',
  '"name":{{json .Name}}',
  '"image":{{json .Config.Image}}',
  '"imageId":{{json .Image}}',
  '"created":{{json .Created}}',
  '"status":{{json .State.Status}}',
  '"exitCode":{{json .State.ExitCode}}',
  '"oomKilled":{{json .State.OOMKilled}}',
  '"startedAt":{{json .State.StartedAt}}',
  '"finishedAt":{{json .State.FinishedAt}}',
  '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}',
  '"restart":{{json .HostConfig.RestartPolicy.Name}}',
  '"bindings":{{json .HostConfig.PortBindings}}',
  '"ports":{{json .NetworkSettings.Ports}}',
  '"networks":[{{range $key, $value := .NetworkSettings.Networks}}{{json $key}},{{end}}null]',
  '"mounts":{{json .Mounts}}',
  `"project":${label('com.docker.compose.project')}`,
  `"service":${label('com.docker.compose.service')}`,
  `"workingDir":${label('com.docker.compose.project.working_dir')}`,
  `"configFiles":${label('com.docker.compose.project.config_files')}}`
].join(',')

export const CONTAINERS_SCRIPT = listProbeScript([
  `ids=$($D ps -aq --no-trunc 2>/dev/null) || { echo ${DOWN_MARKER}; exit 0; }`,
  'echo "count=$(printf "%s\\n" "$ids" | grep -c .)"',
  `[ -z "$ids" ] || printf '%s\\n' "$ids" | head -n ${CONTAINER_LIMIT} | xargs $D inspect --format '${INSPECT_TEMPLATE}'`
].join('\n'))

type Json = Record<string, unknown>

const asRecord = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {})

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

function bindingsOf(map: unknown): PortBinding[] {
  return Object.entries(asRecord(map)).flatMap(([key, hosts]) => {
    const [port, protocol = 'tcp'] = key.split('/')
    return asArray(hosts).map((host) => {
      const entry = asRecord(host)
      return { hostIp: str(entry.HostIp), hostPort: Number(str(entry.HostPort)) || 0, containerPort: Number(port) || 0, protocol }
    })
  })
}

function portsOf(raw: Json): PortBinding[] {
  const live = bindingsOf(raw.ports)
  return live.length > 0 ? live : bindingsOf(raw.bindings)
}

function mountsOf(raw: unknown): DockerMount[] {
  return asArray(raw).map((item) => {
    const mount = asRecord(item)
    return {
      type: str(mount.Type),
      name: str(mount.Name) || null,
      source: str(mount.Source),
      destination: str(mount.Destination),
      readOnly: mount.RW === false
    }
  })
}

function composeOf(raw: Json): ComposeLabels | null {
  const project = str(raw.project)
  if (!project) return null
  return {
    project,
    service: str(raw.service),
    workingDir: str(raw.workingDir),
    configFiles: str(raw.configFiles).split(',').map((file) => file.trim()).filter(Boolean)
  }
}

function toContainer(raw: Json): DockerContainer {
  return {
    id: str(raw.id),
    name: str(raw.name).replace(/^\//, ''),
    image: str(raw.image),
    imageId: str(raw.imageId),
    createdAt: str(raw.created),
    status: str(raw.status),
    exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : 0,
    oomKilled: raw.oomKilled === true,
    startedAt: str(raw.startedAt),
    finishedAt: str(raw.finishedAt),
    health: str(raw.health) || null,
    restartPolicy: str(raw.restart) || 'no',
    ports: portsOf(raw),
    mounts: mountsOf(raw.mounts),
    networks: asArray(raw.networks).filter((name): name is string => typeof name === 'string'),
    compose: composeOf(raw)
  }
}

export function parseContainers(stdout: string): DockerList<DockerContainer> {
  const items = parseJsonLines(stdout).filter((raw) => str(raw.id)).map(toContainer)
  const count = Number(/^count=(\d+)$/m.exec(stdout)?.[1] ?? items.length)
  return { items, truncated: count > items.length }
}
