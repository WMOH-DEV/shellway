# Phase 4: SQL Query Editor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Depends on:** [Phase 2](./02-connection-schema.md)
> **Back to:** [Overview](./00-overview.md)

---

## Task 4.1: Install Monaco Editor

**Files:**
- Modify: `package.json`

```bash
npm install @monaco-editor/react
```

Monaco Editor is the same engine that powers VS Code. It provides:
- SQL syntax highlighting
- Autocomplete framework
- Multi-cursor editing
- Code folding
- Minimap
- Find & replace
- Bracket matching

**Step 1: Install**

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @monaco-editor/react for SQL editor"
```

---

## Task 4.2: Query Editor Component

**Files:**
- Create: `src/components/sql/QueryEditor.tsx`

**What it does:** Full SQL query editor with Monaco, split with results grid below.

**UI Layout:**
```
┌──────────────────────────────────────────┐
│ ▶ Run (⌘↵)  ▶| Run Selected  |  Format  │  ← Toolbar
├──────────────────────────────────────────┤
│                                          │
│  SELECT u.*, COUNT(o.id) as order_count  │
│  FROM users u                            │
│  LEFT JOIN orders o ON o.user_id = u.id  │
│  WHERE u.created_at > '2025-01-01'       │
│  GROUP BY u.id                           │
│  LIMIT 100;                              │
│                                          │  ← Monaco Editor
├── drag to resize ────────────────────────┤
│ ✓ 100 rows | 24ms | 6 columns           │  ← Results header
├──────────────────────────────────────────┤
│                                          │
│  Results Data Grid                       │
│  (reuses DataGrid component from Phase 3)│
│                                          │
└──────────────────────────────────────────┘
```

**Features:**
- Monaco editor configured with SQL language mode
- Dark theme matching Shellway (custom theme derived from `nd-*` tokens)
- **Run Query:** `Cmd+Enter` — executes entire editor content (or selected text if selection exists)
- **Run Single Statement:** `Cmd+Shift+Enter` — executes only the statement under cursor
- **Format SQL:** `Cmd+Shift+F` — reformats the SQL (basic indentation)
- Multiple statement support — splits on `;`, runs sequentially
- Results shown in `<DataGrid>` below (reuses Phase 3 component)
- Resizable split between editor and results via `<Splitter direction="vertical">`
- **Error display:** red banner with error message + position highlight in editor
- Results header: shows row count, execution time, column count
- No results state: "Run a query to see results" placeholder
- Tab key inserts 2 spaces (not a tab character)
- Line numbers enabled, minimap disabled (default, can toggle)

**Monaco Configuration:**
```typescript
const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  language: 'sql',
  theme: 'shellway-dark',         // Custom theme
  minimap: { enabled: false },
  fontSize: 13,
  lineNumbers: 'on',
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  suggestOnTriggerCharacters: true,
  quickSuggestions: true,
  padding: { top: 8 },
}
```

**Custom Theme Registration:**
```typescript
monaco.editor.defineTheme('shellway-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '38bdf8', fontStyle: 'bold' },
    { token: 'string', foreground: '86efac' },
    { token: 'number', foreground: 'fbbf24' },
    { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#0f1117',
    'editor.foreground': '#e2e8f0',
    'editor.lineHighlightBackground': '#1e293b40',
    'editor.selectionBackground': '#38bdf830',
    'editorCursor.foreground': '#38bdf8',
  }
})
```

**Step 1: Implement QueryEditor component**

**Step 2: Commit**

```bash
git add src/components/sql/QueryEditor.tsx
git commit -m "feat(sql): add Monaco-powered SQL query editor with results"
```

---

## Task 4.3: SQL Autocomplete Provider

**Files:**
- Create: `src/components/sql/sqlAutocomplete.ts`

**What it does:** Custom Monaco completion provider for SQL with schema-aware suggestions.

**Completion Categories:**

1. **SQL Keywords** (always available):
   `SELECT, FROM, WHERE, JOIN, LEFT JOIN, RIGHT JOIN, INNER JOIN, ON, AND, OR, NOT, IN, BETWEEN, LIKE, IS NULL, IS NOT NULL, ORDER BY, GROUP BY, HAVING, LIMIT, OFFSET, INSERT INTO, UPDATE, SET, DELETE FROM, CREATE TABLE, ALTER TABLE, DROP TABLE, COUNT, SUM, AVG, MIN, MAX, DISTINCT, AS, UNION, CASE, WHEN, THEN, ELSE, END, EXISTS, ALL, ANY`

2. **Table Names** (from store's `tables[]`):
   Suggested after `FROM`, `JOIN`, `INTO`, `UPDATE`, `TABLE`

3. **Column Names** (from store's `columns[]` for selected table):
   Suggested after `SELECT`, `WHERE`, `ON`, `SET`, `ORDER BY`, `GROUP BY`, and after a `.` following a table alias

4. **Database Names** (from store's `databases[]`):
   Suggested after `USE`, `DATABASE`

5. **SQL Functions**:
   `NOW(), CURDATE(), CONCAT(), SUBSTRING(), LENGTH(), TRIM(), UPPER(), LOWER(), COALESCE(), IFNULL(), NULLIF(), CAST(), CONVERT(), DATE_FORMAT(), DATE_ADD(), DATE_SUB()`

**Registration:**
```typescript
export function registerSQLCompletionProvider(
  monaco: typeof import('monaco-editor'),
  getSchema: () => { tables: SchemaTable[]; columns: SchemaColumn[]; databases: string[] }
): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems(model, position) {
      // ... analyze context and return suggestions
    }
  })
}
```

**Step 1: Implement autocomplete provider**

**Step 2: Commit**

```bash
git add src/components/sql/sqlAutocomplete.ts
git commit -m "feat(sql): add schema-aware SQL autocomplete for Monaco"
```
