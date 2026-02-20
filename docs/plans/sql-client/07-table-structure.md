# Phase 7: Table Structure Viewer

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Depends on:** [Phase 2](./02-connection-schema.md)
> **Back to:** [Overview](./00-overview.md)

---

## Task 7.1: Structure Tab View

**Files:**
- Create: `src/components/sql/StructureTabView.tsx`

**What it does:** Shows table structure (columns, indexes, foreign keys) when viewing a table's "Structure" tab. Equivalent to the "Structure" tab at the bottom of TablePlus.

**UI Layout:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Structure: chapters                                      [Refresh] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Columns                                                             │
│ ┌──────────────┬──────────────────┬──────────┬──────────┬─────────┐│
│ │ Name         │ Type             │ Nullable │ Default  │ Key     ││
│ ├──────────────┼──────────────────┼──────────┼──────────┼─────────┤│
│ │ id           │ bigint unsigned  │ NO       │ (auto)   │ PRI AI  ││
│ │ number       │ varchar(50)      │ YES      │ NULL     │         ││
│ │ title        │ varchar(255)     │ YES      │ NULL     │         ││
│ │ is_protected │ tinyint(1)       │ NO       │ 0        │         ││
│ │ scrape_url   │ text             │ YES      │ NULL     │         ││
│ │ manga_id     │ bigint unsigned  │ NO       │          │ MUL FK  ││
│ │ created_at   │ timestamp        │ YES      │ NULL     │         ││
│ │ updated_at   │ timestamp        │ YES      │ NULL     │         ││
│ └──────────────┴──────────────────┴──────────┴──────────┴─────────┘│
│                                                                     │
│ Indexes                                                             │
│ ┌──────────────────────┬──────────────┬────────┬──────────────────┐│
│ │ Name                 │ Columns      │ Unique │ Type             ││
│ ├──────────────────────┼──────────────┼────────┼──────────────────┤│
│ │ PRIMARY              │ id           │ YES    │ BTREE            ││
│ │ chapters_manga_idx   │ manga_id     │ NO     │ BTREE            ││
│ │ chapters_scrape_idx  │ scrape_url   │ NO     │ BTREE            ││
│ └──────────────────────┴──────────────┴────────┴──────────────────┘│
│                                                                     │
│ Foreign Keys                                                        │
│ ┌───────────────────┬──────────┬───────────────┬───────┬──────────┐│
│ │ Name              │ Columns  │ References    │ OnUpd │ OnDel    ││
│ ├───────────────────┼──────────┼───────────────┼───────┼──────────┤│
│ │ fk_chapter_manga  │ manga_id │ mangas(id)    │ CASCADE│ CASCADE ││
│ └───────────────────┴──────────┴───────────────┴───────┴──────────┘│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**

### Columns Section
- Fetches via `sql:getColumns(sqlSessionId, table, schema)`
- Columns: Name, Type, Nullable (YES/NO badge), Default, Key info
- Key column shows badges: `PRI` (primary), `AI` (auto-increment), `UNI` (unique), `MUL` (indexed), `FK` (foreign key)
- Color-coded badges: PRI = blue, AI = purple, UNI = green, FK = amber
- Click column name → copies to clipboard
- Hover on type → tooltip with full type details

### Indexes Section
- Fetches via `sql:getIndexes(sqlSessionId, table, schema)`
- Columns: Name, Columns (comma-separated), Unique (YES/NO badge), Type
- Primary key row highlighted
- Unique indexes shown with green badge

### Foreign Keys Section
- Fetches via `sql:getForeignKeys(sqlSessionId, table, schema)`
- Columns: Name, Source Columns, References (table + columns), On Update, On Delete
- Click referenced table → navigates to that table in schema sidebar
- On Delete/Update show badges: CASCADE (red), SET NULL (amber), RESTRICT (blue), NO ACTION (gray)

### General
- All three sections collapsible (click header to toggle)
- All expanded by default
- Refresh button reloads all three
- Loading skeleton while fetching
- Empty state per section: "No indexes" / "No foreign keys"
- Tables in the simple HTML table style using Tailwind (NOT AG Grid — this is static data, doesn't need virtualization)

**Step 1: Implement StructureTabView**

**Step 2: Commit**

```bash
git add src/components/sql/StructureTabView.tsx
git commit -m "feat(sql): add table structure viewer (columns, indexes, FKs)"
```
