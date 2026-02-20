# SQL Client — QA Review

**Reviewer:** QA Agent  
**Date:** 2026-02-20  
**Scope:** Complete SQL client feature (backend, IPC, types, store, UI, utilities)  
**Files reviewed:** 25 files  

---

## CRITICAL (Must Fix Before Shipping)

### C1. Staged Changes Never Generate Valid UPDATE SQL — Data Modification Is Broken

**Files:** `src/components/sql/DataTabView.tsx:346-356`, `src/utils/sqlStatementGenerator.ts:36-52`

`DataTabView.handleCellEdit` creates a `StagedChange` with `column`, `oldValue`, `newValue` fields. But `generateUpdateSQL()` checks for `change.changes` (a `Record<string, { old, new }>` object) and returns empty string `''` if it's missing (line 37: `if (change.type !== 'update' || !change.changes) return ''`).

**Result:** Every inline cell edit is staged but generates empty SQL. When the user clicks "Apply All", nothing happens or empty strings are executed. This means **all inline editing is broken**.

The `StagedChange` also does not populate `primaryKey`, so even if `changes` were populated, the WHERE clause would be empty (line 45: `if (!change.primaryKey) return ''`).

**Fix:** In `DataTabView.handleCellEdit`, build the `changes` object and fetch primary key columns:
```typescript
const change: StagedChange = {
  id: `edit-${table}-${rowIndex}-${field}-${Date.now()}`,
  type: 'update',
  table,
  schema,
  primaryKey: buildPrimaryKeyFromRow(row, primaryKeyColumns), // need to fetch PKs
  changes: { [field]: { old: oldValue, new: newValue } },
  rowData: row as Record<string, unknown>,
}
```

---

### C2. SQL Injection via `SHOW INDEX FROM` with Unescaped Table Name

**File:** `electron/services/SQLService.ts:360`

```typescript
const result = await this.executeQuery(sqlSessionId, `SHOW INDEX FROM \`${table}\``)
```

The `table` parameter is a string that could contain backtick characters (e.g., a table literally named `` foo` ; DROP TABLE users; -- ``). The backtick is not escaped, allowing SQL injection.

Other queries in the same file use parameterized queries (`?` / `$1`), but `SHOW INDEX FROM` doesn't support parameters in MySQL.

**Fix:** Escape backticks in the table name before interpolation:
```typescript
const escaped = table.replace(/`/g, '``')
const result = await this.executeQuery(sqlSessionId, `SHOW INDEX FROM \`${escaped}\``)
```

---

### C3. SQL Injection via `raw_sql` Filter Operator

**File:** `src/utils/sqlFilterBuilder.ts:152-156`

```typescript
case 'raw_sql': {
  if (filter.value.trim()) {
    clauses.push(`(${filter.value.trim()})`)
  }
  break
}
```

User-provided text is injected directly into the WHERE clause without any sanitization. While the UI does show a warning icon (line 192-194 of FilterBar.tsx), this is a direct SQL injection path. A user could type `1=1; DROP TABLE users; --` in the filter value.

**Mitigations needed:**
1. On production databases (`isProduction` flag), **disable raw SQL filters entirely** or require confirmation.
2. Add server-side validation that raw SQL filters can't contain `;`, `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `GRANT`, `REVOKE` statements.
3. At minimum, prevent multiple statements by rejecting input containing `;`.

---

### C4. Single Global SQL Store Corrupts State with Multiple SSH Connections

**File:** `src/stores/sqlStore.ts` (entire file)

`useSQLStore` is a single global Zustand store. When a user has two SSH connections open (e.g., staging and production), and both have SQL panels, they share the same `connectionStatus`, `sqlSessionId`, `tables`, `queryResult`, `stagedChanges`, etc.

**Scenario:**
1. User opens SSH to staging, connects SQL → store populated with staging data
2. User opens SSH to production, connects SQL → **store overwritten** with production data
3. User switches back to staging tab → sees production data, wrong `sqlSessionId`
4. User applies staged changes → **changes execute against wrong database**

This is a **data loss/corruption risk**, especially with the production safety mode.

