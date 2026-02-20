# Phase 9: Polish — Multi-Table Tabs, Keyboard Shortcuts, Safe Mode

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Depends on:** [Phase 3](./03-data-browser.md), [Phase 4](./04-query-editor.md), [Phase 6](./06-inline-editing.md)
> **Back to:** [Overview](./00-overview.md)

---

## Task 9.1: Multi-Table Tab Bar

**Files:**
- Create: `src/components/sql/SQLTabBar.tsx`

**What it does:** Tab bar within the SQL panel for opening multiple tables and queries simultaneously.

**UI Layout (matches TablePlus):**
```
[chapters ×] [users ×] [+ SQL Query ×] [mangas ×]  [+]
     ▲            ▲           ▲              ▲       ▲
  data tab    data tab   query tab      data tab   add new
  (active)
```

**Tab Types:**
- **Data tab** — shows DataTabView for a specific table (icon: table)
- **Query tab** — shows QueryEditor (icon: code)
- **Structure tab** — shows StructureTabView (icon: columns)

**Features:**
- Tabs stored in `sqlStore.tabs[]` with `SQLTab` type
- Click tab → switches active content
- Close button (×) on each tab
- Middle-click → close tab
- Dirty indicator (dot) on tabs with unsaved changes (staged edits)
- `+` button dropdown: "New Query" / "Open Table..."
- **Double-click table in schema sidebar** → opens new data tab
- **Right-click table in sidebar** → "Open Data" / "Open Structure" → new tab
- Drag tabs to reorder
- Max tabs: unlimited (horizontal scroll when overflowing)
- Tab label: table name for data/structure tabs, "Query" (or "Query 2", "Query 3") for query tabs

**Tab Lifecycle:**
```
1. Double-click table "chapters" in sidebar
2. Check if tab for "chapters" (data) already exists → if yes, activate it
3. If not, create new SQLTab { id: uuid(), type: 'data', label: 'chapters', table: 'chapters' }
4. Add to sqlStore.tabs, set as active
5. DataTabView renders, loads data for "chapters"
```

**Step 1: Implement SQLTabBar**

**Step 2: Commit**

```bash
git add src/components/sql/SQLTabBar.tsx
git commit -m "feat(sql): add multi-table tab bar"
```

---

## Task 9.2: Keyboard Shortcuts

**Files:**
- Create: `src/components/sql/useSQLShortcuts.ts`
- Modify: `src/hooks/useKeyboardShortcuts.ts`

**What it does:** Register SQL-specific keyboard shortcuts.

**Shortcut Map:**

| Shortcut | Action | Context |
|----------|--------|---------|
| `Cmd+Enter` | Run query | Query editor focused |
| `Cmd+Shift+Enter` | Run single statement | Query editor focused |
| `Cmd+S` | Apply staged changes | Data grid active |
| `Cmd+F` | Add filter / focus filter bar | Data tab active |
| `Cmd+R` | Refresh data | SQL panel active |
| `Cmd+T` | New query tab | SQL panel active |
| `Cmd+W` | Close current SQL tab | SQL panel active |
| `Cmd+Shift+I` | Insert new row | Data tab active |
| `Cmd+Delete` | Delete selected row(s) | Data tab active |
| `Cmd+Shift+C` | Copy row as INSERT | Row selected |
| `Cmd+D` | Duplicate selected row | Row selected |
| `Cmd+.` | Cycle Data → Structure → Query | Table tab active |
| `Cmd+E` | Export current results | Results visible |
| `Cmd+H` | Toggle query history | SQL panel active |
| `Escape` | Cancel cell edit / Close dialog | Editing |
| `Cmd+Z` | Undo last staged change | Data tab active |

**Implementation:**
- Custom hook `useSQLShortcuts(sqlSessionId)` that registers event listeners
- Only active when SQL panel is the active sub-tab
- Shortcuts registered via `useEffect` with proper cleanup
- Prevent conflicts with existing app shortcuts (check `useKeyboardShortcuts.ts`)

**Add to global shortcuts in `useKeyboardShortcuts.ts`:**
- `Cmd+Shift+D` — switch to SQL sub-tab (alongside existing `Cmd+Shift+T` for terminal, `Cmd+Shift+F` for SFTP)

