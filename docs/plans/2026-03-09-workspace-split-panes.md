# Workspace Split Panes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to view two independent connection sessions (SSH or Database) side-by-side in a split workspace, like browser tab groups or IDE split editors.

**Architecture:** Introduce a "pane" layer between the tab bar and the content area. Default is a single pane (zero behavior change). Users can split the workspace into 2 panes via tab context menu or keyboard shortcut. Each pane has its own active tab and tab bar section. The existing `Splitter` component divides the workspace. `ConnectionView` and `DatabaseView` remain unchanged — they're already self-contained.

**Tech Stack:** React + TypeScript + Zustand + Tailwind CSS (existing stack, no new dependencies)

---

## Feature Scope

### What We're Building
1. **Workspace Split** — Split the main content area into 2 independent panes (left/right or top/bottom)
2. **Per-Pane Tab Bars** — Each pane has its own tab bar showing only its assigned tabs
3. **Tab Assignment** — Tabs can be moved between panes via context menu or drag-and-drop (Phase 2)
4. **Pane Focus** — One pane is "focused" at a time; keyboard shortcuts apply to the focused pane
5. **Resizable Divider** — Panes are resizable via the existing `Splitter` component
6. **Close Pane** — Closing a pane moves its tabs back to the remaining pane
7. **Tab Context Menu** — Right-click menu on tabs with: "Split Right", "Split Down", "Move to Other Pane", "Close Tab", "Close Other Tabs"

### What We're NOT Building (YAGNI)
- More than 2 panes (no quad-split, no infinite nesting)
- Drag-and-drop tab reordering between panes (Phase 2 enhancement)
- Pane layout persistence across app restart (Phase 2 — easy to add later)
- Detaching tabs into separate windows

---

## Data Model

### Current State (what exists today)

```typescript
// connectionStore.ts
interface ConnectionState {
  tabs: ConnectionTab[]
  activeTabId: string | null  // ← Single active tab globally
  // ...
}
```

### Target State (what we're building)

```typescript
// connectionStore.ts — new/modified fields
interface Pane {
  id: string
  tabIds: string[]           // Ordered list of tab IDs assigned to this pane
  activeTabId: string | null // Which tab is active within this pane
}

interface ConnectionState {
  tabs: ConnectionTab[]
  
  // ── Pane management (replaces single activeTabId) ──
  panes: Pane[]                           // 1 or 2 panes
  activePaneId: string                    // Which pane has keyboard focus
  splitDirection: 'horizontal' | 'vertical' // How panes are arranged
  
  // ── Computed (backward compat) ──
  activeTabId: string | null              // → computed: activePaneId's activeTabId
  
  // ── New actions ──
  splitPane: (tabId: string, direction: 'horizontal' | 'vertical') => void
  closePane: (paneId: string) => void
  setActivePane: (paneId: string) => void
  moveTabToPane: (tabId: string, targetPaneId: string) => void
  setPaneActiveTab: (paneId: string, tabId: string) => void
}
```

### Key Design Decisions

1. **`activeTabId` remains as a computed getter** — returns `panes.find(p => p.id === activePaneId)?.activeTabId`. This means ALL existing code that reads `activeTabId` continues to work without changes.

2. **Tabs stay in the flat `tabs[]` array** — panes only reference tab IDs. No data duplication.

3. **Default state = 1 pane** — `panes: [{ id: 'main', tabIds: [...all tab IDs...], activeTabId: '...' }]`. Existing behavior preserved.

4. **`addTab` always adds to the active pane** — new connections open in the focused pane.

---

## Task 1: Extend ConnectionStore with Pane Model

**Files:**
- Modify: `src/stores/connectionStore.ts`

### Step 1: Add Pane interface and update ConnectionState

Add the `Pane` interface and new state fields. Keep `activeTabId` as a backward-compatible computed value.

```typescript
// Add above ConnectionState interface
export interface Pane {
  id: string
  tabIds: string[]
  activeTabId: string | null
}

// Add to ConnectionState interface:
  /** Workspace panes — 1 (single view) or 2 (split view) */
  panes: Pane[]
  /** Which pane currently has focus */
  activePaneId: string
  /** How panes are arranged when split */
  splitDirection: 'horizontal' | 'vertical'

  /** Split workspace: move tabId to a new second pane */
  splitPane: (tabId: string, direction: 'horizontal' | 'vertical') => void
  /** Close a pane, moving its tabs to the remaining pane */
  closePane: (paneId: string) => void
  /** Set which pane has keyboard focus */
  setActivePane: (paneId: string) => void
  /** Move a tab from its current pane to a target pane */
  moveTabToPane: (tabId: string, targetPaneId: string) => void
  /** Set the active tab within a specific pane */
  setPaneActiveTab: (paneId: string, tabId: string) => void
```

