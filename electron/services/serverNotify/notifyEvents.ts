import type { ServerNotifications, ServerNotifyEvent } from '../../../src/types/server/notifications'
import { sendNotification } from './NotifySender'
import { ServerNotifier } from './ServerNotifier'

type Broadcast = (channel: string, ...args: unknown[]) => void

const NOTIFICATIONS_OFF: ServerNotifications = { kind: 'off', url: '', events: [] }

let readSettings: () => ServerNotifications = () => NOTIFICATIONS_OFF

const notifier = new ServerNotifier({
  settings: () => readSettings(),
  send: (target, event, text) => sendNotification(target, event, text),
  onError: warn
})

export function configureServerNotify(settings: () => ServerNotifications): void {
  readSettings = settings
}

export function notifyServerEvent(event: ServerNotifyEvent, text: string): void {
  try {
    notifier.notify(event, text)
  } catch (err) {
    warn((err as Error).message)
  }
}

export function withServerNotify(broadcast: Broadcast): Broadcast {
  return (channel, ...args) => {
    broadcast(channel, ...args)
    try {
      notifier.observe(channel, args)
    } catch (err) {
      warn((err as Error).message)
    }
  }
}

function warn(message: string): void {
  console.warn(`[server-notify] ${message}`)
}
