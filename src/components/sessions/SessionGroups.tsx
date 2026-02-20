import { useState } from 'react'
import { ChevronRight, ChevronDown, FolderClosed, FolderOpen } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { Session } from '@/types/session'

interface SessionGroupsProps {
  sessions: Session[]
  expandedGroups: Set<string>
  onToggleGroup: (group: string) => void
  renderSession: (session: Session) => React.ReactNode
}

/**
 * Renders sessions organized by their group field.
 * Ungrouped sessions appear at the top.
 */
export function SessionGroups({
  sessions,
  expandedGroups,
  onToggleGroup,
  renderSession
}: SessionGroupsProps) {
  // Split into ungrouped and grouped
  const ungrouped = sessions.filter((s) => !s.group)
  const grouped = new Map<string, Session[]>()

  sessions
    .filter((s) => s.group)
    .forEach((s) => {
      const group = s.group!
      if (!grouped.has(group)) grouped.set(group, [])
      grouped.get(group)!.push(s)
    })

  return (
    <div className="flex flex-col gap-0.5">
      {/* Ungrouped sessions */}
      {ungrouped.map(renderSession)}

      {/* Grouped sessions */}
      {Array.from(grouped.entries()).map(([groupName, groupSessions]) => {
        const isExpanded = expandedGroups.has(groupName)

        return (
          <div key={groupName}>
            <button
              onClick={() => onToggleGroup(groupName)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left hover:bg-nd-surface transition-colors"
            >
              {isExpanded ? (
                <ChevronDown size={12} className="text-nd-text-muted shrink-0" />
              ) : (
                <ChevronRight size={12} className="text-nd-text-muted shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen size={13} className="text-nd-accent shrink-0" />
              ) : (
                <FolderClosed size={13} className="text-nd-text-muted shrink-0" />
              )}
              <span className="text-xs font-medium text-nd-text-secondary truncate flex-1">
                {groupName}
              </span>
              <span className="text-2xs text-nd-text-muted">{groupSessions.length}</span>
            </button>

            {isExpanded && (
              <div className="pl-4 flex flex-col gap-0.5">
                {groupSessions.map(renderSession)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
