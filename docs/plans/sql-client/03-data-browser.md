# Phase 3: Data Browser — Browse Table Rows

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Depends on:** [Phase 2](./02-connection-schema.md)
> **Back to:** [Overview](./00-overview.md)

---

## Task 3.1: Install AG Grid

**Files:**
- Modify: `package.json`

```bash
npm install ag-grid-react ag-grid-community
```

AG Grid Community edition (free, MIT licensed) provides:
- Virtual scrolling (millions of rows without lag)
- Column resizing, reordering, pinning
- Built-in sorting
- Cell selection and range selection
- Custom cell renderers
- Copy/paste support
- Keyboard navigation

**Step 1: Install**

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install ag-grid-react for SQL data grid"
```

---

## Task 3.2: Data Grid Component

**Files:**
- Create: `src/components/sql/DataGrid.tsx`

**What it does:** Renders query results in a high-performance virtualized grid.

**Features:**
- Receives `QueryResult` from store and renders via AG Grid
- Virtual scrolling — only renders visible rows in the DOM
- Column headers from `result.fields` with type-aware formatting
- **Row number column** pinned to the left (non-selectable)
- Click column header → sort (triggers re-query with ORDER BY)
- Select rows, copy cells with Cmd+C
- Right-click context menu: Copy Cell, Copy Row, Copy as INSERT, Edit Row, Delete Row
- **NULL values** → shown as `NULL` with a muted/italic style distinct from empty string
- **Boolean values** → shown as checkboxes (read-only in this phase)
- **Timestamps** → formatted as human-readable (e.g., "2025-01-15 14:30:22")
- **Long text** → truncated with ellipsis, full value on hover tooltip
- **JSON columns** → pretty-printed on hover/click
- Resizable columns (drag column borders)
- Auto-size columns on first data load
- Dark theme styling matching Shellway's `nd-*` color tokens

**AG Grid Configuration:**
```typescript
const defaultColDef = {
  sortable: false,        // We handle sorting server-side
  resizable: true,
  filter: false,          // We use our own filter bar
  cellStyle: { fontSize: '13px' },
}

const gridOptions = {
  rowSelection: 'multiple',
  enableCellTextSelection: true,
  suppressRowClickSelection: true,
  animateRows: false,
  headerHeight: 32,
  rowHeight: 28,
}
```

**Custom Cell Renderers:**
- `NullCellRenderer` — renders NULL with distinct styling
- `BooleanCellRenderer` — renders checkbox
- `DateCellRenderer` — formats dates
- `JsonCellRenderer` — truncated JSON with expand

**Step 1: Implement DataGrid component**

**Step 2: Commit**

```bash
git add src/components/sql/DataGrid.tsx
git commit -m "feat(sql): add AG Grid data grid component"
```

---

## Task 3.3: Pagination Bar

**Files:**
- Create: `src/components/sql/PaginationBar.tsx`

**What it does:** Bottom bar with pagination controls and query stats.

**UI Layout:**
```
[◀ First] [← Prev] Page [3] of 3,104 [Next →] [Last ▶]  |  200 rows/page [▼]  |  ~620,742 total  |  12ms
```

**Features:**
- First / Previous / Next / Last buttons (disabled at boundaries)
- Direct page input — type a number and press Enter to jump
- Page size selector dropdown: 50, 100, 200 (default), 500, 1000
- Total rows display (approximate, prefixed with `~`)
- Query execution time display
- Rows showing indicator: "Showing 401-600 of ~620,742"
- Compact layout — fits in a single 28px-high bar

**Data flow:**
- Page/size changes trigger `DataTabView` to re-query with new LIMIT/OFFSET
- Total rows fetched once via `sql:getRowCount` (approximate, from table stats)

**Step 1: Implement PaginationBar**

**Step 2: Commit**

```bash
git add src/components/sql/PaginationBar.tsx
git commit -m "feat(sql): add pagination bar component"
```

---

## Task 3.4: Data Tab View (Orchestrator)

**Files:**
- Create: `src/components/sql/DataTabView.tsx`

**What it does:** Orchestrates data loading for a selected table. This is the main content area when viewing a table's data.

**Layout:**
```
┌──────────────────────────────────────┐
│ (Filter Bar — Phase 5)              │
├──────────────────────────────────────┤
│                                      │
│        AG Grid Data Grid             │
│        (virtual scroll)              │
│                                      │
├──────────────────────────────────────┤
│ Pagination Bar                       │
└──────────────────────────────────────┘
```

**Responsibilities:**
1. When `selectedTable` changes in store → fetch primary keys, then load first page of data
2. Build the SQL query:
   ```sql
   SELECT * FROM `tableName`
   [WHERE ...filters...]
   [ORDER BY sortColumn sortDirection]
   LIMIT pageSize OFFSET (page - 1) * pageSize
   ```
3. Quote table/column names correctly (backticks for MySQL, double-quotes for Postgres)
4. Handle sort changes → re-query with new ORDER BY
5. Handle page changes → re-query with new OFFSET
6. Handle filter changes → re-query with new WHERE, reset to page 1
7. Show loading skeleton while fetching
8. Show error message on query failure
9. Show empty state: "No rows found" or "Table is empty"

**Query builder helper:**
```typescript
function buildDataQuery(opts: {
  table: string
  schema?: string
  dbType: 'mysql' | 'postgres'
  page: number
  pageSize: number
  sortColumn?: string
  sortDirection?: 'asc' | 'desc'
  filters?: TableFilter[]
}): { query: string; params: unknown[] }
```

**Step 1: Implement DataTabView**

**Step 2: Commit**

```bash
git add src/components/sql/DataTabView.tsx
git commit -m "feat(sql): add DataTabView orchestrator for table data browsing"
```