### Step 2: Initialize default state

```typescript
// Default initial state values:
  panes: [{ id: 'main', tabIds: [], activeTabId: null }],
  activePaneId: 'main',
  splitDirection: 'horizontal',
```

### Step 3: Update `activeTabId` to be derived from panes

Replace the static `activeTabId: null` with a getter pattern. Since Zustand doesn't support native getters, we keep `activeTabId` as a stored value but update it whenever `activePaneId` or a pane's `activeTabId` changes.

Create a helper function:

```typescript
/** Derive the global activeTabId from the focused pane */
function deriveActiveTabId(panes: Pane[], activePaneId: string): string | null {
  const pane = panes.find(p => p.id === activePaneId)
  return pane?.activeTabId ?? null
}
```

### Step 4: Update `addTab` to assign tab to active pane

```typescript
addTab: (tab) =>
  set((state) => {
    const paneIdx = state.panes.findIndex(p => p.id === state.activePaneId)
    const newPanes = state.panes.map((p, i) =>
      i === paneIdx
        ? { ...p, tabIds: [...p.tabIds, tab.id], activeTabId: tab.id }
        : p
    )
    return {
      tabs: [...state.tabs, tab],
      panes: newPanes,
      activeTabId: tab.id
    }
  }),
```

### Step 5: Update `removeTab` to remove from pane

```typescript
removeTab: (id) =>
  set((state) => {
    const newTabs = state.tabs.filter((t) => t.id !== id)
    
    // Remove from whichever pane contains it
    let newPanes = state.panes.map(pane => {
      if (!pane.tabIds.includes(id)) return pane
      const newTabIds = pane.tabIds.filter(tid => tid !== id)
      let newActiveTabId = pane.activeTabId
      if (pane.activeTabId === id) {
        // Pick adjacent tab within this pane
        const idx = pane.tabIds.indexOf(id)
        if (newTabIds.length === 0) {
          newActiveTabId = null
        } else if (idx >= newTabIds.length) {
          newActiveTabId = newTabIds[newTabIds.length - 1]
        } else {
          newActiveTabId = newTabIds[idx]
        }
      }
      return { ...pane, tabIds: newTabIds, activeTabId: newActiveTabId }
    })

    // If a pane becomes empty and there are 2 panes, auto-close the empty pane
    if (newPanes.length === 2) {
      const emptyPane = newPanes.find(p => p.tabIds.length === 0)
      if (emptyPane) {
        const remainingPane = newPanes.find(p => p.id !== emptyPane.id)!
        newPanes = [remainingPane]
      }
    }

    const newActivePaneId = newPanes.find(p => p.id === state.activePaneId)?.id ?? newPanes[0].id
    const newReconnection = new Map(state.reconnectionState)
    newReconnection.delete(id)

    return {
      tabs: newTabs,
      panes: newPanes,
      activePaneId: newActivePaneId,
      activeTabId: deriveActiveTabId(newPanes, newActivePaneId),
      reconnectionState: newReconnection
    }
  }),
```

### Step 6: Update `setActiveTab` to update the correct pane

```typescript
setActiveTab: (id) =>
  set((state) => {
    if (id === null) {
      return { activeTabId: null }
    }
    // Find which pane owns this tab
    const pane = state.panes.find(p => p.tabIds.includes(id))
    if (!pane) return { activeTabId: id }
    
    const newPanes = state.panes.map(p =>
      p.id === pane.id ? { ...p, activeTabId: id } : p
    )
    return {
      panes: newPanes,
      activePaneId: pane.id,
      activeTabId: id
    }
  }),
```

### Step 7: Update `closeAllTabs` and `closeOtherTabs`

```typescript
closeAllTabs: () => set({
  tabs: [],
  panes: [{ id: 'main', tabIds: [], activeTabId: null }],
  activePaneId: 'main',
  activeTabId: null,
  reconnectionState: new Map()
}),

closeOtherTabs: (id) =>
  set((state) => {
    const newReconnection = new Map<string, ReconnectionTabState>()
    const existing = state.reconnectionState.get(id)
    if (existing) newReconnection.set(id, existing)
    
    // Keep only the tab in the active pane, collapse to single pane
    return {
      tabs: state.tabs.filter((t) => t.id === id),
      panes: [{ id: 'main', tabIds: [id], activeTabId: id }],
      activePaneId: 'main',
      activeTabId: id,
      reconnectionState: newReconnection
    }
  }),
```

### Step 8: Implement new pane actions

