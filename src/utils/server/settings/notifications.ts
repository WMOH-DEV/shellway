import type { ServerNotifications, ServerNotifyEvent, ServerNotifyKind } from '@/types/server/notifications'

export const NOTIFY_KINDS: readonly ServerNotifyKind[] = ['off', 'webhook', 'slack', 'discord']

export const NOTIFY_EVENTS: readonly ServerNotifyEvent[] = ['deploy-failed', 'certificate-risk', 'service-down', 'reboot-required']

export const NOTIFY_KIND_LABEL: Record<ServerNotifyKind, string> = {
  off: 'Off',
  webhook: 'Webhook',
  slack: 'Slack',
  discord: 'Discord'
}

export const NOTIFY_EVENT_LABEL: Record<ServerNotifyEvent, string> = {
  'deploy-failed': 'A deploy fails',
  'certificate-risk': 'A certificate is at risk',
  'service-down': 'A service goes down',
  'reboot-required': 'The server needs a reboot'
}

const MAX_URL_LENGTH = 2048
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function notifyUrlError(url: string): string | null {
  if (url.length === 0) return 'Enter the address to send to'
  if (url.length > MAX_URL_LENGTH) return 'That address is too long'
  const parsed = parseUrl(url)
  if (!parsed) return 'That is not a valid address'
  if (parsed.username || parsed.password) return 'Remove the user name and password from the address'
  if (parsed.protocol === 'https:') return null
  if (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) return null
  return 'The address must start with https://'
}

export function parseNotifications(raw: unknown): ServerNotifications {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid notification settings')
  const { kind, url, events } = raw as Record<string, unknown>
  if (!NOTIFY_KINDS.includes(kind as ServerNotifyKind)) throw new Error('Invalid notification kind')
  if (typeof url !== 'string') throw new Error('Invalid notification address')
  if (!Array.isArray(events) || !events.every((event) => NOTIFY_EVENTS.includes(event as ServerNotifyEvent))) throw new Error('Invalid notification events')
  if (kind !== 'off') {
    const error = notifyUrlError(url)
    if (error) throw new Error(error)
  }
  return { kind: kind as ServerNotifyKind, url, events: [...new Set(events as ServerNotifyEvent[])] }
}

export function notifyPayload(kind: Exclude<ServerNotifyKind, 'off'>, text: string, event: ServerNotifyEvent | 'test'): Record<string, string> {
  if (kind === 'slack') return { text }
  if (kind === 'discord') return { content: text }
  return { source: 'shellway', event, text }
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}
