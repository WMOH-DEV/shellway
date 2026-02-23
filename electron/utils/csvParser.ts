import { Readable } from 'stream'
import { createReadStream, statSync } from 'fs'
import { createInterface } from 'readline'

// ── BOM detection ──

const BOM = '\uFEFF'

/**
 * Parse a CSV stream into rows (array of string arrays).
 * RFC 4180 compliant: handles quoted fields, embedded newlines, embedded quotes.
 * Yields one row at a time for memory efficiency.
 */
export async function* parseCSVStream(
  stream: Readable,
  delimiter: string = ','
): AsyncGenerator<string[]> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let pending = '' // Carries partial rows when a quoted field spans multiple lines
  let isFirstLine = true

  for await (const rawLine of rl) {
    let line = rawLine
    // Strip BOM from first line
    if (isFirstLine) {
      if (line.startsWith(BOM)) {
        line = line.substring(1)
      }
      isFirstLine = false
    }

    // If we have a pending partial row (open quoted field), append this line
    if (pending.length > 0) {
      pending += '\n' + line
    } else {
      pending = line
    }

    // Try to parse the pending buffer into a complete row
    const result = tryParseRow(pending, delimiter)
    if (result !== null) {
      yield result
      pending = ''
    }
    // If result is null, the row is incomplete (open quoted field spans next line)
  }

  // If anything remains in pending, parse what we can (malformed trailing data)
  if (pending.length > 0) {
    const result = tryParseRow(pending, delimiter)
    if (result !== null) {
      yield result
    } else {
      // Force-close: treat remaining as a single field
      yield [pending]
    }
  }
}

/**
 * Try to parse a complete CSV row from the buffer.
 * Returns null if the row is incomplete (open quoted field).
 */
function tryParseRow(line: string, delimiter: string): string[] | null {
  const fields: string[] = []
  let i = 0
  const len = line.length

  while (i <= len) {
    if (i === len) {
      // Trailing delimiter produced an empty final field
      fields.push('')
      break
    }

    if (line[i] === '"') {
      // Quoted field
      let value = ''
      let closedQuote = false
      i++ // skip opening quote

      while (i < len) {
        if (line[i] === '"') {
          if (i + 1 < len && line[i + 1] === '"') {
            // Escaped quote ("")
            value += '"'
            i += 2
          } else {
            // Closing quote found
            closedQuote = true
            i++ // skip closing quote
            break
          }
        } else {
          value += line[i]
          i++
        }
      }

      // If the inner loop exhausted the buffer without finding a closing quote,
      // the field spans multiple lines — signal incomplete row
      if (!closedQuote) {
        return null
      }

      // Closing quote was found — determine what follows
      const atEnd = i === len
      const atDelimiter = i < len && line.substring(i, i + delimiter.length) === delimiter

      if (atEnd) {
        fields.push(value)
        break
      } else if (atDelimiter) {
        fields.push(value)
        i += delimiter.length
        if (i === len) {
          fields.push('')
          break
        }
        continue
      } else {
        // Unexpected character after closing quote — absorb until delimiter
        while (i < len && line.substring(i, i + delimiter.length) !== delimiter) {
          value += line[i]
          i++
        }
        fields.push(value)
        if (i < len) {
          i += delimiter.length
          if (i === len) {
            fields.push('')
            break
          }
        } else {
          break
        }
        continue
      }
    } else {
      // Unquoted field
      let value = ''
      while (i < len && line.substring(i, i + delimiter.length) !== delimiter) {
        value += line[i]
        i++
      }
      fields.push(value)
      if (i < len) {
        i += delimiter.length
        if (i === len) {
          fields.push('')
          break
        }
        continue
      }
      break
    }
  }

  return fields
}

// ── Delimiter detection ──

const CANDIDATE_DELIMITERS = [',', '\t', ';', '|'] as const

/**
 * Detect the most likely delimiter from a sample of CSV content.
 * Analyzes the first 5 lines and picks the delimiter that produces
 * the most consistent column count.
 */
