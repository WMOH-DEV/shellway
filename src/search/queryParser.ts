import type { ScopeId, SearchPrefix } from './types'

export const PREFIX_SCOPES: Record<SearchPrefix, ScopeId> = {
  '>': 'commands',
  '@': 'servers',
  '#': 'tables',
  '/': 'files',
  '?': 'files'
}

export const PREFIX_LABELS: Record<SearchPrefix, string> = {
  '>': 'commands',
  '@': 'servers',
  '#': 'tables',
  '/': 'files',
  '?': 'text in files'
}

export interface ParsedInput {
  text: string
  prefix: SearchPrefix | null
  scope: ScopeId
}

function isPrefix(char: string): char is SearchPrefix {
  return char in PREFIX_SCOPES
}

export function parseInput(raw: string, chipScope: ScopeId): ParsedInput {
  const first = raw.charAt(0)
  if (!isPrefix(first)) return { text: raw.trim(), prefix: null, scope: chipScope }
  return { text: raw.slice(1).trim(), prefix: first, scope: PREFIX_SCOPES[first] }
}
