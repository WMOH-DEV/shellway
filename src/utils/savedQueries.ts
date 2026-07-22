/**
 * Editor draft stack — remembers unsaved query-tab content between launches.
 *
 * Keyed on the connection's stable scope id (SQLView's `sessionId`). The
 * previous key was the per-tab `connectionId`, which is a fresh uuid on every
 * tab open, so drafts were never restored and every launch orphaned another
 * entry.
 */

const MAX_SAVED_QUERIES = 50
const KEY_PREFIX = 'sql-draft:'
const LEGACY_KEY_PREFIX = 'sql-queries:'

interface SavedQuery {
  content: string
  savedAt: number
}

function storageKey(scopeId: string): string {
  return `${KEY_PREFIX}${scopeId}`
}

/** Remove the orphaned entries written by the old connectionId-keyed scheme. */
export function pruneLegacyDrafts(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(LEGACY_KEY_PREFIX)) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    /* storage unavailable */
  }
}

export function getSavedQueries(scopeId: string): SavedQuery[] {
  if (!scopeId) return []
  try {
    const raw = localStorage.getItem(storageKey(scopeId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function setSavedQueries(scopeId: string, queries: SavedQuery[]): void {
  try {
    const trimmed =
      queries.length > MAX_SAVED_QUERIES
        ? queries.slice(queries.length - MAX_SAVED_QUERIES)
        : queries
    localStorage.setItem(storageKey(scopeId), JSON.stringify(trimmed))
  } catch {
    /* storage full or unavailable */
  }
}

export function saveQueryAtIndex(
  scopeId: string,
  index: number,
  content: string
): void {
  if (!scopeId) return
  const queries = getSavedQueries(scopeId)
  while (queries.length <= index) {
    queries.push({ content: '', savedAt: Date.now() })
  }
  queries[index] = { content, savedAt: Date.now() }
  setSavedQueries(scopeId, queries)
}

export function appendSavedQuery(scopeId: string, content: string): number {
  if (!scopeId) return -1
  const queries = getSavedQueries(scopeId)
  queries.push({ content, savedAt: Date.now() })
  setSavedQueries(scopeId, queries)
  return queries.length - 1
}
