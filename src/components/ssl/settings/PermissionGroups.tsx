import { Check, Minus, X } from 'lucide-react'
import type { PermissionGroup, PermissionLine } from '@/types/ssl'
import { groupChipText, groupChipTone, groupMeta, lineMark, permissionExplanation, type LineMark } from '@/utils/ssl/settingsPermissions'
import { StatusChip } from './SettingsCard'

const MARK_ICON = {
  granted: <Check size={13} strokeWidth={2.4} className="text-nd-success-fg" />,
  missing: <X size={13} strokeWidth={2.4} className="text-nd-error-fg" />,
  unchecked: <Minus size={13} strokeWidth={2.4} className="text-nd-text-muted" />
} satisfies Record<LineMark, JSX.Element>

function PermissionRow({ line, showState }: { line: PermissionLine; showState: boolean }) {
  const explanation = showState ? permissionExplanation(line.label, line.state) : null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-nd-text-secondary">
        {showState ? MARK_ICON[lineMark(line.state)] : <Minus size={13} className="text-nd-text-muted" />}
        <span className="font-mono text-xs">{line.label}</span>
      </div>
      {explanation && <span className="pl-[21px] text-2xs text-nd-text-muted">{explanation}</span>}
    </div>
  )
}

function GroupBlock({ group, showState }: { group: PermissionGroup; showState: boolean }) {
  const { title, sub } = groupMeta(group.id)
  return (
    <div className="flex flex-col gap-2 border-b border-nd-border px-3.5 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-nd-text-primary">{title}</span>
        <span className="text-xs text-nd-text-muted">{sub}</span>
        {showState && <StatusChip tone={groupChipTone(group.state)} className="ml-auto">{groupChipText(group.state)}</StatusChip>}
      </div>
      {group.lines.map((line) => <PermissionRow key={line.label} line={line} showState={showState} />)}
    </div>
  )
}

export function PermissionGroups({ groups, showState }: { groups: PermissionGroup[]; showState: boolean }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[10px] border border-nd-border bg-nd-surface">
      {groups.map((group) => <GroupBlock key={group.id} group={group} showState={showState} />)}
    </div>
  )
}
