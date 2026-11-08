import type { ProbeDefinition } from '@/types/server/core'
import { FOLDERS_PROBE } from './ids'

export interface Folder {
  path: string
  sizeBytes: number
}

export interface FolderUsage {
  root: Folder[]
  var: Folder[]
  partial: boolean
}

export const FOLDER_SCAN_SECONDS = 30
const SHOWN = 10
const TIMED_OUT = 124

const FOLDERS_SCRIPT = [
  'export LC_ALL=C',
  `{ timeout ${FOLDER_SCAN_SECONDS} nice -n 10 du -xk --max-depth=2 / 2>/dev/null; echo "@@exit=$?"; } | awk -F'\\t' '/^@@/ || $2 !~ /^\\/[^\\/]+\\/./ || $2 ~ /^\\/var\\//'`,
  ''
].join('\n')

function parseEntry(line: string): Folder | null {
  const [size, path] = line.split('\t')
  const kib = Number(size)
  return path && Number.isFinite(kib) ? { path, sizeBytes: kib * 1024 } : null
}

const depth = (path: string): number => path.split('/').length - 1

const biggest = (folders: Folder[]): Folder[] => [...folders].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, SHOWN)

export function parseFolders(stdout: string): FolderUsage {
  const lines = stdout.split('\n')
  const entries = lines.map(parseEntry).filter((entry): entry is Folder => entry !== null)
  return {
    root: biggest(entries.filter((entry) => entry.path !== '/' && depth(entry.path) === 1)),
    var: biggest(entries.filter((entry) => entry.path.startsWith('/var/') && depth(entry.path) === 2)),
    partial: lines.includes(`@@exit=${TIMED_OUT}`)
  }
}

export const foldersProbe: ProbeDefinition<FolderUsage> = {
  id: FOLDERS_PROBE,
  area: 'overview',
  root: true,
  timeoutSeconds: FOLDER_SCAN_SECONDS + 15,
  script: FOLDERS_SCRIPT,
  parse: parseFolders
}
