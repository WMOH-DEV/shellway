import type { ActionDefinition, ActionStep, PlanBlock, ServerFacts } from '@/types/server/core'
import { accessBlock, dockerPlan, dockerStep, PULL_TIMEOUT_SECONDS } from '../plan'
import { DOCKER_PROBE, dockerContainers, dockerState } from '../probes'
import { shellQuote } from '../shell'
import type { DockerState } from '../types'
import { asObject, asString, fail, isEnvKey, isHostPath, isImageName, isPort, isTag, isVolumeName, MAX_ENV_VALUE, oneOf, stackName } from '../validate'

export const RESTART_POLICIES = ['unless-stopped', 'always', 'on-failure', 'no'] as const
export type RestartPolicy = (typeof RESTART_POLICIES)[number]

export const BIND_ADDRESSES = ['127.0.0.1', '0.0.0.0'] as const
export type BindAddress = (typeof BIND_ADDRESSES)[number]

export const PROTOCOLS = ['tcp', 'udp'] as const

export interface RunPort {
  host: number
  container: number
  protocol: (typeof PROTOCOLS)[number]
  bind: BindAddress
}

export interface RunVolume {
  source: string
  target: string
  readOnly: boolean
}

export interface RunEnv {
  key: string
  value: string
}

export interface RunParams {
  image: string
  tag: string
  name: string
  restart: RestartPolicy
  ports: RunPort[]
  volumes: RunVolume[]
  env: RunEnv[]
  saveAsCompose: boolean
}

const MAX_ROWS = 20
const MAX_ENV = 100
const MASK = '••••'
const SECRET_MIN_LENGTH = 4

export const envFilePath = (name: string): string => `/etc/shellway/docker/${name}.env`
export const stackDir = (name: string): string => `/opt/stacks/${name}`
export const imageRef = (params: Pick<RunParams, 'image' | 'tag'>): string => `${params.image}:${params.tag}`

const listOf = (value: unknown, field: string): unknown[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`${field} must be a list`)
  return value
}

function validatePort(raw: unknown): RunPort {
  const input = asObject(raw)
  if (!isPort(input.host) || !isPort(input.container)) fail('Ports must be numbers from 1 to 65535')
  return { host: input.host, container: input.container, protocol: oneOf(input.protocol ?? 'tcp', PROTOCOLS, 'Protocol'), bind: oneOf(input.bind ?? '127.0.0.1', BIND_ADDRESSES, 'Bind address') }
}

function validateVolume(raw: unknown): RunVolume {
  const input = asObject(raw)
  const source = asString(input.source, 'Volume source')
  const target = asString(input.target, 'Volume target')
  if (source.startsWith('/') ? !isHostPath(source) || source === '/' : !isVolumeName(source)) fail(`Volume source ${source} is not a valid folder path or volume name`)
  if (!isHostPath(target)) fail(`Volume target ${target} must be an absolute path inside the container`)
  return { source, target, readOnly: input.readOnly === true }
}

function validateEnv(raw: unknown, saveAsCompose: boolean): RunEnv {
  const input = asObject(raw)
  const key = asString(input.key, 'Variable name')
  if (!isEnvKey(key)) fail(`${key} is not a valid variable name`)
  if (typeof input.value !== 'string') fail(`${key} needs a value`)
  const value = input.value
  if (/[\r\n\0]/.test(value) || value.length > MAX_ENV_VALUE) fail(`${key}: values must be one line, up to ${MAX_ENV_VALUE} characters`)
  if (saveAsCompose && value.includes("'")) fail(`${key}: compose stacks cannot store values with a single quote`)
  return { key, value }
}

function assertUnique(values: string[], message: string): void {
  if (new Set(values).size !== values.length) fail(message)
}

function bounded(list: unknown[], max: number, field: string): unknown[] {
  if (list.length > max) fail(`Up to ${max} ${field}`)
  return list
}