**Step 1: Implement useSQLShortcuts hook**

**Step 2: Add global SQL shortcut to useKeyboardShortcuts**

**Step 3: Commit**

```bash
git add src/components/sql/useSQLShortcuts.ts src/hooks/useKeyboardShortcuts.ts
git commit -m "feat(sql): add keyboard shortcuts for SQL client"
```

---

## Task 9.3: Safe Mode

**Files:**
- Create: `src/components/sql/SafeModeIndicator.tsx`

**What it does:** Visual safety indicator and confirmation dialogs when working with production databases.

**UI Layout — Status Bar Indicator:**
```
Normal:      [Connected: MySQL 8.0] | [DB: myapp] | ...
Production:  [⚠ PRODUCTION] [Connected: MySQL 8.0] | [DB: myapp] | ...
                  ▲
          red/amber badge, pulsing glow
```

**Features:**

### Connection-Level Setting
- In `SQLConnectDialog`, add checkbox: "Mark as production database"
- When checked, `DatabaseConnectionConfig.isProduction = true`
- Production connections get a red top border on the entire SQL panel

### Visual Indicators
- **Status bar badge:** "PRODUCTION" in red/amber with warning icon
- **Panel border:** 2px red/amber top border on the SQL panel content area
- **Tab indicator:** red dot on the SQL sub-tab in ConnectionView
- **Title bar suffix:** " [PROD]" appended to the connection tab name

### Confirmation Dialogs
When `isProduction = true`, show confirmation before:
1. **Applying staged changes** (UPDATE/INSERT/DELETE)
   ```
   ⚠ Production Database
   You are about to apply 3 changes to the production database "myapp".
   This action cannot be undone.
   [Cancel]  [Apply Changes]
   ```

2. **Executing raw queries that modify data** (detected by keyword: INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE)
   ```
   ⚠ Production Database  
   This query will modify data in the production database.
   [Cancel]  [Execute Anyway]
   ```

3. **Dropping/truncating a table** (from context menu)
   ```
   ⚠ DESTRUCTIVE OPERATION
   You are about to DROP table "chapters" from the production database "myapp".
   Type the table name to confirm: [___________]
   [Cancel]  [Drop Table]
   ```

### Read-Only Mode (Optional Enhancement)
- Toggle in toolbar: "Read-Only Mode" 🔒
- When enabled: all write operations blocked (buttons disabled, editor won't execute write queries)
- Useful for browsing production data safely

**Step 1: Implement SafeModeIndicator**

**Step 2: Commit**

```bash
git add src/components/sql/SafeModeIndicator.tsx
git commit -m "feat(sql): add production safe mode with confirmation dialogs"
```

---

## Task 9.4: SQL Status Bar

**Files:**
- Create: `src/components/sql/SQLStatusBar.tsx`

**What it does:** Bottom status bar showing connection info, query stats, and quick actions.

**UI Layout (matches TablePlus bottom bar):**
```
┌───────────────────────────────────────────────────────────────────────────────┐
│ [Data] [Structure]  |  MySQL 8.0  |  myapp  |  chapters  |  1 of ~620,742   │
│                                                   [Filters ▼] [Columns]  ◀ ▶│
└───────────────────────────────────────────────────────────────────────────────┘
```

**Sections (left to right):**
1. **View mode tabs:** Data | Structure (bottom tabs for the current table)
2. **DB info:** Database type + version (e.g., "MySQL 8.0", "PostgreSQL 15")
3. **Current database:** Database name
4. **Current table:** Table name
5. **Row info:** "1 of ~620,742 rows selected" or "200 rows loaded | ~620,742 total"
6. **Execution time:** "12ms" for last query
7. **Active filters count:** "3 Filters" button (click to toggle filter bar)
8. **Pending changes count:** "2 changes" badge (click to toggle staged panel)
9. **Columns button:** Shows/hides column visibility selector
10. **Navigation arrows:** ◀ ▶ for navigating between rows

**Step 1: Implement SQLStatusBar**

**Step 2: Commit**

```bash
git add src/components/sql/SQLStatusBar.tsx
git commit -m "feat(sql): add SQL status bar with connection info and stats"
```
