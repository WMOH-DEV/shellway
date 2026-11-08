import type { ServerRoute } from '@/types/server/core'
import { composeFile, runAction, runCommandLine, stackDir, type RestartPolicy, type RunParams } from './actions/run'
import { splitReference } from './validate'

export interface PortRow {
  host: string
  container: string
  protocol: 'tcp' | 'udp'
  isPublic: boolean
}

export interface VolumeRow {
  source: string
  target: string
  readOnly: boolean
}

export interface EnvRow {
  key: string
  value: string
}

export interface RunForm {
  reference: string
  name: string
  restart: RestartPolicy
  ports: PortRow[]
  volumes: VolumeRow[]
  env: EnvRow[]
  onDomain: boolean
  domain: string
}

export const emptyPort = (): PortRow => ({ host: '', container: '', protocol: 'tcp', isPublic: false })
export const emptyVolume = (): VolumeRow => ({ source: '', target: '', readOnly: false })
export const emptyEnv = (): EnvRow => ({ key: '', value: '' })

export const EMPTY_RUN_FORM: RunForm = {
  reference: '',
  name: '',
  restart: 'unless-stopped',
  ports: [emptyPort()],
  volumes: [],
  env: [],
  onDomain: false,
  domain: ''
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const toNumber = (value: string): number | string => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : value)

export function suggestName(reference: string): string {
  const [name] = splitReference(reference.trim())
  return (name.split('/').pop() ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 63)
}

export function toRunInput(form: RunForm, saveAsCompose: boolean): Record<string, unknown> {
  const [image, tag] = splitReference(form.reference.trim())
  return {
    image,
    tag: tag ?? 'latest',
    name: form.name.trim() || suggestName(form.reference),
    restart: form.restart,
    ports: form.ports
      .filter((port) => port.host.trim() || port.container.trim())
      .map((port) => ({ host: toNumber(port.host), container: toNumber(port.container), protocol: port.protocol, bind: port.isPublic ? '0.0.0.0' : '127.0.0.1' })),
    volumes: form.volumes.filter((volume) => volume.source.trim() || volume.target.trim()),
    env: form.env.filter((item) => item.key.trim() || item.value),
    saveAsCompose
  }
}

export type RunPreview = { ok: true; params: RunParams; text: string } | { ok: false; error: string }

function domainError(form: RunForm, params: RunParams): string | null {
  if (!form.onDomain) return null
  if (!DOMAIN.test(form.domain.trim().toLowerCase())) return 'Enter a domain like app.example.com'
  if (params.ports.length === 0) return 'Add a port so the site can reach the container'
  return null
}

function previewText(params: RunParams, form: RunForm): string {
  const main = params.saveAsCompose ? `cd ${stackDir(params.name)} && docker compose up -d\n\n# ${stackDir(params.name)}/compose.yaml\n${composeFile(params)}` : runCommandLine(params)
  return form.onDomain ? `${main}\n\nthen: Create site ${form.domain.trim()} → 127.0.0.1:${params.ports[0].host}` : main
}

export function runPreview(form: RunForm, saveAsCompose: boolean): RunPreview {
  try {
    const params = runAction.validate(toRunInput(form, saveAsCompose))
    const error = domainError(form, params)
    return error ? { ok: false, error } : { ok: true, params, text: previewText(params, form) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function siteRoute(form: RunForm, params: RunParams): ServerRoute {
  return {
    section: 'sites',
    sub: 'create',
    params: {
      template: params.saveAsCompose ? 'compose' : 'node-proxy',
      port: String(params.ports[0].host),
      domain: form.domain.trim().toLowerCase(),
      ...(params.saveAsCompose ? { path: stackDir(params.name) } : {})
    }
  }
}
