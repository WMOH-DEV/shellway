import { platform, homedir } from 'os'
import { join } from 'path'

/** Get the current platform */
export function getPlatform(): NodeJS.Platform {
  return platform()
}

/** Check if running on macOS */
export function isMac(): boolean {
  return platform() === 'darwin'
}

/** Check if running on Windows */
export function isWindows(): boolean {
  return platform() === 'win32'
}

/** Get the default SSH key directory */
export function getSSHDirectory(): string {
  return join(homedir(), '.ssh')
}

/** Get user's home directory */
export function getHomeDirectory(): string {
  return homedir()
}
