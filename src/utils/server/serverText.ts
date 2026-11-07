const UNREADABLE = '﷐'

function readableText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes).replaceAll('�', UNREADABLE)
  }
}

export function decodeServerText(base64: string): string {
  if (!base64) return ''
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return readableText(bytes).replaceAll('\r\n', '\n')
}

export const hasUnreadableText = (text: string): boolean => text.includes(UNREADABLE)
