/**
 * Helpers for detecting and parsing "standalone" mode.
 *
 * A standalone window is a child BrowserWindow created via
 * `window.novadeck.window.openStandalone(...)`. It renders a single feature
 * (e.g. SQL client) without the normal sidebar / workspace chrome.
 *
 * The mode is communicated via URL query params so the renderer bundle can stay
 * a single entrypoint.
 */

export type StandaloneMode = 'sql' | 'monitor' | 'sftp' | 'terminal'

export interface StandaloneConfig {
  mode: StandaloneMode
  sessionId: string
  name: string
  sessionColor?: string
}

/**
 * Parse the current window location for standalone config.
 * Returns `null` if this is the main window (no `?standalone=` param).
 */
export function getStandaloneConfig(): StandaloneConfig | null {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('standalone')
  if (mode !== 'sql' && mode !== 'monitor' && mode !== 'sftp' && mode !== 'terminal') return null

  const sessionId = params.get('sessionId')
  if (!sessionId) return null

  const defaultName =
    mode === 'monitor' ? 'Monitor'
    : mode === 'sftp' ? 'SFTP'
    : mode === 'terminal' ? 'Terminal'
    : 'Database'

  return {
    mode,
    sessionId,
    name: params.get('name') || defaultName,
    sessionColor: params.get('sessionColor') ?? undefined,
  }
}

/**
 * Module-level cache for the standalone handoff promise.
 *
 * The main-process `window:getHandoff` handler is single-use: on the first
 * successful read it deletes the pending-handoff entry. React 18 StrictMode
 * double-invokes mount effects in development, so a naive
 * `window.novadeck.window.getHandoff()` inside a `useEffect` consumes the
 * handoff in the first pass (which then gets cancelled by the cleanup) and
 * receives `null` in the second pass — the real handoff state is lost and
 * the window falls through to a direct-launch fallback. This also affects
 * production double-mounts from hot reload / React concurrent features.
 *
 * Caching the Promise at module scope means both effect passes await the
 * same resolved value, so the second pass still observes the real handoff
 * and stores it in state.
 */
let cachedHandoffPromise: Promise<unknown> | null = null

/**
 * Fetch the pending handoff for this window exactly once per renderer
 * lifetime. Repeat callers receive the same cached Promise — safe to call
 * from StrictMode double-invoked effects without losing the handoff.
 */
export function getStandaloneHandoffOnce<T = unknown>(): Promise<T | null> {
  if (!cachedHandoffPromise) {
    cachedHandoffPromise = window.novadeck.window
      .getHandoff()
      .catch((err) => {
        console.warn('[standalone] handoff fetch failed:', err)
        return null
      })
  }
  return cachedHandoffPromise as Promise<T | null>
}