```typescript
splitPane: (tabId, direction) =>
  set((state) => {
    // Already split? Move tab to the other pane instead
    if (state.panes.length >= 2) {
      const currentPane = state.panes.find(p => p.tabIds.includes(tabId))
      const otherPane = state.panes.find(p => p.id !== currentPane?.id)
      if (!currentPane || !otherPane) return {}
      if (currentPane.tabIds.length <= 1) return {} // Can't leave a pane empty
      
      const newCurrentTabIds = currentPane.tabIds.filter(id => id !== tabId)
      const newCurrentActive = currentPane.activeTabId === tabId
        ? newCurrentTabIds[0] ?? null
        : currentPane.activeTabId
      
      return {
        panes: state.panes.map(p => {
          if (p.id === currentPane.id) return { ...p, tabIds: newCurrentTabIds, activeTabId: newCurrentActive }
          if (p.id === otherPane.id) return { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId }
          return p
        }),
        splitDirection: direction,
        activePaneId: otherPane.id,
        activeTabId: tabId
      }
    }

    // Create new pane with the tab
    const currentPane = state.panes[0]
    if (currentPane.tabIds.length <= 1) return {} // Need at least 2 tabs to split
    
    const newPaneId = crypto.randomUUID()
    const newCurrentTabIds = currentPane.tabIds.filter(id => id !== tabId)
    const newCurrentActive = currentPane.activeTabId === tabId
      ? newCurrentTabIds[0] ?? null
      : currentPane.activeTabId

    return {
      panes: [
        { ...currentPane, tabIds: newCurrentTabIds, activeTabId: newCurrentActive },
        { id: newPaneId, tabIds: [tabId], activeTabId: tabId }
      ],
      splitDirection: direction,
      activePaneId: newPaneId,
      activeTabId: tabId
    }
  }),

closePane: (paneId) =>
  set((state) => {
    if (state.panes.length <= 1) return {} // Can't close the only pane
    
    const closingPane = state.panes.find(p => p.id === paneId)
    const remainingPane = state.panes.find(p => p.id !== paneId)
    if (!closingPane || !remainingPane) return {}
    
    // Move all tabs from closing pane to the remaining one
    const mergedTabIds = [...remainingPane.tabIds, ...closingPane.tabIds]
    const mergedPane = {
      ...remainingPane,
      tabIds: mergedTabIds,
      activeTabId: remainingPane.activeTabId
    }
    
    return {
      panes: [mergedPane],
      activePaneId: mergedPane.id,
      activeTabId: mergedPane.activeTabId
    }
  }),

setActivePane: (paneId) =>
  set((state) => {
    const pane = state.panes.find(p => p.id === paneId)
    return {
      activePaneId: paneId,
      activeTabId: pane?.activeTabId ?? null
    }
  }),

moveTabToPane: (tabId, targetPaneId) =>
  set((state) => {
    const sourcePane = state.panes.find(p => p.tabIds.includes(tabId))
    const targetPane = state.panes.find(p => p.id === targetPaneId)
    if (!sourcePane || !targetPane || sourcePane.id === targetPane.id) return {}
    if (sourcePane.tabIds.length <= 1) return {} // Can't leave source pane empty
    
    const newSourceTabIds = sourcePane.tabIds.filter(id => id !== tabId)
    const newSourceActive = sourcePane.activeTabId === tabId
      ? newSourceTabIds[0] ?? null
      : sourcePane.activeTabId

    return {
      panes: state.panes.map(p => {
        if (p.id === sourcePane.id) return { ...p, tabIds: newSourceTabIds, activeTabId: newSourceActive }
        if (p.id === targetPane.id) return { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId }
        return p
      }),
      activePaneId: targetPaneId,
      activeTabId: tabId
    }
  }),

setPaneActiveTab: (paneId, tabId) =>
  set((state) => {
    const newPanes = state.panes.map(p =>
      p.id === paneId ? { ...p, activeTabId: tabId } : p
    )
    const newActiveTabId = paneId === state.activePaneId ? tabId : state.activeTabId
    return { panes: newPanes, activeTabId: newActiveTabId }
  }),
```

### Step 9: Update `reorderTabs` for pane-awareness

```typescript
reorderTabs: (oldIndex, newIndex) =>
  set((state) => {
    // Reorder within the active pane's tabIds
    const pane = state.panes.find(p => p.id === state.activePaneId)
    if (!pane) return {}
    
    const newTabIds = [...pane.tabIds]
    const [moved] = newTabIds.splice(oldIndex, 1)
    newTabIds.splice(newIndex, 0, moved)
    
    return {
      panes: state.panes.map(p =>
        p.id === pane.id ? { ...p, tabIds: newTabIds } : p
      )
    }
  }),
```

### Step 10: Verify with typecheck