**Fix:** Key the SQL store by `connectionId`. Either:
- Use a `Map<connectionId, SQLState>` pattern in the store
- Create a store factory that returns a unique store per connection
- Use React context to provide per-connection store instances

---

### C5. Keyboard Shortcut `Cmd+Z` Hijacks Browser/OS Undo

**File:** `src/components/sql/useSQLShortcuts.ts:198-203`

```typescript
if (!e.shiftKey && e.key === 'z') {
  e.preventDefault()
  undoLastChange()
  return
}
```

`Cmd+Z` is universally mapped to undo. This shortcut intercepts it for "undo last staged change" even when the user is typing in a text input, the Monaco editor, or the filter bar. This breaks text editing undo functionality throughout the entire SQL panel.

The shortcut has no check for whether the user is in a text input or the Monaco editor.

**Fix:** Check if the event target is an editable element:
```typescript
if (!e.shiftKey && e.key === 'z') {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || 
      target.closest('.monaco-editor')) {
    return // Let normal undo work
  }
  e.preventDefault()
  undoLastChange()
  return
}
```

---

### C6. Keyboard Shortcuts Dispatch Events That No Component Listens For

**File:** `src/components/sql/useSQLShortcuts.ts:50-54, 59, 115, 124-128, 166, 173, 180, 187`

The shortcuts dispatch `CustomEvent`s (`sql:apply-changes`, `sql:refresh-data`, `sql:run-query`, `sql:focus-filter`, `sql:insert-row`, `sql:toggle-history`, `sql:export`, `sql:escape`) but **no component adds event listeners** for any of these events. 

Verified via grep: zero `addEventListener` calls for any of these event names anywhere in the codebase.

**Result:** `Cmd+Enter` (Run Query), `Cmd+S` (Apply Changes), `Cmd+R` (Refresh), `Cmd+F` (Focus Filter), `Cmd+Shift+I` (Insert Row), `Cmd+H` (History), `Cmd+E` (Export) — none of these shortcuts actually do anything.

**Fix:** Add `useEffect` hooks in the appropriate components (DataTabView, QueryEditor, FilterBar, QueryHistoryPanel, ExportDialog) to listen for these events.

---

## HIGH (Should Fix)

### H1. Keyboard Shortcut Conflicts with Browser/OS Defaults

**File:** `src/components/sql/useSQLShortcuts.ts`

Several shortcuts conflict with important browser/Electron defaults:
- `Cmd+W` (line 157): Closes browser window/tab on macOS. Even in Electron, this is the standard "close window" shortcut.
- `Cmd+T` (line 150): Opens new browser tab. In Electron, may be less critical but still unexpected.
- `Cmd+H` (line 178): Hides the application on macOS.
- `Cmd+R` (line 140): Reloads the page in Electron (dev mode).
- `Cmd+F` (line 164): Browser find-in-page.
- `Cmd+E` (line 185): Spotlight search on macOS.

**Fix:** Use different shortcuts that don't conflict, or only intercept when a non-editable SQL area is focused. Consider prefixing with `Cmd+Shift` for SQL-specific actions.

---

### H2. No `isActive` Gating on useSQLShortcuts — Shortcuts Fire in Wrong Panels

**File:** `src/components/sql/useSQLShortcuts.ts:108-109`

```typescript
if (!isActiveRef.current || !sqlSessionRef.current) return
```

`isActive` is passed as `connectionStatus === 'connected'` from SQLView. But it doesn't check if the SQL sub-tab is actually visible. If the user is on the Terminal sub-tab and presses `Cmd+T`, the SQL shortcut fires instead of terminal's new tab action.

The `mountedPanels` pattern in `ConnectionView.tsx` keeps the SQL view mounted (hidden via CSS), so `useSQLShortcuts` stays active even when the Terminal tab is showing.

**Fix:** Pass a prop that checks both connection status AND active sub-tab:
```typescript
const isSQLActive = connectionStatus === 'connected' && tab.activeSubTab === 'sql'
```

---

### H3. Race Condition: Rapid Table Switching Can Show Stale Data