export function detectCSVDelimiter(sample: string): ',' | '\t' | ';' | '|' {
  // Strip BOM if present
  const clean = sample.startsWith(BOM) ? sample.substring(1) : sample

  // Split into first 5 non-empty lines
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const sampleLines = lines.slice(0, 5)

  if (sampleLines.length === 0) return ','

  let bestDelimiter: ',' | '\t' | ';' | '|' = ','
  let bestScore = -1

  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = sampleLines.map((line) => countFieldsInLine(line, delim))

    // All lines should have the same count, and > 1 column
    const allSame = counts.every((c) => c === counts[0])
    const columnCount = counts[0]

    if (allSame && columnCount > 1) {
      // Score: consistency (all same) * column count
      // Higher column count is better — means the delimiter actually splits
      const score = columnCount * 1000 + (CANDIDATE_DELIMITERS.length - CANDIDATE_DELIMITERS.indexOf(delim))
      if (score > bestScore) {
        bestScore = score
        bestDelimiter = delim
      }
    }
  }

  // If no delimiter produced consistent columns > 1, fall back to comma
  return bestDelimiter
}

/** Count fields in a single line using a delimiter (respecting quotes) */
function countFieldsInLine(line: string, delimiter: string): number {
  let count = 1
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (!inQuotes && line.substring(i, i + delimiter.length) === delimiter) {
      count++
      i += delimiter.length - 1
    }
  }

  return count
}

// ── Type inference ──

const INTEGER_RE = /^-?\d+$/
const DECIMAL_RE = /^-?\d+\.\d+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/
const BOOLEAN_RE = /^(true|false|0|1)$/i

/**
 * Infer SQL column types from sample data rows.
 * Conservative — defaults to VARCHAR(255) when ambiguous.
 */
export function inferColumnTypes(
  headers: string[],
  sampleRows: string[][],
  dbType: 'mysql' | 'postgres'
): string[] {
  return headers.map((_, colIdx) => {
    const values = sampleRows
      .map((row) => row[colIdx] ?? '')
      .filter((v) => v.length > 0) // skip empty values for inference

    if (values.length === 0) {
      return dbType === 'mysql' ? 'VARCHAR(255)' : 'TEXT'
    }

    // Check types in order of specificity
    if (values.every((v) => BOOLEAN_RE.test(v))) {
      return dbType === 'mysql' ? 'TINYINT(1)' : 'BOOLEAN'
    }
    if (values.every((v) => INTEGER_RE.test(v))) {
      return dbType === 'mysql' ? 'INT' : 'INTEGER'
    }
    if (values.every((v) => DECIMAL_RE.test(v))) {
      return dbType === 'mysql' ? 'DECIMAL(10,2)' : 'NUMERIC(10,2)'
    }
    if (values.every((v) => DATE_RE.test(v))) {
      return 'DATE'
    }
    if (values.every((v) => DATETIME_RE.test(v))) {
      return dbType === 'mysql' ? 'DATETIME' : 'TIMESTAMP'
    }

    return dbType === 'mysql' ? 'VARCHAR(255)' : 'TEXT'
  })
}

// ── CSV Preview ──

/**
 * Preview a CSV file: read first N rows, detect delimiter, count approximate total lines.
 */
export async function previewCSV(
  filePath: string,
  maxRows: number = 10
): Promise<{
  headers: string[]
  sampleRows: string[][]
  totalLines: number
  detectedDelimiter: ',' | '\t' | ';' | '|'
  fileSize: number
}> {
  const stat = statSync(filePath)
  const fileSize = stat.size

  // Step 1: Read first 8KB to detect delimiter
  const sampleStream = createReadStream(filePath, { start: 0, end: Math.min(8191, fileSize - 1) })
  let sampleText = ''
  for await (const chunk of sampleStream) {
    sampleText += chunk.toString('utf-8')
  }
  const detectedDelimiter = detectCSVDelimiter(sampleText)

  // Step 2: Read first maxRows + 1 rows (first is header)
  const dataStream = createReadStream(filePath, { encoding: 'utf-8' })
  const rows: string[][] = []
  let rowCount = 0

  try {
    for await (const row of parseCSVStream(dataStream, detectedDelimiter)) {
      rows.push(row)
      rowCount++
      if (rowCount > maxRows) break
    }
  } finally {
    dataStream.destroy()
  }

  const headers = rows.length > 0 ? rows[0] : []
  const sampleRows = rows.slice(1)

  // Step 3: Count total lines (fast — count newlines in chunks)
  let totalLines = 0
  const countStream = createReadStream(filePath)
  for await (const chunk of countStream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) totalLines++ // count \n
    }
  }
  // Add 1 for the last line if file doesn't end with newline
  if (fileSize > 0) totalLines++

  return {
    headers,
    sampleRows,
    totalLines,
    detectedDelimiter,
    fileSize,
  }
}
