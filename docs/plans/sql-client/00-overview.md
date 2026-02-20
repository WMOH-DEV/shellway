# SQL Client Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TablePlus-quality SQL client inside Shellway that reuses existing SSH tunnels, letting developers manage databases directly from the same app they SSH into.

**Architecture:** The SQL client runs as a new sub-tab alongside Terminal/SFTP on each connection. Backend creates SSH port-forwards to the DB server, then connects via pure-JS drivers (`mysql2`, `pg`). Frontend uses a three-panel layout: schema sidebar, query editor (Monaco), and data grid (AG Grid) with inline editing, advanced filters, and staged changes.

**Tech Stack:** `mysql2` + `pg` (DB drivers), `@monaco-editor/react` (SQL editor), `ag-grid-react` (data grid), existing Zustand/IPC/preload patterns.

---

## Phase Overview

| Phase | File | What It Delivers | Depends On |
|-------|------|-----------------|------------|
| **Phase 1** | [01-foundation.md](./01-foundation.md) | Types, service, IPC, preload, store, empty tab wiring | Nothing |
| **Phase 2** | [02-connection-schema.md](./02-connection-schema.md) | Connection dialog + SSH tunnel + schema browser sidebar | Phase 1 |
| **Phase 3** | [03-data-browser.md](./03-data-browser.md) | Data browser — browse table rows with pagination, sorting | Phase 2 |
| **Phase 4** | [04-query-editor.md](./04-query-editor.md) | SQL query editor with Monaco + results grid | Phase 2 |
| **Phase 5** | [05-advanced-filters.md](./05-advanced-filters.md) | Advanced filters (TablePlus-style filter bar) | Phase 3 |
| **Phase 6** | [06-inline-editing.md](./06-inline-editing.md) | Inline cell editing + staged changes + batch apply | Phase 3 |
| **Phase 7** | [07-table-structure.md](./07-table-structure.md) | Table structure viewer (columns, indexes, FKs) | Phase 2 |
| **Phase 8** | [08-history-export.md](./08-history-export.md) | Query history, favorites, export (CSV/JSON/SQL) | Phase 4 |
| **Phase 9** | [09-polish.md](./09-polish.md) | Multi-table tabs, keyboard shortcuts, safe mode | Phase 3-6 |

---

## Dependency Graph

```
Phase 1 (Foundation)
  ├── Phase 2 (Connection + Schema)
  │     ├── Phase 3 (Data Browser)
  │     │     ├── Phase 5 (Filters)
  │     │     ├── Phase 6 (Inline Editing)
  │     │     └── Phase 9 (Polish) ←── also needs Phase 6
  │     ├── Phase 4 (Query Editor)
  │     │     └── Phase 8 (History + Export)
  │     └── Phase 7 (Structure Viewer)
```

---

## New Dependencies (npm)

```
ag-grid-react         — Data grid (free MIT community edition)
ag-grid-community     — AG Grid core
@monaco-editor/react  — SQL editor
mysql2                — MySQL/MariaDB driver (pure JS, no native deps)
pg                    — PostgreSQL driver (pure JS, no native deps)
```

All pure JavaScript — no native C++ compilation needed.

---

## New Files Summary (25+)

```
# Types
src/types/sql.ts

# Backend
electron/services/SQLService.ts
electron/ipc/sql.ipc.ts

# Store
src/stores/sqlStore.ts

# UI Components
src/components/sql/SQLView.tsx
src/components/sql/SQLConnectDialog.tsx
src/components/sql/SchemaSidebar.tsx
src/components/sql/DataGrid.tsx
src/components/sql/DataTabView.tsx
src/components/sql/PaginationBar.tsx
src/components/sql/QueryEditor.tsx
src/components/sql/FilterBar.tsx
src/components/sql/StagedChangesPanel.tsx
src/components/sql/RowToolbar.tsx
src/components/sql/StructureTabView.tsx
src/components/sql/QueryHistoryPanel.tsx
src/components/sql/ExportDialog.tsx
src/components/sql/SQLTabBar.tsx
src/components/sql/SQLStatusBar.tsx
src/components/sql/SafeModeIndicator.tsx

# Utilities
src/utils/sqlFilterBuilder.ts
src/utils/sqlStatementGenerator.ts
src/utils/sqlExport.ts
src/components/sql/sqlAutocomplete.ts
src/components/sql/useSQLShortcuts.ts
```

## Modified Files (7)

```
electron/main.ts                        — Register SQL IPC
electron/preload.ts                     — Add sql namespace
electron/ipc/portforward.ipc.ts         — Export getPortForwardService()
src/types/session.ts                    — Extend activeSubTab union
src/components/ConnectionView.tsx       — Add SQL tab
src/hooks/useKeyboardShortcuts.ts       — Add SQL shortcuts
src/env.d.ts                            — SQL type declarations
```
