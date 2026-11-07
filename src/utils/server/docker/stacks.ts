import { isPublicBinding } from './exposure'
import type { DockerContainer } from './types'

export interface Stack {
  project: string | null
  workingDir: string
  configFile: string
  containers: DockerContainer[]
}

export interface SiteRef {
  name: string
  path: string
}

export interface PortView {
  text: string
  isPublic: boolean
}

const byName = (a: DockerContainer, b: DockerContainer): number => a.name.localeCompare(b.name)

export function groupStacks(containers: DockerContainer[]): Stack[] {
  const projects = new Map<string, Stack>()
  const standalone: DockerContainer[] = []
  for (const container of containers) {
    const labels = container.compose
    if (!labels) {
      standalone.push(container)
      continue
    }
    const stack = projects.get(labels.project) ?? { project: labels.project, workingDir: labels.workingDir, configFile: labels.configFiles[0] ?? '', containers: [] }
    stack.containers.push(container)
    projects.set(labels.project, stack)
  }
  const stacks = [...projects.values()].sort((a, b) => (a.project ?? '').localeCompare(b.project ?? ''))
  stacks.forEach((stack) => stack.containers.sort(byName))
  return standalone.length > 0 ? [...stacks, { project: null, workingDir: '', configFile: '', containers: standalone.sort(byName) }] : stacks
}

const trimSlash = (path: string): string => path.replace(/\/+$/, '')

const within = (inner: string, outer: string): boolean => inner === outer || inner.startsWith(`${outer}/`)

export function linkedSite(stack: Stack, sites: SiteRef[]): SiteRef | null {
  if (!stack.workingDir) return null
  const dir = trimSlash(stack.workingDir)
  return sites.find((site) => {
    const root = trimSlash(site.path)
    return root !== '' && (within(dir, root) || within(root, dir))
  }) ?? null
}

export function portViews(container: DockerContainer): PortView[] {
  const views = new Map<string, PortView>()
  for (const binding of container.ports) {
    if (binding.hostPort === 0) continue
    const key = `${binding.hostPort}/${binding.protocol}`
    const isPublic = isPublicBinding(binding)
    const host = isPublic ? '0.0.0.0' : binding.hostIp
    const suffix = binding.protocol === 'tcp' ? '' : `/${binding.protocol}`
    const existing = views.get(key)
    if (!existing || isPublic) views.set(key, { text: `${host}:${binding.hostPort}${suffix}`, isPublic: isPublic || Boolean(existing?.isPublic) })
  }
  return [...views.values()]
}