function validateRun(raw: unknown): RunParams {
  const input = asObject(raw)
  const image = asString(input.image, 'Image')
  if (!isImageName(image)) fail('Image: use a name like nginx, acme/app or registry.example.com/acme/app')
  const tag = asString(input.tag ?? 'latest', 'Tag') || 'latest'
  if (!isTag(tag)) fail('Tag: letters, numbers, dots, dashes and underscores only')
  const saveAsCompose = input.saveAsCompose === true
  const ports = bounded(listOf(input.ports, 'Ports'), MAX_ROWS, 'ports').map(validatePort)
  const volumes = bounded(listOf(input.volumes, 'Volumes'), MAX_ROWS, 'volumes').map(validateVolume)
  const env = bounded(listOf(input.env, 'Environment'), MAX_ENV, 'variables').map((item) => validateEnv(item, saveAsCompose))
  assertUnique(ports.map((port) => `${port.host}/${port.protocol}`), 'Each host port can be used once')
  assertUnique(volumes.map((volume) => volume.target), 'Each container path can be mounted once')
  assertUnique(env.map((item) => item.key), 'Each variable can be set once')
  return { image, tag, name: stackName(input.name), restart: oneOf(input.restart ?? 'unless-stopped', RESTART_POLICIES, 'Restart policy'), ports, volumes, env, saveAsCompose }
}

const portSpec = (port: RunPort): string => `${port.bind}:${port.host}:${port.container}${port.protocol === 'udp' ? '/udp' : ''}`
const volumeSpec = (volume: RunVolume): string => `${volume.source}:${volume.target}${volume.readOnly ? ':ro' : ''}`

export function runCommandLine(params: RunParams): string {
  return [
    'docker run -d',
    `--name ${params.name}`,
    `--restart ${params.restart}`,
    ...params.ports.map((port) => `-p ${portSpec(port)}`),
    ...params.volumes.map((volume) => `-v ${shellQuote(volumeSpec(volume))}`),
    ...(params.env.length > 0 ? [`--env-file ${envFilePath(params.name)}`] : []),
    shellQuote(imageRef(params))
  ].join(' ')
}

const yamlList = (key: string, items: string[]): string[] => (items.length > 0 ? [`    ${key}:`, ...items.map((item) => `      - "${item}"`)] : [])

function namedVolumes(params: RunParams): string[] {
  const names = [...new Set(params.volumes.filter((volume) => !volume.source.startsWith('/')).map((volume) => volume.source))]
  return names.length > 0 ? ['volumes:', ...names.flatMap((name) => [`  ${name}:`, `    name: "${name}"`])] : []
}

export function composeFile(params: RunParams): string {
  return [
    'services:',
    `  ${params.name}:`,
    `    image: "${imageRef(params)}"`,
    `    container_name: "${params.name}"`,
    `    restart: "${params.restart}"`,
    ...yamlList('ports', params.ports.map(portSpec)),
    ...yamlList('volumes', params.volumes.map(volumeSpec)),
    ...yamlList('env_file', params.env.length > 0 ? ['.env'] : []),
    ...namedVolumes(params),
    ''
  ].join('\n')
}

const envBody = (env: RunEnv[], quoted: boolean): string => env.map(({ key, value }) => `${key}=${quoted ? `'${value}'` : value}`).join('\n')

const maskedEnv = (env: RunEnv[]): string => env.map(({ key }) => `${key}=${MASK}`).join('\n')

const ownerLine = (state: DockerState | null, path: string): string[] => (state?.access === 'group' ? [`chown "$SUDO_USER" ${path}`] : [])

function envFileStep(params: RunParams, state: DockerState | null): ActionStep {
  const path = envFilePath(params.name)
  const script = [
    'set -e',
    'umask 022',
    'mkdir -p /etc/shellway/docker',
    'umask 077',
    `[ -e ${path} ] || echo "SHELLWAY_STATE created=1"`,
    `cat > ${path}.tmp <<'SHELLWAY_ENV'`,
    envBody(params.env, false),
    'SHELLWAY_ENV',
    `chmod 600 ${path}.tmp`,
    ...ownerLine(state, `${path}.tmp`),
    `mv ${path}.tmp ${path}`,
    ''
  ].join('\n')
  return {
    id: 'env-file',
    label: 'Save environment variables',
    kind: 'command',
    root: true,
    script,
    display: `write ${path} (mode 0600)\n${maskedEnv(params.env)}`,
    timeoutSeconds: 30,
    rollback: `[ "$created" = 1 ] && rm -f ${path} || true\n`
  }
}

