import { posix } from 'path'

type DatabaseType = 'mysql' | 'postgres'

/**
 * Shell-escape a string for safe interpolation into a shell command.
 * Wraps in single quotes and escapes embedded single quotes.
 *
 * @example shellEscape("foo'bar") => "'foo'\\''bar'"
 * @example shellEscape("normal") => "'normal'"
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}

/**
 * Validate a database or table identifier.
 * Throws if the identifier contains invalid characters.
 *
 * MySQL allows: letters, digits, underscore, dollar sign
 * PostgreSQL allows: letters, digits, underscore (must start with letter or underscore)
 */
export function validateIdentifier(name: string, dbType: DatabaseType): void {
  if (!name || name.length === 0) throw new Error('Identifier cannot be empty')
  if (name.length > 64) throw new Error('Identifier must be 64 characters or fewer')

  if (dbType === 'mysql') {
    if (!/^[a-zA-Z0-9_$]+$/.test(name))
      throw new Error(
        `Invalid MySQL identifier "${name}": only letters, numbers, _, $ allowed`
      )
  } else {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
      throw new Error(
        `Invalid PostgreSQL identifier "${name}": must start with letter/underscore, contain only letters, numbers, _`
      )
  }
}

/** Allowed binary path prefixes for SSH exec commands */
const ALLOWED_PREFIXES = [
  '/usr/bin/',
  '/usr/local/bin/',
  '/opt/homebrew/bin/',
  '/usr/lib/',
  '/usr/local/mysql/bin/',
  '/usr/pgsql-',
]

/**
 * Validate a remote binary path for SSH exec.
 * Only allows paths in known safe directories.
 * Normalizes the path first to prevent traversal attacks (e.g. /usr/bin/../etc/shadow).
 */
export function validateBinaryPath(binaryPath: string): void {
  if (!/^[a-zA-Z0-9_./-]+$/.test(binaryPath))
    throw new Error('Binary path contains invalid characters')

  // Normalize to resolve .., . sequences before checking prefixes
  const normalized = posix.normalize(binaryPath)

  if (!ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix)))
    throw new Error(`Binary path must be in one of: ${ALLOWED_PREFIXES.join(', ')}`)
}

/**
 * Quote a SQL identifier (table name, column name, database name).
 * MySQL uses backticks, PostgreSQL uses double quotes.
 */
export function quoteIdentifier(name: string, dbType: DatabaseType): string {
  if (dbType === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
  return '"' + name.replace(/"/g, '""') + '"'
}