Run: `npm run typecheck`
Expected: No new errors (existing code reads `activeTabId` which still exists)

### Step 11: Commit

```bash
git add src/stores/connectionStore.ts
git commit -m "feat: add pane model to connection store for workspace split"
```

---

## Task 2: Create Tab Context Menu Component

**Files:**
- Create: `src/components/layout/TabContextMenu.tsx`

### Step 1: Create the context menu component

This component renders a right-click menu for tabs. It uses absolute positioning anchored to the click coordinates.

```typescript
import { useEffect, useRef, useCallback } from 'react'
import {
  Columns, Rows, ArrowRightLeft, X, XCircle, PanelRight
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'

interface TabContextMenuProps {
  tabId: string
  x: number
  y: number
  onClose: () => void
}

export function TabContextMenu({ tabId, x, y, onClose }: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { panes, activePaneId, splitPane, moveTabToPane, removeTab, closeOtherTabs } =
    useConnectionStore()

  const isSplit = panes.length >= 2
  const currentPane = panes.find(p => p.tabIds.includes(tabId))
  const otherPane = panes.find(p => p.id !== currentPane?.id)
  const canSplit = !isSplit && panes[0]?.tabIds.length >= 2
  const canMoveToOther = isSplit && currentPane && currentPane.tabIds.length > 1

  // Close on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Clamp position to viewport
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${window.innerWidth - rect.width - 8}px`
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${window.innerHeight - rect.height - 8}px`
    }
  }, [])

  const items: Array<{
    label: string
    icon: React.ReactNode
    action: () => void
    disabled?: boolean
    separator?: boolean
  }> = []

  if (!isSplit) {
    items.push({
      label: 'Split Right',
      icon: <Columns size={14} />,
      action: () => { splitPane(tabId, 'horizontal'); onClose() },
      disabled: !canSplit
    })
    items.push({
      label: 'Split Down',
      icon: <Rows size={14} />,
      action: () => { splitPane(tabId, 'vertical'); onClose() },
      disabled: !canSplit
    })
  } else {
    items.push({
      label: 'Move to Other Pane',
      icon: <ArrowRightLeft size={14} />,
      action: () => {
        if (otherPane) moveTabToPane(tabId, otherPane.id)
        onClose()
      },
      disabled: !canMoveToOther
    })
  }

  items.push({ label: '', icon: null, action: () => {}, separator: true })

  items.push({
    label: 'Close Tab',
    icon: <X size={14} />,
    action: () => { removeTab(tabId); onClose() }
  })

  items.push({
    label: 'Close Other Tabs',
    icon: <XCircle size={14} />,
    action: () => { closeOtherTabs(tabId); onClose() }
  })

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-nd-bg-secondary border border-nd-border rounded-lg shadow-xl py-1 min-w-[180px] animate-fade-in"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="h-px bg-nd-border my-1 mx-2" />
        ) : (
          <button
            key={i}
            onClick={item.action}
            disabled={item.disabled}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-nd-text-secondary transition-colors',
              item.disabled
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-nd-surface hover:text-nd-text-primary'
            )}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
```

### Step 2: Verify with typecheck

Run: `npm run typecheck`
Expected: PASS

### Step 3: Commit

```bash
git add src/components/layout/TabContextMenu.tsx
git commit -m "feat: add tab context menu with split/move/close actions"
```

---

## Task 3: Create PaneTabBar Component

**Files:**
- Create: `src/components/layout/PaneTabBar.tsx`

This is a variant of `TabBar` that renders tabs for a single pane. It replaces the monolithic `TabBar` when the workspace is split.

### Step 1: Create PaneTabBar

