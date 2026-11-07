import { shellQuote } from './shell'

export const LOG_TAIL = 200
export const LOG_BYTE_LIMIT = 8 * 1024 * 1024

export function logsCommand(container: string, follow: boolean): string {
  const logs = `docker logs --timestamps --tail ${LOG_TAIL}${follow ? ' -f' : ''} ${shellQuote(container)}`
  const inner = `exec 2>/dev/null; ( ${logs} 2>&1; kill 0 ) & cat >/dev/null; kill 0`
  const script = [
    `I=${shellQuote(inner)}`,
    'if [ "$(id -u)" = 0 ] || id -nG | tr " " "\\n" | grep -qx docker; then exec sh -c "$I"; else exec sudo -n sh -c "$I"; fi'
  ].join('; ')
  return `sh -c ${shellQuote(script)}`
}

export const manifestCommand = (reference: string): string => `docker manifest inspect ${shellQuote(reference)}`
