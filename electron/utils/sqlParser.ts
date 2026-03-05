import { Readable } from 'stream'
import { createInterface } from 'readline'

// ── State machine states for SQL parsing ──

type ParserState =
  | 'normal'
  | 'single_quote'
  | 'double_quote'
  | 'backtick'
  | 'dollar_dollar'
  | 'block_comment'

/**
 * Split a SQL file stream into individual statements.
 * Handles:
 * - Multi-line statements
 * - String literals ('...', "...")
 * - Backtick identifiers (MySQL)
 * - $$ delimiters (PostgreSQL function bodies)
 * - DELIMITER changes (MySQL dumps: DELIMITER ;; ... DELIMITER ;)
 * - Multi-line comments
 * - Single-line comments (-- ..., # ...)
 * - Skips empty statements
 */
export async function* splitSQLStatements(stream: Readable): AsyncGenerator<string> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let state: ParserState = 'normal'
  // Use array-based buffering instead of string concatenation.
  // String concat (`buffer += line`) creates O(n) intermediate string objects per line,
  // which under heavy load (large SQL dumps) overwhelms V8's garbage collector and
  // causes OOM crashes. Array.push + join() at yield time avoids all intermediate copies.
  let bufferParts: string[] = []
  let delimiter = ';'

  for await (const line of rl) {
    // Handle DELIMITER directive (MySQL dumps) — only in normal state
    if (state === 'normal') {
      const delimMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i)
      if (delimMatch) {
        delimiter = delimMatch[1]
        continue
      }
    }

    // Append the line to the buffer parts (each line stored as a separate reference —
    // no copying until we actually yield a complete statement)
    bufferParts.push(line)

    // Process character-by-character to track state.
    // We use a mutable `scanLine` so that after yielding a statement we can
    // restart scanning on the remainder of the line with consistent indices.
    let scanLine = line
    let i = 0

    while (i < scanLine.length) {
      const ch = scanLine[i]
      const next = i + 1 < scanLine.length ? scanLine[i + 1] : ''

      switch (state) {
        case 'normal': {
          // Check for single-line comment: -- or #
          if (ch === '-' && next === '-') {
            i = scanLine.length
            continue
          }
          if (ch === '#') {
            i = scanLine.length
            continue
          }
          // Check for block comment start: /*
          if (ch === '/' && next === '*') {
            state = 'block_comment'
            i += 2
            continue
          }
          // Check for string/identifier openers
          if (ch === "'") {
            state = 'single_quote'
            i++
            continue
          }
          if (ch === '"') {
            state = 'double_quote'
            i++
            continue
          }
          if (ch === '`') {
            state = 'backtick'
            i++
            continue
          }
          // Check for PostgreSQL $$ delimiter
          if (ch === '$' && next === '$') {
            state = 'dollar_dollar'
            i += 2
            continue
          }
          // Check for statement delimiter
          const isDelim =
            delimiter.length === 1
              ? ch === delimiter
              : scanLine.substring(i, i + delimiter.length) === delimiter

          if (isDelim) {
            // Build statement from buffer parts.
            // scanLine is always the last element of bufferParts (either the original
            // line or a 'rest' from a previous delimiter within the same line).
            // Replace it with only the portion before the delimiter, then join once.
            bufferParts[bufferParts.length - 1] = scanLine.substring(0, i)
            const statement = bufferParts.join('\n').trim()
            if (statement.length > 0) {
              yield statement
            }
            // Reset: buffer and scanLine become the remainder after the delimiter
            const rest = scanLine.substring(i + delimiter.length)
            bufferParts = rest.length > 0 ? [rest] : []
            scanLine = rest
            i = 0
            continue
          }
          i++
          break
        }

        case 'single_quote': {
          if (ch === '\\') {
            i += 2
            continue
          }
          if (ch === "'" && next === "'") {
            i += 2
            continue
          }
          if (ch === "'") {
            state = 'normal'
          }
          i++
          break
        }

        case 'double_quote': {
          if (ch === '\\') {
            i += 2
            continue
          }
          if (ch === '"' && next === '"') {
            i += 2
            continue
          }
          if (ch === '"') {
            state = 'normal'
          }
          i++
          break
        }

        case 'backtick': {
          if (ch === '`' && next === '`') {
            i += 2
            continue
          }
          if (ch === '`') {
            state = 'normal'
          }
          i++
          break
        }

        case 'dollar_dollar': {
          if (ch === '$' && next === '$') {
            state = 'normal'
            i += 2
            continue
          }
          i++
          break
        }

        case 'block_comment': {
          if (ch === '*' && next === '/') {
            state = 'normal'
            i += 2
            continue
          }
          i++
          break
        }
      }
    }

  }

  // Yield any remaining content in buffer
  if (bufferParts.length > 0) {
    const finalStmt = bufferParts.join('\n').trim()
    if (finalStmt.length > 0) {
      yield finalStmt
    }
  }
}

