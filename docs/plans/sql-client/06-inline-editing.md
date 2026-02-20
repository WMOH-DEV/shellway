# Phase 6: Inline Cell Editing + Staged Changes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Depends on:** [Phase 3](./03-data-browser.md)
> **Back to:** [Overview](./00-overview.md)

---

## Task 6.1: Editable Data Grid

**Files:**
- Modify: `src/components/sql/DataGrid.tsx`

**What it does:** Enhance the read-only DataGrid with inline cell editing that stages changes locally before applying to the database.

**Editing Behavior:**
- **Double-click a cell** → enters edit mode (cell becomes an input)
- **Tab** → save current edit, move to next cell
- **Shift+Tab** → save current edit, move to previous cell
- **Enter** → save current edit, move down one row
- **Escape** → cancel current edit, revert to original value
- **Type directly** → replaces cell content (like a spreadsheet)

**Visual Indicators:**
- **Modified cells** → amber/yellow background highlight
- **Modified rows** → left border in amber
- **Deleted rows** → red background + strikethrough text
- **Inserted rows** → green background
- **Original value** → shown as tooltip on hover for modified cells

**How Changes Are Staged (NOT applied immediately):**
1. User edits a cell → `StagedChange` created with type `'update'`
2. Change stored in `sqlStore.stagedChanges[]`
3. Grid re-renders with visual indicators
4. Multiple edits to the same row merge into one `StagedChange`
5. Nothing touches the database until user explicitly clicks "Apply"

