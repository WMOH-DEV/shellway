export const ORIGIN_DIR = '/etc/ssl/shellway'
export const BACKUP_DIR = `${ORIGIN_DIR}/backups`
export const UNDONE_DIR = `${BACKUP_DIR}/undone`

export interface OriginPaths {
  keyPath: string
  certPath: string
  backupPath: string
}

export const isShellwayCertPath = (path: string): boolean => path.startsWith(`${ORIGIN_DIR}/`)

const LIVE_PATH = /^\/etc\/letsencrypt\/live\/([A-Za-z0-9][A-Za-z0-9._-]*)\//

export function lineageOfPaths(certPath: string, keyPath: string): string | null {
  const cert = LIVE_PATH.exec(certPath)?.[1]
  return cert !== undefined && LIVE_PATH.exec(keyPath)?.[1] === cert ? cert : null
}

export function originPaths(firstName: string, epochSeconds: number): OriginPaths {
  const stem = `${firstName}-${epochSeconds}`
  return { keyPath: `${ORIGIN_DIR}/${stem}.key`, certPath: `${ORIGIN_DIR}/${stem}.pem`, backupPath: `${BACKUP_DIR}/${stem}.conf` }
}

export const undonePath = (firstName: string, epochSeconds: number): string => `${UNDONE_DIR}/${firstName}-${epochSeconds}.conf`

export const backupGlob = (firstName: string): string => `${BACKUP_DIR}/${firstName}-[0-9]*.conf`

export function newestBackup(listing: string, firstName: string): string | null {
  const pattern = new RegExp(`^${BACKUP_DIR}/${firstName.replace(/[.]/g, '\\.')}-(\\d{10,})\\.conf$`)
  const found = listing.split('\n').map((line) => line.trim()).flatMap((line) => {
    const match = pattern.exec(line)
    return match ? [{ line, epoch: Number(match[1]) }] : []
  })
  return found.sort((a, b) => b.epoch - a.epoch)[0]?.line ?? null
}
