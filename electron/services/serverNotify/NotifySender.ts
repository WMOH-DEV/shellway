import type { ServerNotifyEvent, ServerNotifyKind } from '../../../src/types/server/notifications'
import { notifyPayload, notifyUrlError } from '../../../src/utils/server/settings/notifications'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface NotifyTarget {
  kind: Exclude<ServerNotifyKind, 'off'>
  url: string
}

export const NOTIFY_TIMEOUT_MS = 5000

export async function sendNotification(target: NotifyTarget, event: ServerNotifyEvent | 'test', text: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const urlError = notifyUrlError(target.url)
  if (urlError) throw new Error(urlError)
  const response = await post(target, JSON.stringify(notifyPayload(target.kind, text, event)), fetchImpl)
  void response.body?.cancel().catch(() => undefined)
  if (!response.ok) throw new Error(`The ${target.kind} address answered with HTTP ${response.status}`)
}

async function post(target: NotifyTarget, body: string, fetchImpl: FetchLike): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS)
  try {
    return await fetchImpl(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      redirect: 'error',
      signal: controller.signal
    })
  } catch {
    throw new Error(controller.signal.aborted
      ? `The ${target.kind} address did not answer within ${NOTIFY_TIMEOUT_MS / 1000} seconds`
      : `Could not reach the ${target.kind} address`)
  } finally {
    clearTimeout(timer)
  }
}
