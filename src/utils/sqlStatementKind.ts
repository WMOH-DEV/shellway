import { splitSQLStatements } from './splitSQL'

export type StatementKind = 'read' | 'transaction' | 'write' | 'schema'

export interface StatementRisk {
  verb: string
  kind: StatementKind
  unbounded: boolean
}

export interface BatchRisk {
  statementCount: number
  highest: StatementKind
  unboundedCount: number
  statements: StatementRisk[]
}

export const KIND_LABEL: Record<StatementKind, string> = {
  read: 'Read only',
  transaction: 'Transaction control',
  write: 'Modifies data',
  schema: 'Modifies schema'
}

const KIND_RANK: Record<StatementKind, number> = {
  read: 0,
  transaction: 1,
  write: 2,
  schema: 3
}

const READ_VERBS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'TABLE', 'VALUES'])

const TRANSACTION_VERBS = new Set([
  'BEGIN',
  'START',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'SET',
  'USE',
  'LOCK',
  'UNLOCK'
])

const WRITE_VERBS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'MERGE',
  'UPSERT',
  'CALL',
  'DO',
  'LOAD',
  'COPY'
])

const SCHEMA_VERBS = new Set([
  'DROP',
  'TRUNCATE',
  'ALTER',
  'RENAME',
  'CREATE',
  'GRANT',
  'REVOKE',
  'FLUSH',
  'RESET',
  'KILL',
  'SHUTDOWN',
  'VACUUM',
  'ANALYZE',
  'OPTIMIZE',
  'REPAIR',
  'REINDEX',
  'CLUSTER'
])

function stripCommentsAndStrings(sql: string): string {
  let out = ''
  let i = 0
  const n = sql.length

  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }

    if (ch === '#') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }

    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < n) {
        if (sql[i] === '\\') {
          i += 2
          continue
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      out += ' '
      continue
    }

    out += ch
    i++
  }

  return out
}

function tokenize(bare: string): string[] {
  return bare
    .split(/[^A-Za-z_]+/)
    .filter(Boolean)
    .map((word) => word.toUpperCase())
}

function verbToKind(verb: string): StatementKind {
  if (READ_VERBS.has(verb)) return 'read'
  if (TRANSACTION_VERBS.has(verb)) return 'transaction'
  if (SCHEMA_VERBS.has(verb)) return 'schema'
  return 'write'
}

function findMutatingVerb(tokens: string[]): string | undefined {
  return tokens.find(
    (token) =>
      token !== 'ANALYZE' && (WRITE_VERBS.has(token) || SCHEMA_VERBS.has(token))
  )
}

export function classifyStatement(sql: string): StatementRisk {
  const bare = stripCommentsAndStrings(sql).trim()
  const tokens = tokenize(bare)

  if (tokens.length === 0) {
    return { verb: '', kind: 'read', unbounded: false }
  }

  let verb = tokens[0]

  if (verb === 'WITH') {
    verb = findMutatingVerb(tokens.slice(1)) ?? 'SELECT'
  } else if (verb === 'EXPLAIN') {
    const rest = tokens.slice(1)
    if (!rest.includes('ANALYZE')) {
      return { verb: 'EXPLAIN', kind: 'read', unbounded: false }
    }
    verb = findMutatingVerb(rest) ?? 'SELECT'
  }

  const unbounded =
    (verb === 'UPDATE' || verb === 'DELETE') && !/\bWHERE\b/i.test(bare)

  return { verb, kind: verbToKind(verb), unbounded }
}

export function classifyBatch(sql: string): BatchRisk {
  const statements = splitSQLStatements(sql)
    .filter((part) => part.trim())
    .map(classifyStatement)

  let highest: StatementKind = 'read'
  let unboundedCount = 0

  for (const statement of statements) {
    if (KIND_RANK[statement.kind] > KIND_RANK[highest]) highest = statement.kind
    if (statement.unbounded) unboundedCount++
  }

  return {
    statementCount: statements.length,
    highest,
    unboundedCount,
    statements
  }
}

export function isReadOnlyBatch(risk: BatchRisk): boolean {
  return risk.statements.every(
    (statement) => statement.kind === 'read' || statement.kind === 'transaction'
  )
}
