export type ServerNotifyKind = 'off' | 'webhook' | 'slack' | 'discord'

export type ServerNotifyEvent = 'deploy-failed' | 'certificate-risk' | 'service-down' | 'reboot-required'

export interface ServerNotifications {
  kind: ServerNotifyKind
  url: string
  events: ServerNotifyEvent[]
}
