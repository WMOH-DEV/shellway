import type { SiteLogRequest, SiteLogResult, SiteLogSource } from './types'
import { asRecord, siteName } from './validate'
import { isWebLogPath } from './vhost'

const APP_LOG = /^(storage\/logs|logs)\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.log$/
const SOURCES: readonly SiteLogSource[] = ['app', 'error', 'access']
const MAX_LINES = 500
const MAX_LINE_CHARS = 2000
const MISSING = '@@missing'
const UNKNOWN_SITE = '@@unknown-site'
const NO_PERMISSION = '@@no-permission'

export const LARAVEL_LOG = 'storage/logs/laravel.log'

function logFile(source: SiteLogSource, file: string): string {
  const valid = source === 'app' ? APP_LOG.test(file) && !file.includes('..') : isWebLogPath(file)
  if (!valid) throw new Error('This log file is not allowed')
  return file
}

export function validLogRequest(raw: unknown): SiteLogRequest {
  const r = asRecord(raw)
  const source = SOURCES.find((s) => s === r.source)
  if (!source) throw new Error('Invalid log source')
  if (typeof r.file !== 'string') throw new Error('Log file is missing')
  const lines = typeof r.lines === 'number' && Number.isInteger(r.lines) ? Math.min(Math.max(r.lines, 1), MAX_LINES) : 200
  return { site: siteName(r.site), source, file: logFile(source, r.file), lines }
}

function targetLines(request: SiteLogRequest): string[] {
  if (request.source !== 'app') return [`f='${request.file}'`]
  return [
    `conf="$HOME/.shellway-deploy/sites/${request.site}/site.conf"`,
    `[ -f "$conf" ] || { echo '${UNKNOWN_SITE}'; exit 0; }`,
    `base="$(sed -n "s/^SITE_PATH='\\(.*\\)'$/\\1/p" "$conf" | head -n 1)"`,
    `f="$base/${request.file}"`
  ]
}

export function tailScript(request: SiteLogRequest): string {
  const tail = `tail -n ${request.lines} -- "$f" | cut -c1-${MAX_LINE_CHARS}`
  return [
    ...targetLines(request),
    `if [ ! -e "$f" ]; then echo '${MISSING}'`,
    `elif [ -r "$f" ]; then ${tail}`,
    `elif sudo -n true 2>/dev/null; then sudo -n ${tail}`,
    `else echo '${NO_PERMISSION}'; fi`,
    ''
  ].join('\n')
}

export function parseTail(stdout: string): SiteLogResult {
  const marker = stdout.trim()
  if (marker === MISSING) return { state: 'missing' }
  if (marker === UNKNOWN_SITE) return { state: 'unknown-site' }
  if (marker === NO_PERMISSION) return { state: 'no-permission' }
  return { state: 'ok', text: stdout }
}