**File:** `src/components/sql/DataTabView.tsx:154-159`

The abort controller pattern is implemented, but `AbortController.abort()` doesn't actually cancel the IPC call — it only sets a flag. The IPC call to the main process still completes. If the user rapidly clicks 3 tables (A, B, C), all three queries run server-side. The results for table C arrive last (correct), but if table B's response arrives after C's (out of order due to network variance), the `controller.signal.aborted` check on line 187 catches it. However, there's a TOCTOU race between the check on line 187 and the state update on line 195 — if the component re-renders between these two points, the abort ref could be overwritten.

**Mitigation:** The current code is close to correct but would benefit from a query ID approach:
```typescript
const queryId = useRef(0)
// On each new query: const thisQueryId = ++queryId.current
// After response: if (thisQueryId !== queryId.current) return
```

---

### H4. DataTabView `executeQuery` Has `result` in Dependency Array — Causes Re-creation Loop

**File:** `src/components/sql/DataTabView.tsx:241`

```typescript
}, [table, schema, dbType, sqlSessionId, result])
```

`result` is in the `useCallback` dependency array for `executeQuery`. Every time a query completes and `setResult(queryResult)` runs, `result` changes, which recreates `executeQuery`, which is a dependency of `handlePageChange`, `handleSort`, `handleFiltersApply`, etc. This causes unnecessary re-creation of all handler functions on every query.

The `result` dependency is only used for the `skipIfCached` check (line 150), which can use a ref instead.

**Fix:** Remove `result` from the dependency array and use `resultRef.current` for the cache check.

---

### H5. `quoteColumn` in Filter Builder Does Not Escape Injection Characters

**File:** `src/utils/sqlFilterBuilder.ts:8-11`

```typescript
function quoteColumn(column: string, dbType: DatabaseType): string {
  if (dbType === 'mysql') return `\`${column}\``
  return `"${column}"`
}
```

Column names from the filter bar are user-selectable (from a dropdown), but the `__raw_sql__` option bypasses column selection. More importantly, if a column name in the database itself contains backticks or double-quotes, this function doesn't escape them. The `quoteIdentifier` in `sqlStatementGenerator.ts` does escape properly (line 6: `name.replace(/`/g, '``')`), but the one in `sqlFilterBuilder.ts` does not.