```typescript
import { useRef, useState, useCallback } from 'react'
import { X, RotateCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'
import { Tooltip } from '@/components/ui/Tooltip'
import { TabContextMenu } from './TabContextMenu'
import type { Pane } from '@/stores/connectionStore'

interface PaneTabBarProps {
  pane: Pane
  isFocused: boolean
  onFocus: () => void
}

export function PaneTabBar({ pane, isFocused, onFocus }: PaneTabBarProps) {
  const { tabs, setPaneActiveTab, removeTab } = useConnectionStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)

  const paneTabs = pane.tabIds
    .map(id => tabs.find(t => t.id === id))
    .filter(Boolean) as typeof tabs

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' })
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    onFocus()
    setContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }, [onFocus])

  if (paneTabs.length === 0) return null

  return (
    <>
      <div
        className={cn(
          'relative flex items-end h-[36px] bg-nd-bg-primary shrink-0 select-none',
          isFocused && 'ring-1 ring-inset ring-nd-accent/30'
        )}
        onClick={onFocus}
      >
        {paneTabs.length > 6 && (
          <button
            onClick={() => scroll('left')}
            className="shrink-0 px-1 h-full flex items-center text-nd-text-muted hover:text-nd-text-primary transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
        )}

        <div ref={scrollRef} className="flex-1 flex items-end overflow-x-auto scrollbar-none">
          {paneTabs.map((tab) => {
            const isActive = tab.id === pane.activeTabId
            const isDisconnected = tab.status === 'disconnected' || tab.status === 'error'

            return (
              <div
                key={tab.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onFocus()
                  setPaneActiveTab(pane.id, tab.id)
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    removeTab(tab.id)
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                className={cn(
                  'group relative flex items-center gap-2 px-3 min-w-[130px] max-w-[200px] cursor-pointer',
                  'transition-all duration-100 shrink-0',
                  isActive
                    ? 'h-[36px] bg-nd-bg-tertiary border-t-2 border-t-nd-accent border-x border-x-nd-border'
                    : 'h-[32px] bg-nd-bg-secondary hover:bg-nd-bg-tertiary/60 border-t-2 border-t-transparent border-r border-r-nd-border/40',
                )}
              >
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-nd-bg-tertiary" />
                )}
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    tab.status === 'connected' && 'bg-nd-success',
                    tab.status === 'connecting' && 'bg-nd-warning animate-pulse',
                    tab.status === 'authenticating' && 'bg-nd-warning animate-pulse',
                    tab.status === 'reconnecting' && 'bg-nd-info animate-pulse',
                    isDisconnected && 'bg-nd-text-muted'
                  )}
                  style={tab.sessionColor && tab.status === 'connected' ? { backgroundColor: tab.sessionColor } : {}}
                />
                <span className={cn(
                  'text-xs truncate flex-1',
                  isActive ? 'text-nd-text-primary font-medium' : 'text-nd-text-secondary'
                )}>
                  {tab.sessionName}
                </span>
                {isDisconnected && (
                  <Tooltip content="Reconnect">
                    <button
                      onClick={(e) => { e.stopPropagation() }}
                      className="text-nd-text-muted hover:text-nd-accent transition-colors"
                    >
                      <RotateCw size={11} />
                    </button>
                  </Tooltip>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); removeTab(tab.id) }}
                  className={cn(
                    'shrink-0 p-0.5 rounded transition-all',
                    isActive
                      ? 'text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface'
                      : 'text-nd-text-muted opacity-0 group-hover:opacity-100 hover:text-nd-text-primary hover:bg-nd-surface'
                  )}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>

        {paneTabs.length > 6 && (
          <button
            onClick={() => scroll('right')}
            className="shrink-0 px-1 h-full flex items-center text-nd-text-muted hover:text-nd-text-primary transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        )}

        <div className="absolute bottom-0 left-0 right-0 h-px bg-nd-border pointer-events-none" style={{ zIndex: 0 }} />
      </div>

      {contextMenu && (
        <TabContextMenu
          tabId={contextMenu.tabId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
```

### Step 2: Verify with typecheck

Run: `npm run typecheck`
Expected: PASS

### Step 3: Commit

```bash
git add src/components/layout/PaneTabBar.tsx
git commit -m "feat: add per-pane tab bar component"
```

---

## Task 4: Create WorkspaceLayout Component

**Files:**
- Create: `src/components/layout/WorkspaceLayout.tsx`

This is the orchestrator component that renders 1 or 2 panes with their respective tab bars and content areas.

### Step 1: Create WorkspaceLayout