**Requirements:**
- Table MUST have a primary key for editing to work (otherwise show "Read-only: no primary key" indicator)
- Primary keys fetched via `sql:getPrimaryKeys` on table load
- Non-editable columns: auto-increment PKs (display but can't edit)

**Step 1: Add editing capabilities to DataGrid**

Key AG Grid config additions:
```typescript
{
  editable: true,                    // Enable cell editing
  singleClickEdit: false,           // Require double-click
  stopEditingWhenCellsLoseFocus: true,
  onCellValueChanged: (event) => {
    // Create or update StagedChange in sqlStore
  },
}
```

**Step 2: Commit**

```bash
git add src/components/sql/DataGrid.tsx
git commit -m "feat(sql): add inline cell editing with staged changes"
```

---

## Task 6.2: Row Operations Toolbar

**Files:**
- Create: `src/components/sql/RowToolbar.tsx`

**What it does:** Toolbar above the data grid for row-level operations.

**UI Layout (matches TablePlus):**
```
[Export] [SQL]  |  Show: ⌘F  Insert: ⌘⇧I  Remove: ⌘⌫  Apply All: ⌘↵  |  3 pending changes
```

**Buttons:**
- **Insert Row** (`Cmd+Shift+I`) — adds a new empty row at the bottom, enters edit mode on first editable column
- **Delete Row** (`Cmd+Delete`) — marks selected row(s) for deletion (red strikethrough)
- **Duplicate Row** — copies selected row as a new insert
- **Apply All** (`Cmd+Return`) — commits all staged changes to the database
- **Discard All** — clears all staged changes, reverts grid to original state
- **Pending changes counter** — "3 pending changes" badge

**Insert Row Flow:**
1. Click "Insert Row" or `Cmd+Shift+I`
2. New row appears at bottom with empty values
3. Required columns (non-nullable, no default) highlighted
4. User fills in values
5. Row added to `stagedChanges` as type `'insert'`
6. Not saved until "Apply All"

**Delete Row Flow:**
1. Select one or more rows
2. Click "Delete Row" or `Cmd+Delete`
3. Rows marked with red strikethrough
4. Added to `stagedChanges` as type `'delete'`
5. Not deleted until "Apply All"

**Step 1: Implement RowToolbar**

**Step 2: Commit**

```bash
git add src/components/sql/RowToolbar.tsx
git commit -m "feat(sql): add row operations toolbar (insert, delete, apply)"
```

---

## Task 6.3: SQL Statement Generator

**Files:**
- Create: `src/utils/sqlStatementGenerator.ts`

**What it does:** Generates safe SQL statements from staged changes.

```typescript
// Generate individual statements
function generateUpdateSQL(change: StagedChange, dbType: DatabaseType): string
function generateInsertSQL(change: StagedChange, dbType: DatabaseType): string
function generateDeleteSQL(change: StagedChange, dbType: DatabaseType): string

// Generate all changes wrapped in a transaction
function generateTransaction(changes: StagedChange[], dbType: DatabaseType): string
```

**Output Examples:**

UPDATE:
```sql
-- MySQL
UPDATE `chapters` SET `title` = 'New Title', `number` = 42 WHERE `id` = 958982;

-- Postgres
UPDATE "chapters" SET "title" = 'New Title', "number" = 42 WHERE "id" = 958982;
```

INSERT:
```sql
-- MySQL
INSERT INTO `chapters` (`title`, `number`, `manga_id`) VALUES ('Chapter 1', 1, 20897);

-- Postgres
INSERT INTO "chapters" ("title", "number", "manga_id") VALUES ('Chapter 1', 1, 20897);
```

DELETE:
```sql
-- MySQL
DELETE FROM `chapters` WHERE `id` = 958982;

-- Postgres
DELETE FROM "chapters" WHERE "id" = 958982;
```

TRANSACTION:
```sql
BEGIN;
UPDATE `chapters` SET `title` = 'New Title' WHERE `id` = 958982;
DELETE FROM `chapters` WHERE `id` = 958970;
INSERT INTO `chapters` (`title`, `number`) VALUES ('New', 999);
COMMIT;
```

**Important:**
- Proper identifier quoting (backticks for MySQL, double-quotes for Postgres)
- String values properly escaped (single quotes doubled: `O'Brien` → `O''Brien`)
- NULL values rendered as `NULL` (not `'NULL'`)
- Numbers rendered without quotes
- Boolean values: MySQL → `1`/`0`, Postgres → `true`/`false`
- Date values quoted as strings

**Step 1: Implement the generators**

**Step 2: Commit**

```bash
git add src/utils/sqlStatementGenerator.ts
git commit -m "feat(sql): add SQL statement generator for staged changes"
```

---

## Task 6.4: Staged Changes Panel (Code Review)

**Files:**
- Create: `src/components/sql/StagedChangesPanel.tsx`

**What it does:** Collapsible panel showing all pending changes as SQL, with review and apply functionality. This is TablePlus's "Code Review" feature.

**UI Layout:**
```
┌────────────────────────────────────────────────────────────┐
│ ⚡ 3 Pending Changes                        [↑ Collapse]  │
├────────────────────────────────────────────────────────────┤
│  1. UPDATE `chapters` SET `title` = 'New Title'           │
│     WHERE `id` = 958982;                          [× Undo]│
│                                                            │
│  2. DELETE FROM `chapters` WHERE `id` = 958970;   [× Undo]│
│                                                            │
│  3. INSERT INTO `chapters` (`title`, `number`)             │
│     VALUES ('New Chapter', 999);                  [× Undo]│
├────────────────────────────────────────────────────────────┤
│ [Review Full SQL]     [Discard All]     [⌘↵ Apply All]    │
└────────────────────────────────────────────────────────────┘
```

**Features:**
- Shows each staged change as formatted SQL with syntax highlighting
- Individual "Undo" button per change (removes from staged list, reverts grid)
- "Review Full SQL" button → opens modal with complete transaction SQL
- "Discard All" → clears all changes, reverts grid
- "Apply All" (`Cmd+Return`) → executes the transaction, then refreshes data
- Collapsible — toggle to show/hide (save space when no changes)
- Auto-expands when first change is made
- Shows change type icon: pencil (update), plus (insert), trash (delete)
- **On Apply success:** toast "3 changes applied successfully", clear staged, refresh
- **On Apply failure:** toast error, keep staged changes, highlight which statement failed

**Apply Flow:**
```
1. Generate transaction SQL from staged changes
2. Execute via sql:query
3. If success → clear staged changes, refresh data grid, show success toast
4. If error → show error toast with failed statement, keep changes for retry
```

**Step 1: Implement StagedChangesPanel**

**Step 2: Commit**

```bash
git add src/components/sql/StagedChangesPanel.tsx
git commit -m "feat(sql): add staged changes review panel with apply/discard"
```
