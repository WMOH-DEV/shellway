# Phase 8: Query History, Favorites, Export

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Depends on:** [Phase 4](./04-query-editor.md)
> **Back to:** [Overview](./00-overview.md)

---

## Task 8.1: Query History Panel

**Files:**
- Create: `src/components/sql/QueryHistoryPanel.tsx`

**What it does:** Sidebar panel or modal showing past executed queries with search, favorites, and replay.

**UI Layout:**
```
┌────────────────────────────────────────────────┐
│ Query History                       [Clear All]│
│ ┌────────────────────────────────────────────┐ │
│ │ 🔍 Search queries...                      │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ [All] [★ Favorites]                            │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │ ★ SELECT u.*, COUNT(o.id) as order_count   │ │
│ │   FROM users u LEFT JOIN orders o...       │ │
│ │   100 rows | 24ms | 2 min ago              │ │
│ ├────────────────────────────────────────────┤ │
│ │   SELECT * FROM chapters WHERE manga_id    │ │
│ │   = 20897 LIMIT 200;                       │ │
│ │   200 rows | 8ms | 15 min ago              │ │
│ ├────────────────────────────────────────────┤ │
│ │ ✗ SELECT * FROM nonexistent_table;         │ │
│ │   ERROR: Table doesn't exist | 5 min ago   │ │
│ ├────────────────────────────────────────────┤ │
│ │   SHOW DATABASES;                          │ │
│ │   4 rows | 2ms | 1 hour ago                │ │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

**Features:**
- Reverse chronological list of all executed queries
- Each entry shows:
  - Query text (first 2-3 lines, truncated with ellipsis)
  - Result info: row count, execution time
  - Relative timestamp: "2 min ago", "1 hour ago"
  - Error indicator (red × icon) for failed queries with error message
  - Favorite star (toggle)
- **Click entry** → loads query into the editor
- **Double-click** → loads and immediately executes
- **Star button** → toggles favorite (favorites persist across sessions)
- **Search input** → filters history by query text
- **Tab filter**: All / Favorites only
- **Clear All** → removes non-favorited entries (confirm dialog)
- Stored in `sqlStore.queryHistory[]` (last 500 entries)
- Persisted to localStorage via zustand/persist middleware

**Integration with QueryEditor:**
Every time a query is executed (success or failure), add to history:
```typescript
sqlStore.addHistoryEntry({
  id: crypto.randomUUID(),
  query: executedQuery,
  database: currentDatabase,
  executedAt: Date.now(),
  executionTimeMs: result.executionTimeMs,
  rowCount: result.rowCount,
  error: result.error,
  isFavorite: false
})
```

**Step 1: Implement QueryHistoryPanel**

**Step 2: Commit**

```bash
git add src/components/sql/QueryHistoryPanel.tsx
git commit -m "feat(sql): add query history panel with search and favorites"
```

---

## Task 8.2: Export Functionality

**Files:**
- Create: `src/components/sql/ExportDialog.tsx`
- Create: `src/utils/sqlExport.ts`

### Export Dialog

**What it does:** Modal dialog for exporting query results or table data.

**UI Layout:**
```
┌─────────────────────────────────────┐
│ Export Data                         │
│                                     │
│ Format: [CSV ▼]                     │
│                                     │
│ ○ Current results (100 rows)        │
│ ○ Selected rows only (5 rows)       │
│ ○ Entire table (~620,742 rows)      │
│                                     │
│ Options:                            │
│ [✓] Include column headers (CSV)    │
│ [✓] Pretty print (JSON)            │
│ [ ] Include CREATE TABLE (SQL)      │
│                                     │
│ [Cancel]              [Export]       │
└─────────────────────────────────────┘
```

**Export Formats:**

1. **CSV** — Comma-separated values
   - RFC 4180 compliant
   - Proper escaping (quotes, commas, newlines)
   - Optional column headers
   - UTF-8 with BOM (for Excel compatibility)

2. **JSON** — Array of objects
   - Pretty-printed (optional) or minified
   - Proper type handling (numbers, booleans, nulls)

3. **SQL INSERT** — INSERT statements
   - One INSERT per row
   - Batch INSERT option (multiple rows per statement, chunks of 100)
   - Proper value escaping

4. **SQL CREATE + INSERT** — Full table recreation
   - CREATE TABLE statement (fetched via introspection)
   - Followed by INSERT statements
   - Can be used to migrate/backup a table

### Export Utility (`src/utils/sqlExport.ts`)

```typescript
export function exportToCSV(result: QueryResult, options: CSVOptions): string
export function exportToJSON(result: QueryResult, options: JSONOptions): string
export function exportToSQL(result: QueryResult, table: string, dbType: DatabaseType, options: SQLOptions): string

interface CSVOptions {
  includeHeaders: boolean
  delimiter: ',' | '\t' | ';'
}

interface JSONOptions {
  prettyPrint: boolean
}

interface SQLOptions {
  batchSize: number        // Rows per INSERT statement
  includeCreate: boolean
}
```

**Save Flow:**
1. User clicks Export → dialog opens
2. User selects format and options
3. User clicks Export → generates content in memory
4. `window.novadeck.dialog.saveFile()` → file picker with appropriate extension filter
5. `window.novadeck.fs.writeFile()` → saves to disk
6. Success toast: "Exported 100 rows to ~/exports/chapters.csv"

**For "Entire table" export:**
- Stream results in chunks (LIMIT/OFFSET batches of 5000)
- Show progress bar in dialog
- Cancel button to abort

**Step 1: Implement `src/utils/sqlExport.ts`**

**Step 2: Implement `src/components/sql/ExportDialog.tsx`**

**Step 3: Commit**

```bash
git add src/utils/sqlExport.ts src/components/sql/ExportDialog.tsx
git commit -m "feat(sql): add export functionality (CSV, JSON, SQL)"
```
