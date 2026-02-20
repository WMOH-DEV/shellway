import type { SchemaTable, SchemaColumn } from '@/types/sql'

type Monaco = typeof import('monaco-editor')
type CompletionItem = import('monaco-editor').languages.CompletionItem

interface SchemaInfo {
  tables: SchemaTable[]
  columns: SchemaColumn[]
  databases: string[]
}

// ── SQL keywords ──

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
  'OUTER JOIN', 'CROSS JOIN', 'ON', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
  'LIKE', 'IS NULL', 'IS NOT NULL', 'ORDER BY', 'GROUP BY', 'HAVING',
  'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
  'DISTINCT', 'AS', 'UNION', 'UNION ALL', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'EXISTS', 'ALL', 'ANY', 'ASC', 'DESC', 'WITH',
  'RETURNING', 'IF EXISTS', 'IF NOT EXISTS', 'USE', 'SHOW', 'DESCRIBE',
  'EXPLAIN', 'CREATE INDEX', 'DROP INDEX', 'TRUNCATE', 'BEGIN',
  'COMMIT', 'ROLLBACK', 'GRANT', 'REVOKE'
]

// ── SQL functions ──

const SQL_FUNCTIONS = [
  { label: 'COUNT', detail: 'COUNT(expression)' },
  { label: 'SUM', detail: 'SUM(expression)' },
  { label: 'AVG', detail: 'AVG(expression)' },
  { label: 'MIN', detail: 'MIN(expression)' },
  { label: 'MAX', detail: 'MAX(expression)' },
  { label: 'NOW', detail: 'NOW()' },
  { label: 'CURDATE', detail: 'CURDATE()' },
  { label: 'CONCAT', detail: 'CONCAT(str1, str2, ...)' },
  { label: 'SUBSTRING', detail: 'SUBSTRING(str, pos, len)' },
  { label: 'LENGTH', detail: 'LENGTH(str)' },
  { label: 'TRIM', detail: 'TRIM(str)' },
  { label: 'UPPER', detail: 'UPPER(str)' },
  { label: 'LOWER', detail: 'LOWER(str)' },
  { label: 'COALESCE', detail: 'COALESCE(val1, val2, ...)' },
  { label: 'IFNULL', detail: 'IFNULL(expr, alt)' },
  { label: 'NULLIF', detail: 'NULLIF(expr1, expr2)' },
  { label: 'CAST', detail: 'CAST(expr AS type)' },
  { label: 'CONVERT', detail: 'CONVERT(expr, type)' },
  { label: 'DATE_FORMAT', detail: 'DATE_FORMAT(date, format)' },
  { label: 'DATE_ADD', detail: 'DATE_ADD(date, INTERVAL expr unit)' },
  { label: 'DATE_SUB', detail: 'DATE_SUB(date, INTERVAL expr unit)' }
]

// Context keywords that trigger table suggestions
const TABLE_CONTEXT_KEYWORDS = ['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE']
// Context keywords that trigger column suggestions
const COLUMN_CONTEXT_KEYWORDS = ['SELECT', 'WHERE', 'ON', 'SET', 'ORDER BY', 'GROUP BY', 'HAVING']
// Context keywords that trigger database suggestions
const DATABASE_CONTEXT_KEYWORDS = ['USE', 'DATABASE']

/**
 * Analyses the text before the cursor to determine what the user
 * is likely trying to complete.
 */
function getCompletionContext(textBeforeCursor: string): {
  wantsTable: boolean
  wantsColumn: boolean
  wantsDatabase: boolean
  tablePrefix: string | null // e.g. "users." → "users"
} {
  // Normalise whitespace and uppercase for matching
  const trimmed = textBeforeCursor.replace(/\s+/g, ' ').trimEnd().toUpperCase()

  // Check for "tablename." pattern → want column completion for that table
  const dotMatch = textBeforeCursor.match(/(\w+)\.\s*$/)
  if (dotMatch) {
    return { wantsTable: false, wantsColumn: true, wantsDatabase: false, tablePrefix: dotMatch[1] }
  }

  // Look for the last significant keyword
  const lastKeywordPattern = new RegExp(
    '\\b(' +
      [...TABLE_CONTEXT_KEYWORDS, ...COLUMN_CONTEXT_KEYWORDS, ...DATABASE_CONTEXT_KEYWORDS]
        .map((k) => k.replace(/\s+/g, '\\s+'))
        .join('|') +
    ')\\b',
    'gi'
  )

  let lastMatch: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  while ((match = lastKeywordPattern.exec(trimmed)) !== null) {
    lastMatch = match
  }

  if (!lastMatch) {
    return { wantsTable: false, wantsColumn: false, wantsDatabase: false, tablePrefix: null }
  }

  const keyword = lastMatch[1].replace(/\s+/g, ' ').toUpperCase()

  return {
    wantsTable: TABLE_CONTEXT_KEYWORDS.includes(keyword),
    wantsColumn: COLUMN_CONTEXT_KEYWORDS.includes(keyword),
    wantsDatabase: DATABASE_CONTEXT_KEYWORDS.includes(keyword),
    tablePrefix: null
  }
}

/**
 * Registers a Monaco completion provider for SQL that provides
 * schema-aware suggestions for keywords, tables, columns, databases, and functions.
 */
export function registerSQLCompletionProvider(
  monaco: Monaco,
  getSchema: () => SchemaInfo
): import('monaco-editor').IDisposable {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems(model, position) {
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })

      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn
      }

      const ctx = getCompletionContext(textBeforeCursor)
      const suggestions: CompletionItem[] = []

      const Kind = monaco.languages.CompletionItemKind
      const schema = getSchema()

      // ── Table suggestions ──
      if (ctx.wantsTable) {
        for (const table of schema.tables) {
          suggestions.push({
            label: table.name,
            kind: table.type === 'view' ? Kind.Interface : Kind.Struct,
            detail: table.type === 'view' ? 'View' : 'Table',
            insertText: table.name,
            range
          } as CompletionItem)
        }
      }

      // ── Column suggestions (after dot or after column-context keyword) ──
      if (ctx.wantsColumn) {
        const columns = ctx.tablePrefix
          ? schema.columns // When prefixed, show all loaded columns (they belong to the selected table)
          : schema.columns

        for (const col of columns) {
          suggestions.push({
            label: col.name,
            kind: Kind.Field,
            detail: `${col.type}${col.nullable ? ' | NULL' : ''}`,
            insertText: col.name,
            range
          } as CompletionItem)
        }
      }

      // ── Database suggestions ──
      if (ctx.wantsDatabase) {
        for (const db of schema.databases) {
          suggestions.push({
            label: db,
            kind: Kind.Module,
            detail: 'Database',
            insertText: db,
            range
          } as CompletionItem)
        }
      }

      // ── SQL keywords (always shown, lower priority) ──
      if (!ctx.wantsTable && !ctx.wantsDatabase) {
        for (const kw of SQL_KEYWORDS) {
          suggestions.push({
            label: kw,
            kind: Kind.Keyword,
            insertText: kw,
            range,
            sortText: '~~' + kw // Push below table/column suggestions
          } as CompletionItem)
        }
      }

      // ── SQL functions (always shown) ──
      if (!ctx.wantsTable && !ctx.wantsDatabase) {
        for (const fn of SQL_FUNCTIONS) {
          suggestions.push({
            label: fn.label,
            kind: Kind.Function,
            detail: fn.detail,
            insertText: fn.label + '($0)',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: '~' + fn.label
          } as CompletionItem)
        }
      }

      return { suggestions }
    }
  })
}
