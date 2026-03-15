/**
 * Saved Queries Stack — persists query editor content in localStorage.
 *
 * Each SQL connection maintains an ordered stack of saved queries (most recent last).
 * When a new query tab opens, it gets the next unseen saved query in LIFO order.
 * This mimics TablePlus behavior: reopen the app, open a query tab, see your last query.
 */

/** Maximum number of saved queries per connection to prevent localStorage bloat. */
const MAX_SAVED_QUERIES = 50

interface SavedQuery {
  content: string
  savedAt: number
}

function storageKey(connectionId: string): string {
  return `sql-queries:${connectionId}`
}

/** Read the saved queries stack for a connection. */
export function getSavedQueries(connectionId: string): SavedQuery[] {
  try {
    const raw = localStorage.getItem(storageKey(connectionId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function setSavedQueries(connectionId: string, queries: SavedQuery[]): void {
  try {
    // Prune oldest entries if over the cap
    const trimmed = queries.length > MAX_SAVED_QUERIES
      ? queries.slice(queries.length - MAX_SAVED_QUERIES)
      : queries
    localStorage.setItem(storageKey(connectionId), JSON.stringify(trimmed))
  } catch {
    /* storage full or unavailable */
  }
}

/** Save or update a query at a specific index in the stack. */
export function saveQueryAtIndex(connectionId: string, index: number, content: string): void {
  const queries = getSavedQueries(connectionId)
  // Extend the array if needed
  while (queries.length <= index) {
    queries.push({ content: '', savedAt: Date.now() })
  }
  queries[index] = { content, savedAt: Date.now() }
  setSavedQueries(connectionId, queries)
}

/** Append a new query to the stack. Returns the new index. */
export function appendSavedQuery(connectionId: string, content: string): number {
  const queries = getSavedQueries(connectionId)
  queries.push({ content, savedAt: Date.now() })
  setSavedQueries(connectionId, queries)
  return queries.length - 1
}
