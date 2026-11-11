import { shellEscape } from '../../utils/shellEscape'
import type { FileNameSearchRequest, TextSearchRequest } from '../../../src/types/search'

export const FILE_LIMITS = { maxResults: 200, timeoutSeconds: 8, maxDepth: 12 } as const
export const TEXT_LIMITS = { maxMatches: 2000, timeoutSeconds: 20, maxColumns: 400 } as const

export const ENGINE_MARKER = '@@engine'

const MAX_PATH_LENGTH = 1024
const MAX_TEXT_LENGTH = 500
const MAX_GLOBS = 50
const MAX_GLOB_LENGTH = 200
const MAX_MATCHES_PER_FILE = 200
const UNSAFE_CHARS = /[\0\n\r]/
const GLOB_META = /[\\*?[\]{}]/g

export function validateRemotePath(path: unknown, label: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > MAX_PATH_LENGTH || UNSAFE_CHARS.test(path)) {
    throw new Error(`Invalid ${label}`)
  }
  return path
}

function validateText(text: unknown): string {
  if (typeof text !== 'string' || text.length < 1 || text.length > MAX_TEXT_LENGTH || UNSAFE_CHARS.test(text)) {
    throw new Error('Invalid text')
  }
  return text
}

function validateGlobs(globs: unknown, label: string): string[] {
  if (!Array.isArray(globs) || globs.length > MAX_GLOBS) throw new Error(`Invalid ${label}`)
  const cleaned = globs.map((glob) => {
    if (typeof glob !== 'string' || glob.length > MAX_GLOB_LENGTH || /[\0\n\r']/.test(glob)) {
      throw new Error(`Invalid ${label}`)
    }
    return glob.trim()
  })
  return cleaned.filter((glob) => glob.length > 0)
}

function escapeGlob(text: string): string {
  return text.replace(GLOB_META, '\\$&')
}

const HOME_DIR = '"$HOME"'

function wrapped(root: string | null, seconds: number, inner: string): string {
  const run = `exec timeout -k 2 ${seconds} sh -c ${shellEscape(inner)}`
  return root === null ? run : `cd ${shellEscape(root)} && ${run}`
}

export function buildFileNameCommand(req: FileNameSearchRequest): { script: string; display: string } {
  const root = req.root === undefined ? null : validateRemotePath(req.root, 'root')
  const searchDir = root === null ? HOME_DIR : '.'
  const text = validateText(req.text)
  const excludes = validateGlobs(req.excludes, 'exclude')
  const pattern = shellEscape(`*${escapeGlob(text)}*`)
  const limit = `head -n ${FILE_LIMITS.maxResults}`

  const fdArgs = [
    `--type f --hidden --color never --max-depth ${FILE_LIMITS.maxDepth} --ignore-case --glob ${pattern}`,
    ...excludes.map((glob) => `--exclude ${shellEscape(glob)}`),
    searchDir
  ].join(' ')
  const prune = excludes.length
    ? `\\( ${excludes.map((glob) => `-name ${shellEscape(glob)}`).join(' -o ')} \\) -prune -o `
    : ''
  const findArgs = `${searchDir} -maxdepth ${FILE_LIMITS.maxDepth} ${prune}-type f -iname ${pattern} -print`

  const inner = [
    'if command -v fd >/dev/null 2>&1; then FD=fd; elif command -v fdfind >/dev/null 2>&1; then FD=fdfind; else FD=; fi',
    `if [ -n "$FD" ]; then "$FD" ${fdArgs} 2>/dev/null | ${limit}; else find ${findArgs} 2>/dev/null | ${limit}; fi`
  ].join('\n')

  return {
    script: wrapped(root, FILE_LIMITS.timeoutSeconds, inner),
    display: `fd -i -g ${shellEscape(`*${text}*`)} in ${root ?? '~'}`
  }
}

export function buildTextCommand(req: TextSearchRequest): { script: string; display: string; engine: 'rg' | 'grep' } {
  const root = validateRemotePath(req.root, 'root')
  const text = validateText(req.text)
  const includes = validateGlobs(req.includes, 'include')
  const excludes = validateGlobs(req.excludes, 'exclude')
  const quoted = shellEscape(text)

  const rgArgs = [
    `--json --no-messages --max-columns ${TEXT_LIMITS.maxColumns} --max-count ${MAX_MATCHES_PER_FILE}`,
    req.caseSensitive ? '-s' : '-i',
    ...(req.wholeWord ? ['-w'] : []),
    ...(req.regex ? [] : ['-F']),
    ...includes.map((glob) => `--glob ${shellEscape(glob)}`),
    ...excludes.map((glob) => `--glob ${shellEscape(`!${glob}`)}`),
    `-e ${quoted} .`
  ].join(' ')
  const grepArgs = [
    '-rnIs',
    ...(req.caseSensitive ? [] : ['-i']),
    ...(req.wholeWord ? ['-w'] : []),
    req.regex ? '-E' : '-F',
    ...includes.map((glob) => `--include=${shellEscape(glob)}`),
    ...excludes.map((glob) => `--exclude-dir=${shellEscape(glob)}`),
    `-e ${quoted} .`
  ].join(' ')

  const inner = [
    'if command -v rg >/dev/null 2>&1; then',
    `echo '${ENGINE_MARKER} rg'`,
    `rg ${rgArgs}`,
    'else',
    `echo '${ENGINE_MARKER} grep'`,
    `grep ${grepArgs}`,
    'fi'
  ].join('\n')

  const flags = [req.caseSensitive ? '-s' : '-i', ...(req.wholeWord ? ['-w'] : []), ...(req.regex ? [] : ['-F'])]
  return {
    script: wrapped(root, TEXT_LIMITS.timeoutSeconds, inner),
    display: `rg --json ${flags.join(' ')} ${quoted} ${root}`,
    engine: 'rg'
  }
}
