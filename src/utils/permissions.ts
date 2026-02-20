/**
 * Convert numeric permission to rwxrwxrwx string.
 */
export function permissionsToString(mode: number): string {
  const bits = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-'
  ]
  return bits.join('')
}

/**
 * Convert numeric permission to octal string (e.g., "755").
 */
export function permissionsToOctal(mode: number): string {
  return mode.toString(8).padStart(3, '0')
}

/**
 * Parse an octal string to numeric permission.
 */
export function octalToPermissions(octal: string): number {
  return parseInt(octal, 8)
}

/**
 * Get permission bits for a specific role.
 */
export function getPermBits(mode: number, role: 'owner' | 'group' | 'other'): { r: boolean; w: boolean; x: boolean } {
  const shift = role === 'owner' ? 6 : role === 'group' ? 3 : 0
  return {
    r: ((mode >> shift) & 4) !== 0,
    w: ((mode >> shift) & 2) !== 0,
    x: ((mode >> shift) & 1) !== 0
  }
}

/**
 * Set permission bits for a specific role.
 */
export function setPermBits(
  mode: number,
  role: 'owner' | 'group' | 'other',
  bits: { r: boolean; w: boolean; x: boolean }
): number {
  const shift = role === 'owner' ? 6 : role === 'group' ? 3 : 0
  const mask = 7 << shift
  const value = ((bits.r ? 4 : 0) | (bits.w ? 2 : 0) | (bits.x ? 1 : 0)) << shift
  return (mode & ~mask) | value
}
