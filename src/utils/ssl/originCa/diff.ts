import type { DiffLine } from '../../../types/ssl'

const CONTEXT_LINES = 3
const MAX_TABLE_CELLS = 4_000_000

export function splitLines(text: string): string[] {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''))
  if (text.endsWith('\n')) lines.pop()
  return lines
}

function commonLength(a: string[], b: string[], fromEnd: boolean, limit: number): number {
  let count = 0
  while (count < limit && (fromEnd ? a[a.length - 1 - count] === b[b.length - 1 - count] : a[count] === b[count])) count++
  return count
}

function lcsTable(a: string[], b: string[]): Uint32Array {
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  return table
}

function replaceAll(a: string[], b: string[], offset: number): DiffLine[] {
  return [
    ...a.map((text, index): DiffLine => ({ kind: 'remove', oldLine: offset + index + 1, newLine: null, text })),
    ...b.map((text, index): DiffLine => ({ kind: 'add', oldLine: null, newLine: offset + index + 1, text }))
  ]
}

function diffMiddle(a: string[], b: string[], offset: number): DiffLine[] {
  if ((a.length + 1) * (b.length + 1) > MAX_TABLE_CELLS) return replaceAll(a, b, offset)
  const width = b.length + 1
  const table = lcsTable(a, b)
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', oldLine: offset + i + 1, newLine: offset + j + 1, text: a[i] })
      i++
      j++
    } else if (j >= b.length || (i < a.length && table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      lines.push({ kind: 'remove', oldLine: offset + i + 1, newLine: null, text: a[i] })
      i++
    } else {
      lines.push({ kind: 'add', oldLine: null, newLine: offset + j + 1, text: b[j] })
      j++
    }
  }
  return lines
}

function sameLines(lines: string[], oldFirst: number, newFirst: number): DiffLine[] {
  return lines.map((text, index) => ({ kind: 'same', oldLine: oldFirst + index, newLine: newFirst + index, text }))
}

export function lineDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const shortest = Math.min(oldLines.length, newLines.length)
  const prefix = commonLength(oldLines, newLines, false, shortest)
  const suffix = commonLength(oldLines, newLines, true, shortest - prefix)
  const oldEnd = oldLines.length - suffix
  const newEnd = newLines.length - suffix
  return [
    ...sameLines(oldLines.slice(0, prefix), 1, 1),
    ...diffMiddle(oldLines.slice(prefix, oldEnd), newLines.slice(prefix, newEnd), prefix),
    ...sameLines(oldLines.slice(oldEnd), oldEnd + 1, newEnd + 1)
  ]
}

export function withContext(lines: DiffLine[]): DiffLine[] {
  const keep = new Uint8Array(lines.length)
  lines.forEach((line, index) => {
    if (line.kind !== 'same') keep.fill(1, Math.max(0, index - CONTEXT_LINES), index + CONTEXT_LINES + 1)
  })
  return lines.filter((_, index) => keep[index] === 1)
}

export const changedLines = (oldText: string, newText: string): DiffLine[] => withContext(lineDiff(splitLines(oldText), splitLines(newText)))