```typescript
import { useCallback } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'
import { Splitter } from '@/components/ui/Splitter'
import { PaneTabBar } from './PaneTabBar'
import { ConnectionView } from '@/components/ConnectionView'
import { DatabaseView } from '@/components/DatabaseView'
import { Tooltip } from '@/components/ui/Tooltip'

/**
 * Workspace layout manager — renders 1 or 2 panes.
 * Each pane has its own tab bar and content area.
 * All connection tabs remain rendered in the DOM (hidden via CSS) to preserve state.
 */
export function WorkspaceLayout() {
  const { tabs, panes, activePaneId, splitDirection, setActivePane, closePane } =
    useConnectionStore()

  /** Render a single pane's content area */
  const renderPaneContent = useCallback((paneId: string, paneActiveTabId: string | null) => {
    return (
      <div className="flex-1 overflow-hidden relative">
        {tabs.map((tab) => {
          // Only render tabs belonging to this pane — but keep ALL pane tabs in DOM
          const pane = panes.find(p => p.id === paneId)
          if (!pane?.tabIds.includes(tab.id)) return null

          const isVisible = tab.id === paneActiveTabId
          return (
            <div
              key={`${paneId}-${tab.id}`}
              className={cn('h-full', !isVisible && 'hidden')}
            >
              {tab.type === 'database' ? (
                <DatabaseView tab={tab} />
              ) : (
                <ConnectionView tab={tab} />
              )}
            </div>
          )
        })}
      </div>
    )
  }, [tabs, panes])

  /** Render a complete pane (tab bar + content) */
  const renderPane = useCallback((paneId: string) => {
    const pane = panes.find(p => p.id === paneId)
    if (!pane) return null
    const isFocused = paneId === activePaneId
    const isSplit = panes.length >= 2

    return (
      <div
        className={cn(
          'flex flex-col h-full overflow-hidden',
          isFocused && isSplit && 'ring-1 ring-inset ring-nd-accent/20 rounded-sm'
        )}
        onClick={() => setActivePane(paneId)}
      >
        <div className="relative flex items-center">
          <div className="flex-1">
            <PaneTabBar
              pane={pane}
              isFocused={isFocused}
              onFocus={() => setActivePane(paneId)}
            />
          </div>
          {/* Close pane button — only visible when split */}
          {isSplit && (
            <Tooltip content="Close Pane">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closePane(paneId)
                }}
                className="shrink-0 h-[36px] px-2 flex items-center text-nd-text-muted hover:text-nd-danger hover:bg-nd-surface/60 transition-colors"
              >
                <X size={14} />
              </button>
            </Tooltip>
          )}
        </div>
        {renderPaneContent(paneId, pane.activeTabId)}
      </div>
    )
  }, [panes, activePaneId, setActivePane, closePane, renderPaneContent])

  // Single pane — render directly
  if (panes.length === 1) {
    return renderPane(panes[0].id)
  }

  // Two panes — use Splitter
  return (
    <Splitter
      direction={splitDirection}
      defaultSplit={50}
      minSize={300}
      left={renderPane(panes[0].id)!}
      right={renderPane(panes[1].id)!}
      className="h-full"
    />
  )
}
```

**IMPORTANT NOTE:** The current `App.tsx` renders `ConnectionView` and `DatabaseView` directly and wraps them in a `hidden` div. This component replaces that rendering — but there's a subtle problem: we must NOT render the same `ConnectionView` or `DatabaseView` twice (once in old code, once in WorkspaceLayout). Task 5 handles migrating `App.tsx`.

Also note: in the current architecture, ALL tabs are always rendered. In WorkspaceLayout, only tabs belonging to a pane are rendered within that pane's content area. Since every tab belongs to exactly one pane, there's no duplication — just distribution.

### Step 2: Verify with typecheck

Run: `npm run typecheck`
Expected: PASS

### Step 3: Commit

```bash
git add src/components/layout/WorkspaceLayout.tsx
git commit -m "feat: add workspace layout component with split pane support"
```

---

## Task 5: Migrate App.tsx to Use WorkspaceLayout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/AppShell.tsx`

### Step 1: Replace tab rendering in App.tsx

The current `App.tsx` has this rendering loop (lines 304-316):

```tsx
{/* Render ALL connection tabs — hide inactive via CSS to preserve state */}
{tabs.map((tab) => (
  <div
    key={tab.id}
    className={cn('h-full', tab.id !== activeTabId && 'hidden')}
  >
    {tab.type === 'database' ? (
      <DatabaseView tab={tab} />
    ) : (
      <ConnectionView tab={tab} />
    )}
  </div>
))}
```

Replace this entire block with:

```tsx
{/* Workspace: renders all connection tabs via pane layout */}
{tabs.length > 0 && <WorkspaceLayout />}
```

Add the import at the top:

```typescript
import { WorkspaceLayout } from '@/components/layout/WorkspaceLayout'
```

Also update the welcome screen condition — it should check `tabs.length === 0` (which it already does).

### Step 2: Update AppShell to remove the old TabBar

Currently, `AppShell.tsx` renders `<main className="flex-1 overflow-hidden">{children}</main>`.

The `TabBar` is likely rendered somewhere in the layout. Check where it is rendered and determine if we need to remove it from there (since `WorkspaceLayout` now handles tab bars via `PaneTabBar`).

Looking at the code: `TabBar` is NOT rendered in `AppShell.tsx` — it must be rendered elsewhere. Search for it:

```bash
grep -r "TabBar" src/components/ --include="*.tsx" -l
```

Find where `TabBar` is imported and rendered. The old `TabBar` needs to be replaced by the pane-aware `PaneTabBar` (already handled by `WorkspaceLayout`). Remove the old `TabBar` import/usage from wherever it's used.

