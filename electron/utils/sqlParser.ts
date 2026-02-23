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
  let buffer = ''
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

    // Append the line to the buffer (preserve newlines for multi-line statements)
    if (buffer.length > 0) {
      buffer += '\n'
    }
    buffer += line

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
            // Everything in the buffer up to (but not including) this delimiter
            // is the current statement. The buffer currently ends with the full
            // scanLine; we need to chop off from the delimiter position onward.
            const charsFromDelimToEnd = scanLine.length - i
            const statement = buffer.substring(0, buffer.length - charsFromDelimToEnd).trim()
            if (statement.length > 0) {
              yield statement
            }
            // Reset: buffer and scanLine become the remainder after the delimiter
            const rest = scanLine.substring(i + delimiter.length)
            buffer = rest
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
  const finalStmt = buffer.trim()
  if (finalStmt.length > 0) {
    yield finalStmt
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

  for await (const stmt of splitSQLStatements(stream)) {
    for (const { pattern, description } of DANGEROUS_PATTERNS) {
      if (pattern.test(stmt)) {
        found.add(description)
      }
    }
  }

  return Array.from(found)
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