function stackFilesStep(params: RunParams, state: DockerState | null): ActionStep {
  const dir = stackDir(params.name)
  const hasEnv = params.env.length > 0
  const script = [
    'set -e',
    'umask 022',
    `[ -e ${dir}/compose.yaml ] && { echo "${dir}/compose.yaml already exists" >&2; exit 3; }`,
    ...(hasEnv ? [`[ -e ${dir}/.env ] && { echo "${dir}/.env already exists" >&2; exit 3; }`] : []),
    `[ -d ${dir} ] || echo "SHELLWAY_STATE created=1"`,
    `mkdir -p ${dir}`,
    `cat > ${dir}/compose.yaml <<'SHELLWAY_COMPOSE'`,
    composeFile(params).trimEnd(),
    'SHELLWAY_COMPOSE',
    ...(hasEnv ? ['umask 077', `cat > ${dir}/.env <<'SHELLWAY_ENV'`, envBody(params.env, true), 'SHELLWAY_ENV', `chmod 600 ${dir}/.env`, ...ownerLine(state, `${dir}/.env`)] : []),
    ''
  ].join('\n')
  const display = [`write ${dir}/compose.yaml`, composeFile(params).trimEnd(), ...(hasEnv ? [`write ${dir}/.env (mode 0600)`, maskedEnv(params.env)] : [])].join('\n')
  return {
    id: 'stack-files',
    label: 'Write the compose stack',
    kind: 'command',
    root: true,
    script,
    display,
    timeoutSeconds: 30,
    rollback: `if [ "$created" = 1 ]; then rm -rf ${dir}; else rm -f ${dir}/compose.yaml${hasEnv ? ` ${dir}/.env` : ''}; fi\n`
  }
}

function composeSteps(params: RunParams, state: DockerState | null): ActionStep[] {
  const dir = stackDir(params.name)
  return [
    stackFilesStep(params, state),
    dockerStep('up', 'Start the stack', `cd ${dir} && docker compose up -d`, state, { timeoutSeconds: PULL_TIMEOUT_SECONDS, detached: true, rollback: `cd ${dir} && docker compose down\n` })
  ]
}

function runSteps(params: RunParams, state: DockerState | null): ActionStep[] {
  return [
    ...(params.env.length > 0 ? [envFileStep(params, state)] : []),
    dockerStep('pull', 'Pull the image', `docker pull ${shellQuote(imageRef(params))}`, state, { timeoutSeconds: PULL_TIMEOUT_SECONDS, detached: true }),
    dockerStep('run', 'Start the container', runCommandLine(params), state, { rollback: `docker rm -f ${params.name}\n` })
  ]
}

const needsSudo = (params: RunParams): boolean => params.saveAsCompose || params.env.length > 0

function runBlock(params: RunParams, facts: ServerFacts): PlanBlock | null {
  const state = dockerState(facts)
  const access = accessBlock(state)
  if (access) return access
  if (needsSudo(params) && !state?.sudo) return { kind: 'sudo', message: 'Saving the env file or a compose stack needs sudo without a password.' }
  if (params.saveAsCompose && !state?.composeVersion) return { kind: 'unsupported', message: 'The Docker Compose plugin is not installed.' }
  if (dockerContainers(facts).some((container) => container.name === params.name)) return { kind: 'precondition', message: `A container named ${params.name} already exists.` }
  return null
}

function runWarnings(params: RunParams): string[] {
  return params.ports
    .filter((port) => port.bind === '0.0.0.0')
    .map((port) => `Port ${port.host} will be open to the internet. Docker skips the ufw firewall for published ports.`)
}

export const runAction: ActionDefinition<RunParams> = {
  type: 'docker.run',
  area: 'docker',
  needs: [DOCKER_PROBE.state, DOCKER_PROBE.containers],
  validate: validateRun,
  plan(params, facts) {
    const state = dockerState(facts)
    return dockerPlan({
      title: params.saveAsCompose ? `Create stack ${params.name}` : `Run ${imageRef(params)}`,
      summary: params.saveAsCompose ? `Saves a compose stack in ${stackDir(params.name)} and starts it.` : `Starts a container named ${params.name}.`,
      steps: params.saveAsCompose ? composeSteps(params, state) : runSteps(params, state),
      warnings: runWarnings(params),
      blocked: runBlock(params, facts),
      secrets: params.env.map((item) => item.value).filter((value) => value.length >= SECRET_MIN_LENGTH)
    })
  }
}
