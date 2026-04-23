/**
 * Split a SQL string into individual statements on top-level `;`.
 *
 * Respects the syntactic contexts where a semicolon is NOT a statement
 * separator:
 *  - Single-quoted string literals:   'abc; def'
 *  - Double-quoted identifiers/strings: "abc; def"
 *  - MySQL backtick identifiers:       `abc;def`
 *  - Line comments:    -- ... to end of line
 *  - Block comments:   /* ... *\/  (non-nested; the common SQL variant)
 *  - Postgres dollar-quoted bodies:   $$ ... $$   $tag$ ... $tag$
 *
 * Escapes handled:
 *  - Standard SQL doubled-quote escape: 'it''s' stays inside the string.
 *  - Backslash escape inside single-quoted strings (MySQL default). Harmless
 *    for Postgres because `\'` also keeps us inside the string.
 *
 * Returns the trimmed non-empty statements in order. Semicolons are stripped
 * from the returned statements.
 */
export function splitSQLStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let i = 0
  const n = sql.length

  type State =
    | 'normal'
    | 'single'
    | 'double'
    | 'backtick'
    | 'line-comment'
    | 'block-comment'
    | 'dollar'
  let state: State = 'normal'
  let dollarTag = '' // e.g. '$$' or '$foo$'

  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]

    if (state === 'normal') {
      // Line comment
      if (c === '-' && next === '-') {
        state = 'line-comment'
        buf += c + next
        i += 2
        continue
      }
      // Block comment
      if (c === '/' && next === '*') {
        state = 'block-comment'
        buf += c + next
        i += 2
        continue
      }
      // Dollar-quoted string (Postgres): $tag$ or $$
      if (c === '$') {
        // Match $tag$ where tag is [A-Za-z_][A-Za-z0-9_]* (or empty for $$)
        const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i))
        if (m) {
          dollarTag = m[0]
          state = 'dollar'
          buf += dollarTag
          i += dollarTag.length
          continue
        }
      }
      if (c === "'") {
        state = 'single'
        buf += c
        i++
        continue
      }
      if (c === '"') {
        state = 'double'
        buf += c
        i++
        continue
      }
      if (c === '`') {
        state = 'backtick'
        buf += c
        i++
        continue
      }
      if (c === ';') {
        const trimmed = buf.trim()
        if (trimmed) out.push(trimmed)
        buf = ''
        i++
        continue
      }
      buf += c
      i++
      continue
    }

    if (state === 'line-comment') {
      buf += c
      if (c === '\n') state = 'normal'
      i++
      continue
    }

    if (state === 'block-comment') {
      buf += c
      if (c === '*' && next === '/') {
        buf += next
        i += 2
        state = 'normal'
        continue
      }
      i++
      continue
    }

    if (state === 'single') {
      buf += c
      if (c === '\\' && i + 1 < n) {
        // Escaped char (MySQL) — consume the next char verbatim
        buf += next
        i += 2
        continue
      }
      if (c === "'") {
        // Doubled '' = literal quote, stay in string
        if (next === "'") {
          buf += next
          i += 2
          continue
        }
        state = 'normal'
      }
      i++
      continue
    }

    if (state === 'double') {
      buf += c
      if (c === '"') {
        if (next === '"') {
          buf += next
          i += 2
          continue
        }
        state = 'normal'
      }
      i++
      continue
    }

    if (state === 'backtick') {
      buf += c
      if (c === '`') {
        if (next === '`') {
          buf += next
          i += 2
          continue
        }
        state = 'normal'
      }
      i++
      continue
    }

    if (state === 'dollar') {
      // Look for the closing tag
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag
        i += dollarTag.length
        state = 'normal'
        dollarTag = ''
        continue
      }
      buf += c
      i++
      continue
    }
  }

  const tail = buf.trim()
  if (tail) out.push(tail)
  return out
}
