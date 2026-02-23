import { useState, useEffect, useMemo } from 'react'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useKeybindingStore } from '@/stores/keybindingStore'
import { KEYBINDING_ACTIONS, SCOPE_LABELS } from '@/types/keybindings'
import type { KeybindingScope, KeybindingAction } from '@/types/keybindings'
import { DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import { KeyRecorder } from '@/components/settings/KeyRecorder'
import { Button } from '@/components/ui/Button'

/** Group actions by scope */
const ACTION_GROUPS: { scope: KeybindingScope; actions: KeybindingAction[] }[] = (
  ['global', 'terminal', 'sql'] as KeybindingScope[]
).map((scope) => ({
  scope,
  actions: KEYBINDING_ACTIONS.filter((a) => a.scope === scope),
}))

export function KeybindingsSection() {
  const { bindings, loadBindings, updateBinding, resetAll } = useKeybindingStore()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<KeybindingScope, boolean>>({
    global: false,
    terminal: false,
    sql: false,
  })

  useEffect(() => {
    loadBindings()
  }, [loadBindings])

  const isSearching = search.trim().length > 0
  const searchLower = search.toLowerCase()

  // Filtered groups based on search
  const filteredGroups = useMemo(() => {
    if (!isSearching) return ACTION_GROUPS
    return ACTION_GROUPS.map((group) => ({
      ...group,
      actions: group.actions.filter((a) =>
        a.label.toLowerCase().includes(searchLower)
      ),
    })).filter((group) => group.actions.length > 0)
  }, [isSearching, searchLower])

  // Detect conflicts: duplicate combos in the same scope (blocking) or cross-scope (warning)
  const getConflict = (actionId: string, combo: string, _scope: KeybindingScope): { actionLabel: string; scope: string } | null => {
    // Check same-scope first (higher priority), then cross-scope
    for (const action of KEYBINDING_ACTIONS) {
      if (action.id === actionId) continue
      if (bindings[action.id] === combo) {
        return { actionLabel: action.label, scope: SCOPE_LABELS[action.scope] }
      }
    }
    return null
  }

  const toggleGroup = (scope: KeybindingScope) => {
    if (isSearching) return
    setCollapsed((prev) => ({ ...prev, [scope]: !prev[scope] }))
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search shortcuts..."
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-nd-surface border border-nd-border rounded-md text-nd-text-primary placeholder:text-nd-text-muted outline-none focus:border-nd-accent transition-colors"
        />
      </div>

      {/* Scope groups */}
      <div className="flex flex-col gap-3">
        {filteredGroups.map(({ scope, actions }) => {
          const isOpen = isSearching || !collapsed[scope]

          return (
            <div key={scope}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(scope)}
                className={cn(
                  'flex items-center gap-1.5 w-full text-xs font-semibold text-nd-text-secondary py-1.5 transition-colors',
                  !isSearching && 'hover:text-nd-text-primary cursor-pointer',
                  isSearching && 'cursor-default'
                )}
              >
                {isOpen
                  ? <ChevronDown size={12} className="shrink-0" />
                  : <ChevronRight size={12} className="shrink-0" />
                }
                {SCOPE_LABELS[scope]}
                <span className="text-nd-text-muted font-normal">({actions.length})</span>
              </button>

              {/* Action rows */}
              {isOpen && (
                <div className="flex flex-col ml-0.5 mt-0.5">
                  {actions.map((action) => (
                    <div
                      key={action.id}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-nd-surface/50 transition-colors"
                    >
                      <span className="text-xs text-nd-text-primary">{action.label}</span>
                      <KeyRecorder
                        value={bindings[action.id] ?? action.defaultCombo}
                        defaultValue={action.defaultCombo}
                        onChange={(combo) => updateBinding(action.id, combo)}
                        conflict={getConflict(action.id, bindings[action.id] ?? action.defaultCombo, action.scope)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Reset All */}
      <div className="pt-3 border-t border-nd-border">
        <Button variant="outline" size="sm" onClick={resetAll}>
          Reset All to Defaults
        </Button>
      </div>
    </div>
  )
}
