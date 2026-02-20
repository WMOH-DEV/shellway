# Phase 5: Advanced Filters (TablePlus-Style)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Depends on:** [Phase 3](./03-data-browser.md)
> **Back to:** [Overview](./00-overview.md)

---

## Task 5.1: Filter Bar Component

**Files:**
- Create: `src/components/sql/FilterBar.tsx`

**What it does:** Replicates TablePlus's powerful stacking filter system above the data grid.

**UI Layout (matches the TablePlus screenshot):**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ [✓] [Raw SQL   ▼] [          ] [`id` = 934115                ] [Apply]│
│ [✓] [scrape_url▼] [Contains ▼] [https://lekmanga.site/manga/ ] [Apply]│
│ [✓] [manga_id  ▼] [=        ▼] [20897                        ] [Apply]│
│ [✓] [scrape_url▼] [Contains ▼] [https://hijala.com/bully-    ] [Apply]│
│ [✓] [Raw SQL   ▼] [          ] [`id` = 920595                ] [Apply]│
├─────────────────────────────────────────────────────────────────────────┤
│ [+ Add Filter]  |  Show: ⌘F  Insert: ⌘I  Remove: ⌘⌫                   │
│ Apply All: ⌘↵  Up: ⌘↑  Down: ⌘↓  Columns: ⌘←  Operators: ⌘→         │
│ On/Off: ⌘B  Exit: Esc                                                  │
│ [Clear]                                              [Apply All]       │
└─────────────────────────────────────────────────────────────────────────┘
```

**Each filter row consists of:**
1. **Enable checkbox** — toggle filter on/off without removing it
2. **Column selector** — dropdown of all table columns + "Raw SQL" option
3. **Operator selector** — depends on column type (hidden for Raw SQL mode)
4. **Value input** — text input for the filter value
5. **Apply button** — applies this single filter
6. **Remove button (×)** — removes this filter row

**Operator sets by column type:**

| Column Type | Available Operators |
|------------|-------------------|
| **String** (varchar, text, char) | equals, not_equals, contains, not_contains, starts_with, ends_with, is_null, is_not_null |
| **Number** (int, bigint, decimal, float) | equals, not_equals, greater_than, less_than, greater_or_equal, less_or_equal, between, in, is_null, is_not_null |
| **Date/Time** (date, datetime, timestamp) | equals, greater_than, less_than, between, is_null, is_not_null |
| **Boolean** (tinyint(1), boolean) | equals, is_null, is_not_null |
| **Raw SQL** | (no operator — user types raw WHERE clause) |

**Features:**
- `+ Add Filter` button adds a new empty filter row
- "Apply All" button applies all enabled filters at once (re-queries)
- "Clear" button removes all filters
- Filters stack — multiple filters are AND-ed together
- Raw SQL filters allow arbitrary WHERE clauses (power user feature)
- Keyboard shortcut: `Cmd+F` to add a new filter and focus it
- Visual indicator when filters are active (badge on filter icon)
- Collapsible — can hide the filter bar to save space

**Step 1: Implement FilterBar component**

**Step 2: Commit**

```bash
git add src/components/sql/FilterBar.tsx
git commit -m "feat(sql): add TablePlus-style advanced filter bar"
```

---

## Task 5.2: Filter → SQL WHERE Clause Builder

**Files:**
- Create: `src/utils/sqlFilterBuilder.ts`

**What it does:** Pure function converting filter UI state into parameterized SQL WHERE clauses.

```typescript
interface FilterBuildResult {
  where: string       // e.g., "WHERE `name` LIKE ? AND `age` > ? AND (`id` = 934115)"
  params: unknown[]   // e.g., ['%john%', 25]
}

export function buildWhereClause(
  filters: TableFilter[],
  dbType: 'mysql' | 'postgres'
): FilterBuildResult
```

**Operator → SQL mapping:**

| Operator | MySQL | Postgres |
|----------|-------|----------|
| equals | `col = ?` | `col = $1` |
| not_equals | `col != ?` | `col != $1` |
| contains | `col LIKE ?` (wrap value in `%`) | `col ILIKE $1` |
| not_contains | `col NOT LIKE ?` | `col NOT ILIKE $1` |
| starts_with | `col LIKE ?` (append `%`) | `col ILIKE $1` |
| ends_with | `col LIKE ?` (prepend `%`) | `col ILIKE $1` |
| greater_than | `col > ?` | `col > $1` |
| less_than | `col < ?` | `col < $1` |
| greater_or_equal | `col >= ?` | `col >= $1` |
| less_or_equal | `col <= ?` | `col <= $1` |
| is_null | `col IS NULL` | `col IS NULL` |
| is_not_null | `col IS NOT NULL` | `col IS NOT NULL` |
| in | `col IN (?, ?, ...)` | `col = ANY($1::text[])` |
| not_in | `col NOT IN (?, ?, ...)` | `col != ALL($1::text[])` |
| between | `col BETWEEN ? AND ?` | `col BETWEEN $1 AND $2` |
| raw_sql | Appended as-is (no params) | Appended as-is |

**Important:**
- Column names quoted: backticks for MySQL, double-quotes for Postgres
- Only enabled filters are included
- Raw SQL filters are **not parameterized** (user is responsible for SQL)
- Show a warning icon next to raw SQL filters (potential injection if used carelessly)
- Multiple filters joined with `AND`
- Empty/disabled filters are skipped

**Step 1: Implement buildWhereClause**

**Step 2: Write unit tests** (pure function, easy to test):
```typescript
// Test: single equals filter
// Test: multiple filters AND-ed
// Test: raw SQL filter appended
// Test: disabled filters skipped
// Test: LIKE patterns for contains/starts_with/ends_with
// Test: NULL handling
// Test: BETWEEN with two values
// Test: MySQL vs Postgres placeholder style
```

**Step 3: Commit**

```bash
git add src/utils/sqlFilterBuilder.ts
git commit -m "feat(sql): add parameterized WHERE clause builder for filters"
```