**Fix:** Match the escaping pattern from `sqlStatementGenerator.ts`:
```typescript
function quoteColumn(column: string, dbType: DatabaseType): string {
  if (dbType === 'mysql') return `\`${column.replace(/`/g, '``')}\``
  return `"${column.replace(/"/g, '""')}"`
}
```

---

### H6. `quoteIdentifier` in `DataTabView.tsx` Does Not Escape Special Characters

**File:** `src/components/sql/DataTabView.tsx:30-33`

```typescript
function quoteIdentifier(name: string, dbType: DatabaseType): string {
  if (dbType === 'mysql') return `\`${name}\``
  return `"${name}"`
}
```

Same issue as H5 — this local `quoteIdentifier` doesn't escape. There's a proper version in `sqlStatementGenerator.ts`. These should be consolidated into a shared utility.

**Fix:** Export `quoteIdentifier` from `sqlStatementGenerator.ts` and use it everywhere.

---

### H7. Context Menu Uses `window.prompt` — Terrible UX in Desktop App

**File:** `src/components/sql/DataGrid.tsx:173-212`

```typescript
const selected = window.prompt(
  menu.map((m, i) => `${i + 1}. ${m.label}`).join('\n')
)
```

The right-click context menu falls back to `window.prompt()`, which shows a browser-style prompt dialog in an Electron desktop app. This is inappropriate for a "TablePlus-quality" SQL client.

**Fix:** Use Electron's native context menu via IPC, or a custom dropdown menu component.

---

### H8. `SQLConnectDialog` Destructures Full Store — Causes Unnecessary Re-renders

**File:** `src/components/sql/SQLConnectDialog.tsx:73-80`

```typescript
const {
  setConnectionStatus, setConnectionConfig, setCurrentDatabase,
  setSqlSessionId, setTunnelPort, setConnectionError
} = useSQLStore()
```

Destructuring from `useSQLStore()` without a selector subscribes to **all** store state changes. Every table load, filter change, or query result update will re-render this dialog (even when it's closed but mounted).

**Fix:** Use individual selectors:
```typescript
const setConnectionStatus = useSQLStore((s) => s.setConnectionStatus)
const setConnectionConfig = useSQLStore((s) => s.setConnectionConfig)
// ...
```

---

### H9. `clearHistory()` Deletes Favorites Despite UI Saying "Clear non-favorited"

**File:** `src/components/sql/QueryHistoryPanel.tsx:209-213`

```typescript
const handleClearAll = useCallback(() => {
  if (window.confirm('Clear all non-favorited history entries?')) {
    clearHistory()
  }
}, [clearHistory])
```

The confirm dialog says "Clear all non-favorited history entries?" but `clearHistory()` in the store (line 265 of sqlStore.ts) does `set({ history: [] })` — it clears **everything** including favorites.

**Fix:** Filter out favorites before clearing:
```typescript
clearHistory: () => set((state) => ({
  history: state.history.filter(h => h.isFavorite)
})),
```

---

### H10. MySQL `LIMIT`/`OFFSET` Not Parameterized — Potential Integer Injection

**File:** `src/components/sql/DataTabView.tsx:73-74`

```typescript
query += ` LIMIT ${pageSize} OFFSET ${offset}`
```

While `pageSize` and `offset` come from controlled integer inputs, they're interpolated directly into the SQL string for MySQL (Postgres correctly uses parameters). This violates the parameterization pattern used everywhere else.

**Fix:** Use parameterized queries for MySQL too, or validate that the values are strictly positive integers.

---

## MEDIUM (Nice to Fix)

### M1. `(window as any).novadeck.sql.*` — Type Safety Bypass

**Files:** `DataTabView.tsx:180,214`, `QueryEditor.tsx:240`, `SQLConnectDialog.tsx:52,173`, `ExportDialog.tsx:77,89`

Multiple files cast `window` to `any` to access the `novadeck.sql` API. The preload file exports `NovadeckAPI` type, but it's not being used consistently.

**Fix:** Create a typed wrapper or ensure `window.novadeck` is typed globally via a `d.ts` declaration file.

---

### M2. `sql:isConnected` IPC Handler Returns Raw Boolean — Inconsistent Envelope

**File:** `electron/ipc/sql.ipc.ts:136-138`

```typescript
ipcMain.handle('sql:isConnected', (_event, sqlSessionId: string) => {
  return sqlService.isConnected(sqlSessionId)
})
```

Every other SQL IPC handler wraps responses in `{ success: true, data: ... }`, but `isConnected` returns a raw boolean. This inconsistency could cause bugs if a consumer tries to unwrap it.

**Fix:** Wrap in the standard envelope: `return { success: true, data: sqlService.isConnected(sqlSessionId) }` — and update the preload type.

---

### M3. Module-Level Mutable Counter in FilterBar

**File:** `src/components/sql/FilterBar.tsx:271-274`

```typescript
let filterId = 0
function nextFilterId() {
  return `filter-${++filterId}-${Date.now()}`
}
```

Module-level mutable state persists across hot reloads and component remounts. If the user opens SQL, adds filters, disconnects, reconnects — the counter keeps incrementing from where it left off. Not a bug per se, but Date.now() already provides uniqueness, so the counter is redundant.

**Fix:** Use `crypto.randomUUID()` like everywhere else, or remove the counter.

---

### M4. Missing Error State Display When Schema Fetch Fails

**File:** `src/components/sql/SchemaSidebar.tsx:165-178`

```typescript
} catch {
  // Silently fail — the error state is handled at the connection level
}
```

If `getTables` fails (e.g., permission denied, connection dropped), the sidebar shows nothing with no indication of what went wrong. The user sees an empty table list with no error message.

**Fix:** Add local error state and show an error message with a retry button.

---

### M5. `useEffect` Dependencies May Trigger Infinite Fetch Loops in SchemaSidebar

**File:** `src/components/sql/SchemaSidebar.tsx:198-201`

```typescript
useEffect(() => {
  fetchTables()
  fetchDatabases()
}, [fetchTables, fetchDatabases])
```

`fetchDatabases` depends on `currentDatabase` (line 195). When the user switches databases, `currentDatabase` changes → `fetchDatabases` recreates → useEffect fires → `fetchDatabases` runs again → could set databases → could trigger re-render. This is stabilized by the fact that `setDatabases` only updates the `databases` array, not `currentDatabase`. But it's fragile.

**Fix:** Separate the initial fetch from database-change reactions.

---

### M6. Postgres `switchDatabase` Throws But UI Doesn't Handle It

**File:** `electron/services/SQLService.ts:249-251`

```typescript
} else {
  throw new Error('Postgres requires a new connection to switch databases')
}
```

The schema sidebar shows a database selector for Postgres, but switching databases will always fail with this error. The user sees a silent failure.

**Fix:** Either hide the database selector for Postgres connections, or implement reconnection with the new database.

---

### M7. Query Editor Monaco Keybindings Create Stale Closures

**File:** `src/components/sql/QueryEditor.tsx:342-358`

```typescript
editor.addAction({
  id: 'sql-run-query',
  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
  run: () => handleRun(),
})
```

`handleRun` and `handleRunSelected` are in the dependency array of `handleEditorMount`, but Monaco editor actions are registered once on mount. If the editor doesn't remount when these callbacks change (which it shouldn't), the actions will always call the initial closures. Since `handleRun` depends on `executeQuery` which depends on `sqlSessionId`, this could be stale if `sqlSessionId` changes.

**Fix:** Use refs for the callbacks:
```typescript
const handleRunRef = useRef(handleRun)
handleRunRef.current = handleRun
// In addAction: run: () => handleRunRef.current()
```

---

### M8. Large Result Sets Copied to Clipboard Without Size Check

**File:** `src/components/sql/DataGrid.tsx:193-197`

```typescript
label: 'Copy Row',
action: () => {
  if (rowData) {
    navigator.clipboard.writeText(JSON.stringify(rowData, null, 2))
  }
},
```

If a row contains large BLOB/TEXT columns, `JSON.stringify` could produce a very large string. No size limit is checked before copying to clipboard.

**Fix:** Add a size check and truncate or warn if the content is too large.

---

### M9. VirtualList in QueryHistoryPanel Has Fixed Item Height Assumption

**File:** `src/components/sql/QueryHistoryPanel.tsx:126-127`

```typescript
const ITEM_HEIGHT = 80 // approximate px per history item
```

History items have variable height due to `line-clamp-3` on queries of different lengths. Using a fixed height estimate causes scroll position misalignment, items overlapping, and visible gaps.

**Fix:** Use a proper virtual list library (like `react-virtuoso` or `@tanstack/react-virtual`) that handles variable heights.

---

### M10. `onCellEdit` Callback Not Properly Memoized in DataGrid

**File:** `src/components/sql/DataGrid.tsx:123-126`

```typescript
if (onCellEdit) {
  col.editable = true
}
```

When `onCellEdit` is provided, all columns are editable — including auto-increment primary keys, computed columns, and views. This could lead to confusing errors when the user tries to edit an uneditable column.

**Fix:** Check column metadata (isPrimaryKey + isAutoIncrement, or table type = view) and only enable editing on appropriate columns.

---

### M11. Connection Cleanup Race on Fast Reconnect

**File:** `electron/services/SQLService.ts:48-49`

```typescript
await this.disconnect(sqlSessionId).catch(() => {})
```

The `disconnect` call is awaited before creating a new connection. But `.catch(() => {})` swallows all errors silently. If the previous connection's `end()` hangs indefinitely (e.g., the SSH tunnel is dead), the new connection attempt will be blocked forever.

**Fix:** Add a timeout to the disconnect call:
```typescript
await Promise.race([
  this.disconnect(sqlSessionId),
  new Promise(resolve => setTimeout(resolve, 3000))
]).catch(() => {})
```

---

## LOW (Suggestions)

### L1. Consolidate `quoteIdentifier` Functions

Three separate implementations exist:
- `electron/services/SQLService.ts` — none (uses template literals)
- `src/components/sql/DataTabView.tsx:30-33` — no escaping
- `src/utils/sqlStatementGenerator.ts:5-8` — proper escaping
- `src/utils/sqlExport.ts:87-90` — proper escaping
- `src/utils/sqlFilterBuilder.ts:8-11` — no escaping

**Suggestion:** Create a single `src/utils/sqlIdentifiers.ts` with properly escaping `quoteIdentifier` and `quoteColumn` functions.

---

### L2. Consider Adding Connection Health Monitoring for SQL

The SSH connection has health monitoring (latency, reconnection), but the SQL connection has no keepalive, no ping, and no detection of dropped connections. If the SSH tunnel dies, the SQL connection will hang until the next query times out.

**Suggestion:** Add periodic `SELECT 1` pings or connection error event handling.

---

### L3. Query History Not Persisted Across Sessions

`QueryHistoryEntry` objects live in Zustand in-memory store. When the app restarts, all history is lost.

**Suggestion:** Persist query history to electron-store (similar to SQLConfigStore).

---

### L4. Export Dialog Table Name is Read-Only

**File:** `src/components/sql/ExportDialog.tsx:176-181`

The table name input for SQL export is `readOnly`, preventing users from customizing it. For query editor results (no source table), it defaults to "exported_data".

**Suggestion:** Make it editable.

---

### L5. Autocomplete Column Suggestions Limited to Currently Selected Table

**File:** `src/components/sql/sqlAutocomplete.ts:155-158`

```typescript
const columns = ctx.tablePrefix
  ? schema.columns // When prefixed, show all loaded columns
  : schema.columns
