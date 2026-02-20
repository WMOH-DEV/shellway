import { useState } from 'react'
import {
  File,
  Folder,
  FolderOpen,
  Link2,
  FileCode,
  FileImage,
  FileArchive,
  FileText,
  FileJson,
  Database,
  KeyRound
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatFileSize } from '@/utils/fileSize'
import { permissionsToString, permissionsToOctal } from '@/utils/permissions'
import { getFileColor } from '@/utils/fileIcons'
import type { FileEntry, PanelType } from '@/types/sftp'

interface FileRowProps {
  entry: FileEntry
  panelType: PanelType
  isSelected: boolean
  isRenaming: boolean
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function getFileIcon(entry: FileEntry) {
  if (entry.isDirectory) return Folder
  if (entry.isSymlink) return Link2

  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'js': case 'jsx': case 'ts': case 'tsx': case 'py': case 'rb': case 'php':
    case 'go': case 'rs': case 'java': case 'c': case 'cpp': case 'cs': case 'swift':
    case 'sh': case 'bash': case 'html': case 'css': case 'scss':
      return FileCode
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': case 'bmp': case 'ico':
      return FileImage
    case 'zip': case 'tar': case 'gz': case 'rar': case '7z': case 'bz2':
      return FileArchive
    case 'md': case 'txt': case 'log': case 'doc': case 'docx': case 'pdf':
      return FileText
    case 'json': case 'xml': case 'yaml': case 'yml': case 'toml':
      return FileJson
    case 'sql': case 'db': case 'sqlite':
      return Database
    case 'pem': case 'key': case 'crt': case 'cer':
      return KeyRound
    default:
      return File
  }
}

export function FileRow({
  entry,
  panelType,
  isSelected,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onClick,
  onDoubleClick,
  onContextMenu
}: FileRowProps) {
  const Icon = getFileIcon(entry)
  const iconColor = entry.isDirectory ? '#3b82f6' : getFileColor(entry.name)
  const modDate = new Date(entry.modifiedAt)
  const dateStr = entry.modifiedAt > 0
    ? modDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'
  const timeStr = entry.modifiedAt > 0
    ? modDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div
      data-file-row
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/shellway-file',
          JSON.stringify({
            path: entry.path,
            panelType,
            isDirectory: entry.isDirectory,
            name: entry.name,
            size: entry.size
          })
        )
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        'grid grid-cols-[1fr_80px_140px_80px] items-center h-7 px-2 text-xs cursor-pointer group',
        'transition-colors duration-75',
        isSelected
          ? 'bg-nd-accent/15 text-nd-text-primary'
          : 'hover:bg-nd-surface/60 text-nd-text-primary even:bg-nd-bg-tertiary/20'
      )}
    >
      {/* Name */}
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={14} style={{ color: iconColor }} className="shrink-0" />
        {entry.isSymlink && (
          <Link2 size={8} className="text-nd-info absolute ml-2.5 mt-2" />
        )}
        {isRenaming ? (
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            className="flex-1 h-5 px-1 rounded bg-nd-surface border border-nd-accent text-xs focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{entry.name}</span>
        )}
      </div>

      {/* Size */}
      <span className="text-nd-text-muted text-right tabular-nums">
        {entry.isDirectory ? '—' : formatFileSize(entry.size)}
      </span>

      {/* Modified */}
      <span className="text-nd-text-muted text-right">
        {dateStr} {timeStr}
      </span>

      {/* Permissions */}
      <span className="text-nd-text-muted text-right font-mono" title={permissionsToOctal(entry.permissions)}>
        {permissionsToString(entry.permissions)}
      </span>
    </div>
  )
}