**Note:** The old `TabBar.tsx` file should be kept but refactored — OR we remove it entirely and let `PaneTabBar` handle everything. Since `PaneTabBar` already includes all TabBar functionality plus pane-awareness, remove the old `TabBar` usage.

### Step 3: Handle the "disconnected session preview" edge case

The disconnected preview (`showDisconnectedPreview`) needs to still work. It should render in the active pane when no tabs are open in that pane, or below the tab bar when no tabs exist. Keep the existing logic — it renders when `!tabs.find(t => t.sessionId === selectedSessionId)` and is hidden when `activeTabId` is set.

### Step 4: Verify with typecheck

Run: `npm run typecheck`
Expected: PASS

### Step 5: Verify visually

Run: `npm run dev`

1. Open the app — should show WelcomeScreen (no tabs)
2. Connect to a session — should show tab bar + connection view (single pane, identical to before)
3. Open a second tab — should show 2 tabs in tab bar
4. Everything should work exactly as before (no split yet — just single pane)

### Step 6: Commit

```bash
git add src/App.tsx src/components/layout/AppShell.tsx
git commit -m "feat: migrate App.tsx to WorkspaceLayout for pane-based rendering"
```

---

## Task 6: Add Context Menu to TabBar (Backward Compat for Single Pane)

**Files:**
- Modify: `src/components/layout/TabBar.tsx` (if still used) OR confirm `PaneTabBar` fully replaces it

Since `WorkspaceLayout` uses `PaneTabBar` which already has context menu support, we need to ensure the old `TabBar.tsx` is no longer used anywhere. If it IS still used (e.g., by a component we missed), add context menu to it too.

### Step 1: Search for TabBar usage

```bash
grep -rn "from.*TabBar" src/ --include="*.tsx" --include="*.ts"
```

### Step 2: Replace or remove old TabBar references

If `TabBar` is imported anywhere other than `WorkspaceLayout`, replace those imports with `PaneTabBar` or update the component to render via `WorkspaceLayout`.

### Step 3: Verify

Run: `npm run typecheck && npm run dev`
Expected: No references to old TabBar remain; app renders correctly

### Step 4: Commit

```bash
git commit -m "refactor: remove old TabBar in favor of pane-aware PaneTabBar"
```

---

## Task 7: Add Keyboard Shortcuts for Pane Navigation

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/stores/keybindingStore.ts` (add new binding definitions)

### Step 1: Add keybinding definitions

In `keybindingStore.ts`, add these new default bindings (follow existing pattern):

```typescript
// Pane navigation
'global:focusOtherPane': { key: 'Alt+\\' },       // Toggle focus between panes
'global:splitRight': { key: 'Ctrl+\\' },            // Split active tab right
'global:splitDown': { key: 'Ctrl+Shift+\\' },       // Split active tab down
'global:closePane': { key: 'Ctrl+Shift+W' },        // Close focused pane
```

### Step 2: Add handlers in useKeyboardShortcuts

```typescript
// ── Toggle pane focus ──
if (matchesBinding(e, 'global:focusOtherPane')) {
  e.preventDefault()
  const { panes, activePaneId, setActivePane } = useConnectionStore.getState()
  if (panes.length < 2) return
  const otherPane = panes.find(p => p.id !== activePaneId)
  if (otherPane) setActivePane(otherPane.id)
  return
}

// ── Split right ──
if (matchesBinding(e, 'global:splitRight')) {
  e.preventDefault()
  const { activeTabId, splitPane } = useConnectionStore.getState()
  if (activeTabId) splitPane(activeTabId, 'horizontal')
  return
}

// ── Split down ──
if (matchesBinding(e, 'global:splitDown')) {
  e.preventDefault()
  const { activeTabId, splitPane } = useConnectionStore.getState()
  if (activeTabId) splitPane(activeTabId, 'vertical')
  return
}

