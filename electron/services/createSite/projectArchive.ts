import { mkdir, writeFile } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'
import { gunzipSync } from 'zlib'

export interface ArchiveEntry {
  path: string
  kind: 'file' | 'dir'
  executable: boolean
  data: Buffer
}

const BLOCK = 512
const MAX_ENTRIES = 20_000
const MAX_BYTES = 200 * 1024 * 1024
const SEGMENT = /^[^\0/\\]+$/

const text = (header: Buffer, start: number, length: number): string => {
  const field = header.subarray(start, start + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? length : end).toString('utf8')
}

const octal = (header: Buffer, start: number, length: number): number => {
  const value = Number.parseInt(text(header, start, length).trim() || '0', 8)
  if (!Number.isFinite(value) || value < 0) throw new Error('The project archive is damaged')
  return value
}

export function safeArchivePath(raw: string): string {
  const parts = raw.replace(/^\.\//, '').replace(/\/+$/, '').split('/')
  if (raw.startsWith('/') || parts.some((part) => part === '..' || part === '.' || !SEGMENT.test(part))) {
    throw new Error(`The project archive has an unsafe path: ${raw}`)
  }
  return parts.join('/')
}

function entryKind(type: string, name: string): ArchiveEntry['kind'] {
  if (type === '0' || type === '\0' || type === '') return 'file'
  if (type === '5') return 'dir'
  throw new Error(`The project archive has a link or special file, which Shellway does not copy: ${name}`)
}

export function readArchive(gzipped: Buffer): ArchiveEntry[] {
  const tar = gunzipSync(gzipped, { maxOutputLength: MAX_BYTES })
  const entries: ArchiveEntry[] = []
  for (let offset = 0; offset + BLOCK <= tar.length;) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header[0] === 0) break
    const name = [text(header, 345, 155), text(header, 0, 100)].filter(Boolean).join('/')
    const size = octal(header, 124, 12)
    const start = offset + BLOCK
    if (start + size > tar.length) throw new Error('The project archive is cut short')
    offset = start + Math.ceil(size / BLOCK) * BLOCK
    if (name === '.' || name === './') continue
    if (entries.length >= MAX_ENTRIES) throw new Error('The project archive has too many files')
    const kind = entryKind(text(header, 156, 1), name)
    entries.push({ path: safeArchivePath(name), kind, executable: (octal(header, 100, 8) & 0o111) !== 0, data: tar.subarray(start, start + size) })
  }
  return entries
}

function inside(root: string, path: string): string {
  const target = resolve(root, ...path.split('/'))
  if (!target.startsWith(`${resolve(root)}${sep}`)) throw new Error(`The project archive has an unsafe path: ${path}`)
  return target
}

export async function writeArchive(root: string, entries: ArchiveEntry[]): Promise<void> {
  for (const entry of entries) {
    const target = inside(root, entry.path)
    if (entry.kind === 'dir') {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entry.data, { mode: entry.executable ? 0o755 : 0o644, flag: 'wx' })
  }
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = inside(root, safeArchivePath(path))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, { mode: 0o644, flag: 'wx' })
  }
}

export const projectFile = (root: string, path: string): string => join(root, ...safeArchivePath(path).split('/'))
