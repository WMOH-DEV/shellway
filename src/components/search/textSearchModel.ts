import type { TextMatch } from '@/types/search'

export interface FileHit {
  key: string
  match: TextMatch
}

export interface FileGroup {
  path: string
  name: string
  dir: string
  hits: FileHit[]
}

export interface TextSegment {
  text: string
  hit: boolean
}

export interface SearchRootSources {
  sftpPath?: string
  siteRoot?: string
  defaultDirectory?: string
}

export function hitKey(match: TextMatch): string {
  return `${match.path}:${match.line}`
}

function splitPath(path: string): { name: string; dir: string } {
  const cut = path.lastIndexOf('/')
  if (cut < 0) return { name: path, dir: '' }
  return { name: path.slice(cut + 1), dir: path.slice(0, cut) }
}

function relativeDir(dir: string, root: string): string {
  const base = root.replace(/\/+$/, '')
  if (!base) return dir
  if (dir === base) return ''
  return dir.startsWith(`${base}/`) ? dir.slice(base.length + 1) : dir
}

export function groupMatchesByFile(matches: TextMatch[], root = ''): FileGroup[] {
  const groups = new Map<string, FileGroup>()
  for (const match of matches) {
    let group = groups.get(match.path)
    if (!group) {
      const { name, dir } = splitPath(match.path)
      group = { path: match.path, name, dir: relativeDir(dir, root), hits: [] }
      groups.set(match.path, group)
    }
    group.hits.push({ key: hitKey(match), match })
  }
  return [...groups.values()]
}

export function splitByRanges(text: string, ranges: Array<[number, number]>): TextSegment[] {
  const sorted = ranges
    .map(([start, end]): [number, number] => [Math.max(0, start), Math.min(text.length, end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  const segments: TextSegment[] = []
  let cursor = 0
  for (const [start, end] of sorted) {
    if (end <= cursor) continue
    const from = Math.max(start, cursor)
    if (from > cursor) segments.push({ text: text.slice(cursor, from), hit: false })
    segments.push({ text: text.slice(from, end), hit: true })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false })
  return segments.length > 0 ? segments : [{ text, hit: false }]
}

export function defaultSearchRoot({ sftpPath, siteRoot, defaultDirectory }: SearchRootSources): string {
  for (const candidate of [sftpPath, siteRoot, defaultDirectory]) {
    const value = candidate?.trim()
    if (value) return value
  }
  return ''
}

export function countFiles(matches: TextMatch[]): number {
  return new Set(matches.map((m) => m.path)).size
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}
