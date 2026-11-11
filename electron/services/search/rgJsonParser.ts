import { posix } from 'path'
import type { TextMatch } from '../../../src/types/search'
import { ENGINE_MARKER, TEXT_LIMITS } from './remoteCommands'

type Range = [number, number]

export interface MatcherOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

const MAX_PENDING_CHARS = 1024 * 1024
const GREP_LINE = /^(.+?):(\d+):(.*)$/s

export function createLineSplitter(): { push(chunk: string): string[]; flush(): string[] } {
  let pending = ''
  return {
    push(chunk) {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      if (pending.length > MAX_PENDING_CHARS) pending = ''
      return lines.map(stripCarriageReturn)
    },
    flush() {
      const rest = stripCarriageReturn(pending)
      pending = ''
      return rest ? [rest] : []
    }
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

export function parseEngineMarker(line: string): 'rg' | 'grep' | null {
  if (!line.startsWith(`${ENGINE_MARKER} `)) return null
  const engine = line.slice(ENGINE_MARKER.length + 1).trim()
  return engine === 'rg' || engine === 'grep' ? engine : null
}

function toAbsolute(root: string, relative: string): string {
  const path = relative.startsWith('./') ? relative.slice(2) : relative
  return path.startsWith('/') ? path : posix.join(root, path)
}

function clampRanges(ranges: Range[]): Range[] {
  const max = TEXT_LIMITS.maxColumns
  return ranges.filter(([start]) => start < max).map(([start, end]): Range => [start, Math.min(end, max)])
}

function byteRangesToIndices(text: string, byteRanges: Array<{ start: number; end: number }>): Range[] {
  const bytes = Buffer.from(text, 'utf8')
  const indexAt = (offset: number) => bytes.subarray(0, offset).toString('utf8').length
  return byteRanges.map(({ start, end }): Range => [indexAt(start), indexAt(end)])
}

export function parseRgJsonLine(line: string, root: string): TextMatch | null {
  let event: any
  try {
    event = JSON.parse(line)
  } catch {
    return null
  }
  if (event?.type !== 'match') return null
  const { path, lines, line_number: lineNumber, submatches } = event.data ?? {}
  if (typeof path?.text !== 'string' || typeof lines?.text !== 'string' || !Number.isInteger(lineNumber)) return null

  const fullText = lines.text.replace(/\r?\n$/, '')
  const byteRanges = Array.isArray(submatches) ? submatches : []
  return {
    path: toAbsolute(root, path.text),
    line: lineNumber,
    text: fullText.slice(0, TEXT_LIMITS.maxColumns),
    ranges: clampRanges(byteRangesToIndices(lines.text, byteRanges))
  }
}

export function parseGrepLine(line: string, root: string, matcher: (text: string) => Range[]): TextMatch | null {
  const found = GREP_LINE.exec(line)
  if (!found) return null
  const [, path, lineNumber, text] = found
  const shown = text.slice(0, TEXT_LIMITS.maxColumns)
  return { path: toAbsolute(root, path), line: Number(lineNumber), text: shown, ranges: matcher(shown) }
}

export function makeMatcher(text: string, { caseSensitive, wholeWord, regex }: MatcherOptions): (line: string) => Range[] {
  const source = regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let pattern: RegExp
  try {
    pattern = new RegExp(wholeWord ? `\\b(?:${source})\\b` : source, caseSensitive ? 'g' : 'gi')
  } catch {
    return () => []
  }
  return (line) => {
    const ranges: Range[] = []
    pattern.lastIndex = 0
    for (let found = pattern.exec(line); found; found = pattern.exec(line)) {
      if (found[0].length === 0) {
        pattern.lastIndex++
        continue
      }
      ranges.push([found.index, found.index + found[0].length])
    }
    return ranges
  }
}

export function parseFileLines(lines: string[], root: string): string[] {
  return lines.filter((line) => line.length > 0).map((line) => toAbsolute(root, line))
}
