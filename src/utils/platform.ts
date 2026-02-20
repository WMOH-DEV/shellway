/** Platform detection utilities for renderer process */

let cachedPlatform: NodeJS.Platform | null = null

/** Get the current platform (cached after first call) */
export async function getPlatform(): Promise<NodeJS.Platform> {
  if (cachedPlatform) return cachedPlatform
  cachedPlatform = await window.novadeck.platform.get()
  return cachedPlatform
}

/** Check if running on macOS */
export async function isMac(): Promise<boolean> {
  return (await getPlatform()) === 'darwin'
}

/** Check if running on Windows */
export async function isWindows(): Promise<boolean> {
  return (await getPlatform()) === 'win32'
}

/**
 * Get the modifier key label for the current platform.
 * macOS: ⌘  Windows/Linux: Ctrl
 */
export async function getModKey(): Promise<string> {
  return (await isMac()) ? '⌘' : 'Ctrl'
}
