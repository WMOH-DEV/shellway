/** A file or directory entry in SFTP */
export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modifiedAt: number
  accessedAt: number
  permissions: number  // octal, e.g. 0o755
  owner: number
  group: number
  symlinkTarget?: string
}

/** Sort field for file browser */
export type SortField = 'name' | 'size' | 'modifiedAt' | 'permissions'

/** Sort direction */
export type SortDirection = 'asc' | 'desc'

/** File panel type */
export type PanelType = 'local' | 'remote'

/** View mode */
export type ViewMode = 'list' | 'grid'

/** Clipboard operation */
export interface ClipboardState {
  operation: 'copy' | 'cut'
  files: FileEntry[]
  sourcePanel: PanelType
  sourcePath: string
}
