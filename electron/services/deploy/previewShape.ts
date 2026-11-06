import type { ShipFile, ShipPreview } from '../../../src/types/deploy'

export const PREVIEW_COMMIT_CAP = 50
export const PREVIEW_FILE_CAP = 200

export function makeShipPreview(parts: Omit<ShipPreview, 'truncated'>): ShipPreview {
  return {
    ...parts,
    truncated: parts.totalCommits > parts.commits.length || parts.totalFiles > parts.files.length
  }
}

export function isMigrationPath(path: string, migrationsPath: string): boolean {
  const folder = migrationsPath.replace(/\/+$/, '')
  return folder !== '' && path.startsWith(`${folder}/`)
}

export function orderFiles(files: ShipFile[]): ShipFile[] {
  return [...files].sort((a, b) => Number(b.migration) - Number(a.migration))
}
