# Phase 2: Connection Dialog + Schema Browser

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Depends on:** [Phase 1](./01-foundation.md)
> **Back to:** [Overview](./00-overview.md)

---

## Task 2.1: Database Connection Dialog

**Files:**
- Create: `src/components/sql/SQLConnectDialog.tsx`

**What it does:** Modal dialog for entering DB credentials and connecting.

**UI Layout:**
```
┌─────────────────────────────────────┐
│  Connect to Database                │
│                                     │
│  Type: [MySQL ▼]                    │
│                                     │
│  Host: [127.0.0.1    ] Port: [3306] │
│  Username: [root     ]              │
│  Password: [••••••••]               │
│  Database: [myapp    ]              │
│                                     │
│  [✓] Route through SSH tunnel       │
│                                     │
│  [Test Connection]                  │
│                                     │
│  [Cancel]              [Connect]    │
└─────────────────────────────────────┘
```

**Features:**
- Database type selector: MySQL / PostgreSQL (changes default port: 3306 / 5432)
- Host, port, username, password, database name fields
- "Use SSH Tunnel" toggle — enabled by default (since we're in an SSH session)
- Test Connection button — calls `sql:connect` then `sql:disconnect`
- Connect button — connects and closes dialog
- Form validation: required fields highlighted
- Loading state during connection attempt
- Error display on failure

**UI Components to reuse:** `<Modal>`, `<Input>`, `<Select>`, `<Button>`, `<Toggle>` from `src/components/ui/`

**Step 1: Implement the dialog component**

On submit:
```typescript
const sqlSessionId = `sql-${connectionId}-${crypto.randomUUID()}`
const result = await window.novadeck.sql.connect(sqlSessionId, connectionId, {
  type, host, port: Number(port), username, password, database,
  useSSHTunnel: true, ssl: false
})
```

On success: update `useSQLStore` with connection status + config, close dialog.

**Step 2: Commit**

```bash
git add src/components/sql/SQLConnectDialog.tsx
git commit -m "feat(sql): add database connection dialog"
```

---

## Task 2.2: Schema Sidebar

**Files:**
- Create: `src/components/sql/SchemaSidebar.tsx`

**What it does:** Left sidebar showing the database schema tree.

**UI Layout:**
```
┌────────────────────────┐
│ [myapp ▼]  [↻ Refresh] │
│ ┌────────────────────┐ │
│ │ 🔍 Search tables   │ │
│ └────────────────────┘ │
│                        │
│ ▼ Tables (24)          │
│   📋 age_ratings    42 │
│   📋 app_settings    3 │
│   📋 author_manga  1.2k│
│   📋 authors       890 │
│   📋 chapters     620k │  ← selected (highlighted)
│   📋 comments      15k │
│   📋 ...               │
│                        │
│ ▼ Views (2)            │
│   👁 active_users      │
│   👁 monthly_stats     │
└────────────────────────┘
```

**Features:**
- Database selector dropdown at top (fetches via `sql:getDatabases`)
- Refresh button — re-fetches tables
- Search input — filters table list by name (client-side)
- Two collapsible groups: "Tables" and "Views" with count badges
- Each table row shows: icon, name, approximate row count (formatted: 620k, 1.2M)
- **Single-click** → selects table, loads data in the main panel
- **Double-click** → opens table in a new SQL tab
- **Right-click context menu:** Open Data, Open Structure, Copy Table Name, Truncate Table, Drop Table
- Selected table has highlighted background
- Loading skeleton while fetching
- Empty state: "No tables found"

**Context menu component:** Reuse `<ContextMenu>` from `src/components/ui/ContextMenu.tsx`

**Data flow:**
```
1. On mount (after DB connect): call sql:getTables → store in sqlStore.tables
2. On table click: sqlStore.selectTable(name) → triggers data load in DataTabView
3. On database switch: re-fetch tables
```

**Step 1: Implement SchemaSidebar**

**Step 2: Commit**

```bash
git add src/components/sql/SchemaSidebar.tsx
git commit -m "feat(sql): add schema browser sidebar"
```

---

## Task 2.3: Full SQLView Layout

**Files:**
- Modify: `src/components/sql/SQLView.tsx`

**What it does:** Replace the placeholder with the full three-panel layout.

**UI Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│ [🔌 Connect to Database]  or  [DB: myapp ▼] [↻] [+ Query]  │
├───────────┬──────────────────────────────────────────────────┤
│           │ Tab Bar: [chapters ×] [users ×] [+ SQL Query ×]  │
│  Schema   ├──────────────────────────────────────────────────┤
│  Sidebar  │                                                  │
│           │           Main Content Area                      │
│  (240px   │   (DataTabView / QueryEditor / StructureView)    │
│  default, │                                                  │
│  resize-  │                                                  │
│  able)    ├──────────────────────────────────────────────────┤
│           │ Status: MySQL 8.0 | myapp | chapters | 620k rows │
└───────────┴──────────────────────────────────────────────────┘
```

**States:**
1. **Disconnected** → shows connect button / SQLConnectDialog
2. **Connecting** → shows loading spinner
3. **Connected** → shows full layout (sidebar + tabs + content + status)
4. **Error** → shows error message with retry button

**Implementation:**
- Uses `<Splitter>` for resizable sidebar (default 240px, min 180px, max 400px)
- Top toolbar: connection status, database name, refresh, new query tab button
- SQLConnectDialog shown as modal when clicking "Connect"
- On SSH disconnect: auto-disconnect SQL, reset store

**Step 1: Implement the full layout**

**Step 2: Commit**

```bash
git add src/components/sql/SQLView.tsx
git commit -m "feat(sql): implement full SQLView three-panel layout"
```
