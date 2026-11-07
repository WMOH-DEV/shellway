import type { DockerContainer, PortBinding } from './types'

const PUBLIC_HOSTS = new Set(['', '0.0.0.0', '::', '[::]'])

export const isPublicBinding = (binding: PortBinding): boolean => binding.hostPort > 0 && PUBLIC_HOSTS.has(binding.hostIp)

export const publicBindings = (container: DockerContainer): PortBinding[] => container.ports.filter(isPublicBinding)

export function formatBinding(binding: PortBinding): string {
  const host = binding.hostIp === '' ? '0.0.0.0' : binding.hostIp.includes(':') && !binding.hostIp.startsWith('[') ? `[${binding.hostIp}]` : binding.hostIp
  const protocol = binding.protocol === 'tcp' ? '' : `/${binding.protocol}`
  return `${host}:${binding.hostPort} → ${binding.containerPort}${protocol}`
}

const RESTARTING_POLICIES = new Set(['always', 'unless-stopped'])

const STOP_SIGNAL_EXITS = new Set([137, 143])

function exitedWithError(container: DockerContainer): boolean {
  if (container.status !== 'exited' || container.exitCode === 0) return false
  return container.oomKilled || !STOP_SIGNAL_EXITS.has(container.exitCode)
}

export const isCrashed = (container: DockerContainer): boolean => RESTARTING_POLICIES.has(container.restartPolicy) && exitedWithError(container)