// ── Close pane ──
if (matchesBinding(e, 'global:closePane')) {
  e.preventDefault()
  const { panes, activePaneId, closePane } = useConnectionStore.getState()
  if (panes.length >= 2) closePane(activePaneId)
  return
}
```

### Step 3: Verify

Run: `npm run typecheck`
Expected: PASS

### Step 4: Commit

```bash
git add src/hooks/useKeyboardShortcuts.ts src/stores/keybindingStore.ts
git commit -m "feat: add keyboard shortcuts for pane split/focus/close"
```

---

## Task 8: Update StatusBar to Show Pane Context

**Files:**
- Modify: `src/components/layout/StatusBar.tsx`

### Step 1: Show split indicator in status bar

Add a small visual indicator when the workspace is split, showing which pane is focused (e.g., "Pane 1 of 2" or a split icon).

Look at the existing StatusBar and add a section that shows:
- When split: `⊞ Split View (Left focused)` or similar
- When not split: nothing (no clutter)

This is a small quality-of-life addition. Read the StatusBar first to understand its layout, then add a conditional element.

### Step 2: Verify visually

Run: `npm run dev`

### Step 3: Commit

```bash
git add src/components/layout/StatusBar.tsx
git commit -m "feat: show split pane indicator in status bar"
```

---

## Task 9: Handle Edge Cases & Polish

**Files:**
- Modify: `src/stores/connectionStore.ts`
- Modify: `src/components/layout/WorkspaceLayout.tsx`
- Modify: `src/App.tsx`

### Step 1: Handle "last tab in pane closed" → auto-collapse

Already implemented in `removeTab` (Task 1, Step 5). Verify it works:
1. Split into 2 panes
2. Close all tabs in one pane
3. Should auto-collapse back to single pane

### Step 2: Handle "disconnect a tab in a pane"

When a tab disconnects, it shows `DisconnectedSessionView`. This already works within `ConnectionView` — no changes needed. Verify:
1. Split into 2 panes
2. Disconnect one session
3. Should show disconnected view within that pane

### Step 3: Handle "new connection when split"

New connections should open in the focused pane (already handled by `addTab` in Task 1, Step 4). Verify:
1. Split into 2 panes
2. Click the left pane (focus it)
3. Connect to a new session from sidebar
4. New tab should appear in the left pane

### Step 4: Terminal focus when switching panes

When a user clicks a pane, the terminal in that pane should get keyboard focus. The existing `TerminalView` handles this via `isActive` prop + `terminal.focus()`. Verify:
1. Have 2 terminal sessions side-by-side
2. Click the right pane
3. Should be able to type in the right terminal immediately

If terminal focus doesn't work automatically, add a custom event dispatch in `setActivePane` that triggers terminal focus:

```typescript
// In setActivePane, after updating state:
window.dispatchEvent(new CustomEvent('novadeck:pane-focused', { detail: { paneId } }))
```

Then in `TerminalView`, listen for this event and call `terminal.focus()` if the terminal belongs to the focused pane's active tab.

### Step 5: Verify full flow

Run: `npm run dev` and test:
- [ ] Single pane mode works identically to before
- [ ] Right-click tab → "Split Right" creates side-by-side view
- [ ] Right-click tab → "Split Down" creates top/bottom view
- [ ] Each pane has independent tab navigation
- [ ] Middle-click closes tabs within panes
- [ ] Closing last tab in a pane auto-collapses to single pane
- [ ] New connections open in focused pane
- [ ] Keyboard shortcuts work (Alt+\ for pane switch, Ctrl+\ for split)
- [ ] Terminal input goes to the focused pane
- [ ] Splitter is resizable between panes

### Step 6: Run typecheck

Run: `npm run typecheck`
Expected: PASS with no errors

### Step 7: Commit

```bash
git add -A
git commit -m "feat: polish workspace split panes — edge cases and terminal focus"
```

---

## Task 10: Final Typecheck & Lint

**Files:**
- All modified files

### Step 1: Run typecheck

```bash
npm run typecheck
```

Expected: PASS

### Step 2: Run lint

```bash
npm run lint
```

Expected: PASS (or only pre-existing warnings)

### Step 3: Build

```bash
npm run build
```

Expected: Successful build

### Step 4: Final commit if any lint fixes

```bash
git add -A
git commit -m "chore: fix lint issues from workspace split implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Extend connectionStore with pane model | `connectionStore.ts` |
| 2 | Create TabContextMenu component | `TabContextMenu.tsx` (new) |
| 3 | Create PaneTabBar component | `PaneTabBar.tsx` (new) |
| 4 | Create WorkspaceLayout component | `WorkspaceLayout.tsx` (new) |
| 5 | Migrate App.tsx to WorkspaceLayout | `App.tsx`, `AppShell.tsx` |
| 6 | Remove old TabBar references | `TabBar.tsx` cleanup |
| 7 | Keyboard shortcuts for panes | `useKeyboardShortcuts.ts`, `keybindingStore.ts` |
| 8 | StatusBar split indicator | `StatusBar.tsx` |
| 9 | Edge cases & polish | Multiple files |
| 10 | Final typecheck, lint, build | All files |

**Total new files:** 3 (`TabContextMenu.tsx`, `PaneTabBar.tsx`, `WorkspaceLayout.tsx`)
**Total modified files:** ~6 (`connectionStore.ts`, `App.tsx`, `AppShell.tsx`, `useKeyboardShortcuts.ts`, `keybindingStore.ts`, `StatusBar.tsx`)
**Deleted files:** 0 (TabBar.tsx kept for reference or replaced)
**New dependencies:** 0