// ── Dangerous statement patterns ──

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /^\s*DROP\s+(DATABASE|SCHEMA)\s/i, description: 'DROP DATABASE' },
  { pattern: /^\s*DROP\s+TABLE\s/i, description: 'DROP TABLE' },
  { pattern: /^\s*DROP\s+(VIEW|FUNCTION|PROCEDURE|TRIGGER)\s/i, description: 'DROP object' },
  { pattern: /^\s*TRUNCATE\s/i, description: 'TRUNCATE TABLE' },
  { pattern: /^\s*DELETE\s+FROM\s+\S+\s*;?\s*$/i, description: 'DELETE without WHERE' },
  { pattern: /^\s*(ALTER|CREATE)\s+USER/i, description: 'User modification' },
  { pattern: /^\s*GRANT\s/i, description: 'GRANT privileges' },
  { pattern: /^\s*REVOKE\s/i, description: 'REVOKE privileges' },
  { pattern: /INTO\s+(OUTFILE|DUMPFILE)/i, description: 'File export (INTO OUTFILE)' },
  { pattern: /^\s*COPY\s+.*\s+TO\s+/i, description: 'PostgreSQL COPY TO file' },
  { pattern: /^\s*\\!/m, description: 'psql shell escape (\\!)' },
  { pattern: /^\s*LOAD\s+DATA\s+(LOCAL\s+)?INFILE/i, description: 'LOAD DATA INFILE' },
]

/**
 * Pre-scan a SQL file for dangerous statements.
 * Returns descriptions of each dangerous statement found.
 * Used by import dialog to show confirmation before execution.
 */
export async function scanDangerousStatements(stream: Readable): Promise<string[]> {
  const found = new Set<string>()
  // All dangerous patterns match at the start of statements (^\s*...),
  // so we only need the first ~200 characters — avoids running regex on
  // multi-MB INSERT statements.
  const HEAD_SIZE = 200

  for await (const stmt of splitSQLStatements(stream)) {
    const head = stmt.length > HEAD_SIZE ? stmt.substring(0, HEAD_SIZE) : stmt
    for (const { pattern, description } of DANGEROUS_PATTERNS) {
      if (pattern.test(head)) {
        found.add(description)
      }
    }
  }

  return Array.from(found)
}

/**
 * Combined single-pass pre-scan: count statements AND detect dangerous patterns.
 * Avoids reading the file twice (once for count, once for scan).
 */
export async function preScanStatements(stream: Readable): Promise<{
  count: number
  dangerous: string[]
}> {
  let count = 0
  const found = new Set<string>()
  const HEAD_SIZE = 200

  for await (const stmt of splitSQLStatements(stream)) {
    count++
    const head = stmt.length > HEAD_SIZE ? stmt.substring(0, HEAD_SIZE) : stmt
    for (const { pattern, description } of DANGEROUS_PATTERNS) {
      if (pattern.test(head)) {
        found.add(description)
      }
    }
  }

  return { count, dangerous: Array.from(found) }
}

/**
 * Count approximate number of statements in a SQL file.
 * Fast scan — counts delimiter occurrences outside of string literals,
 * comments, and dollar-quoted blocks. Respects DELIMITER directives.
 */
export async function countStatements(stream: Readable): Promise<number> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let count = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inBlockComment = false
  let inDollarDollar = false
  let delimiter = ';'

  for await (const line of rl) {
    // Handle DELIMITER directive — only when not inside any quoted/comment context
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && !inBlockComment && !inDollarDollar) {
      const delimMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i)
      if (delimMatch) {
        delimiter = delimMatch[1]
        continue
      }
    }

    const len = line.length

    for (let i = 0; i < len; i++) {
      const ch = line[i]
      const next = i + 1 < len ? line[i + 1] : ''

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false
          i++
        }
        continue
      }

      if (inDollarDollar) {
        if (ch === '$' && next === '$') {
          inDollarDollar = false
          i++
        }
        continue
      }

      if (inSingleQuote) {
        if (ch === '\\') {
          i++
          continue
        }
        if (ch === "'" && next === "'") {
          i++
          continue
        }
        if (ch === "'") inSingleQuote = false
        continue
      }

      if (inDoubleQuote) {
        if (ch === '\\') {
          i++
          continue
        }
        if (ch === '"' && next === '"') {
          i++
          continue
        }
        if (ch === '"') inDoubleQuote = false
        continue
      }

      if (inBacktick) {
        if (ch === '`' && next === '`') {
          i++
          continue
        }
        if (ch === '`') inBacktick = false
        continue
      }

      // Normal state
      if (ch === '-' && next === '-') break // rest of line is comment
      if (ch === '#') break
      if (ch === '/' && next === '*') {
        inBlockComment = true
        i++
        continue
      }
      if (ch === '$' && next === '$') {
        inDollarDollar = true
        i++
        continue
      }
      if (ch === "'") {
        inSingleQuote = true
        continue
      }
      if (ch === '"') {
        inDoubleQuote = true
        continue
      }
      if (ch === '`') {
        inBacktick = true
        continue
      }

      // Check for delimiter match
      if (delimiter.length === 1) {
        if (ch === delimiter) {
          count++
        }
      } else {
        const remaining = line.substring(i, i + delimiter.length)
        if (remaining === delimiter) {
          count++
          i += delimiter.length - 1
        }
      }
    }
  }

  return count
}