```

Both branches return `schema.columns`, which comes from `useSQLStore.columns` — the columns of the currently selected table only. When writing JOINs involving other tables, no column suggestions appear for the joined table.

**Suggestion:** Cache columns for all tables in the schema and provide per-table suggestions based on the `tablePrefix`.

---

### L6. `SafeModeIndicator` Receives `onConfirmAction` Prop But Doesn't Use It

**File:** `src/components/sql/SafeModeIndicator.tsx:9-12`

```typescript
interface SafeModeIndicatorProps {
  isProduction: boolean
  onConfirmAction: (action: string, callback: () => void) => void
}
```

The `onConfirmAction` prop is declared but never used in the component (line 17-18 destructures only `isProduction`). TypeScript won't warn about this since it's a valid prop pattern, but it indicates dead code.

---

### L7. DataTabView Doesn't Show Row Count Approximation Until Count Query Completes

The data query and count query are sequential (not parallel). The user sees data first, then pagination updates. For large tables, the count query could be slow.

**Suggestion:** Show an approximate count from `INFORMATION_SCHEMA` immediately and refine it with the exact count query.

---

### L8. `useDebouncedCallback` in QueryEditor Doesn't Clear Timeout on Unmount

**File:** `src/components/sql/QueryEditor.tsx:88-103`

```typescript
function useDebouncedCallback<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ...no cleanup effect
}
```

If the component unmounts while a debounced callback is pending, it will fire on an unmounted component. This could cause React warnings or state updates on unmounted components.

**Fix:** Add `useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])`.

---

## Verdict

**NEEDS WORK**

The SQL client has solid architecture, clean component separation, and good UX patterns. However, it has **6 critical issues** that must be fixed before shipping:

1. **Inline editing is completely broken** (StagedChange missing `changes` and `primaryKey`)
2. **SQL injection** via unescaped table names and raw SQL filters
3. **Global store corruption** when multiple SSH connections are open simultaneously
4. **Keyboard shortcuts are dead** (events dispatched but never listened for)
5. **Cmd+Z hijacks text editing undo** across the entire SQL panel
6. **Keyboard shortcuts fire when SQL panel is hidden** behind other sub-tabs

Fix the criticals and high-priority items, then this is ready for a second review pass.
