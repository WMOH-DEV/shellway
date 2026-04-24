// electron/utils/sqlErrorClassifier.ts
//
// Maps driver-native errors (mysql2 + pg) into a canonical taxonomy and lists
// the heal strategies available for each class. Pure module — no side effects.

import type {
  HealErrorClass,
  HealOptionDescriptor,
  HealStrategy,
} from "../../src/types/sql";
import type { DatabaseType } from "../services/SQLService";

export interface ClassifiedError {
  class: HealErrorClass;
  message: string;
  /** Driver-native code (string for PG SQLSTATE or MySQL ER_*, number for mysql2 errno). */
  code?: string | number;
  /** True when the error is transient and a retry is sensible without any heal. */
  transient: boolean;
}

// ── MySQL errno → class ──

const MYSQL_ERRNO_MAP: Record<number, HealErrorClass> = {
  1007: "unknown", // ER_DB_CREATE_EXISTS — database exists
  1041: "disk-or-memory", // ER_OUT_OF_RESOURCES
  1044: "privileges", // ER_DBACCESS_DENIED_ERROR
  1045: "privileges", // ER_ACCESS_DENIED_ERROR
  1048: "not-null-violation", // ER_BAD_NULL_ERROR
  1049: "unknown-table", // ER_BAD_DB_ERROR
  1050: "table-exists", // ER_TABLE_EXISTS_ERROR
  1054: "unknown-column", // ER_BAD_FIELD_ERROR
  1062: "duplicate-key", // ER_DUP_ENTRY
  1063: "bad-default", // ER_WRONG_FIELD_SPEC
  1064: "syntax", // ER_PARSE_ERROR
  1067: "bad-default", // ER_INVALID_DEFAULT
  1101: "bad-default", // ER_BLOB_CANT_HAVE_DEFAULT — BLOB/TEXT/GEOMETRY/JSON column has DEFAULT
  1142: "privileges", // ER_TABLEACCESS_DENIED_ERROR
  1146: "unknown-table", // ER_NO_SUCH_TABLE
  1205: "lock-wait", // ER_LOCK_WAIT_TIMEOUT
  1213: "lock-wait", // ER_LOCK_DEADLOCK
  1216: "fk-violation", // ER_NO_REFERENCED_ROW
  1217: "fk-violation", // ER_ROW_IS_REFERENCED
  1264: "data-too-long", // ER_WARN_DATA_OUT_OF_RANGE
  1265: "data-too-long", // WARN_DATA_TRUNCATED (also type-ish; treat as truncation)
  1292: "type-mismatch", // ER_TRUNCATED_WRONG_VALUE
  1300: "charset", // ER_INVALID_CHARACTER_STRING
  1366: "type-mismatch", // ER_TRUNCATED_WRONG_VALUE_FOR_FIELD
  1406: "data-too-long", // ER_DATA_TOO_LONG
  1411: "type-mismatch", // ER_WRONG_VALUE_FOR_FIELD
  1451: "fk-violation", // ER_ROW_IS_REFERENCED_2
  1452: "fk-violation", // ER_NO_REFERENCED_ROW_2
  1826: "duplicate-constraint", // ER_DUP_CONSTRAINT_NAME — FK/UNIQUE/CHECK name collision at DDL
};

// ── PostgreSQL SQLSTATE → class ──
// Note: pg returns `code` as the 5-char SQLSTATE string.

const PG_SQLSTATE_MAP: Record<string, HealErrorClass> = {
  "22001": "data-too-long", // string_data_right_truncation
  "22003": "data-too-long", // numeric_value_out_of_range
  "22007": "type-mismatch", // invalid_datetime_format
  "22008": "type-mismatch", // datetime_field_overflow
  "22021": "charset", // character_not_in_repertoire
  "22P02": "type-mismatch", // invalid_text_representation
  "23502": "not-null-violation",
  "23503": "fk-violation",
  "23505": "duplicate-key",
  "23514": "bad-default", // check_violation — often default/computed check
  "40001": "lock-wait", // serialization_failure
  "40P01": "lock-wait", // deadlock_detected
  "42501": "privileges", // insufficient_privilege
  "42601": "syntax",
  "42703": "unknown-column", // undefined_column
  "42704": "unknown", // undefined_object
  "42P01": "unknown-table", // undefined_table
  "42P07": "table-exists", // duplicate_table
  "55P03": "lock-wait", // lock_not_available
  "57014": "lock-wait", // query_canceled (timeout)
  // Connection exception family
  "08000": "connection-lost",
  "08001": "connection-lost",
  "08003": "connection-lost",
  "08004": "connection-lost",
  "08006": "connection-lost",
  "08007": "connection-lost",
  // Insufficient resources family
  "53100": "disk-or-memory", // disk_full
  "53200": "disk-or-memory", // out_of_memory
  "53300": "disk-or-memory", // too_many_connections
  "53400": "disk-or-memory", // configuration_limit_exceeded
};

// ── Node-level transport errors (both drivers) ──

const TRANSPORT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
]);

// ── Message-based fallback patterns (when no code is recognised) ──

interface MessagePattern {
  pattern: RegExp;
  class: HealErrorClass;
}

const MESSAGE_PATTERNS: MessagePattern[] = [
  { pattern: /duplicate\s+(entry|key)/i, class: "duplicate-key" },
  { pattern: /violates\s+unique\s+constraint/i, class: "duplicate-key" },
  // DDL constraint-name collision must match BEFORE the generic
  // /foreign\s+key\s+constraint/ pattern below — otherwise "Duplicate foreign
  // key constraint name 'x'" is misrouted to fk-violation.
  { pattern: /duplicate\s+(foreign\s+key\s+)?constraint\s+name/i, class: "duplicate-constraint" },
  { pattern: /constraint\s+['"`][^'"`]+['"`]\s+already\s+exists/i, class: "duplicate-constraint" },
  { pattern: /foreign\s+key\s+constraint/i, class: "fk-violation" },
  { pattern: /violates\s+foreign\s+key/i, class: "fk-violation" },
  { pattern: /null\s+value\s+in\s+column.*violates/i, class: "not-null-violation" },
  { pattern: /cannot\s+be\s+null/i, class: "not-null-violation" },
  { pattern: /column.*does\s+not\s+allow\s+nulls/i, class: "not-null-violation" },
  { pattern: /invalid\s+default\s+value/i, class: "bad-default" },
  { pattern: /(blob|text|geometry|json)\s+column.*can'?t\s+have\s+a\s+default/i, class: "bad-default" },
  { pattern: /data\s+too\s+long/i, class: "data-too-long" },
  { pattern: /value\s+too\s+long/i, class: "data-too-long" },
  { pattern: /out\s+of\s+range\s+value/i, class: "data-too-long" },
  { pattern: /incorrect\s+(integer|decimal|string|datetime)\s+value/i, class: "type-mismatch" },
  { pattern: /invalid\s+input\s+syntax\s+for/i, class: "type-mismatch" },
  { pattern: /unknown\s+column/i, class: "unknown-column" },
  { pattern: /column\s+".*"\s+does\s+not\s+exist/i, class: "unknown-column" },
  { pattern: /(table|relation)\s+".*"\s+does\s+not\s+exist/i, class: "unknown-table" },
  { pattern: /no\s+such\s+table/i, class: "unknown-table" },
  { pattern: /(table|relation).*already\s+exists/i, class: "table-exists" },
  { pattern: /syntax\s+error/i, class: "syntax" },
  { pattern: /parse\s+error/i, class: "syntax" },
  // MySQL's full syntax error phrasing: "You have an error in your SQL syntax"
  { pattern: /error\s+in\s+your\s+(sql\s+)?syntax/i, class: "syntax" },
  { pattern: /character.*not.*in.*repertoire/i, class: "charset" },
  { pattern: /invalid\s+(byte|character)\s+sequence/i, class: "charset" },
  { pattern: /(access|permission)\s+denied/i, class: "privileges" },
  { pattern: /insufficient\s+privilege/i, class: "privileges" },
  { pattern: /deadlock\s+(detected|found)/i, class: "lock-wait" },
  { pattern: /lock\s+wait\s+timeout/i, class: "lock-wait" },
  { pattern: /serialization\s+failure/i, class: "lock-wait" },
  { pattern: /connection.*(lost|closed|reset|terminated)/i, class: "connection-lost" },
  { pattern: /server\s+has\s+gone\s+away/i, class: "connection-lost" },
  { pattern: /(out\s+of\s+memory|disk\s+full|no\s+space)/i, class: "disk-or-memory" },
];

const TRANSIENT_CLASSES: ReadonlySet<HealErrorClass> = new Set([
  "lock-wait",
  "connection-lost",
  "disk-or-memory",
]);

/**
 * Classify a driver error into our canonical taxonomy.
 * Accepts anything — robust against partial error objects.
 */
export function classifyError(err: unknown, dbType: DatabaseType): ClassifiedError {
  const asAny = err as Record<string, unknown> | null | undefined;
  const message = pickMessage(asAny);
  const code = pickCode(asAny);

  let klass: HealErrorClass = "unknown";

  // 1) Transport-level (both drivers)
  if (typeof code === "string" && TRANSPORT_ERROR_CODES.has(code)) {
    klass = "connection-lost";
  }
  // 2) Driver-specific code tables
  else if (dbType === "mysql" && typeof code === "number" && MYSQL_ERRNO_MAP[code]) {
    klass = MYSQL_ERRNO_MAP[code];
  } else if (dbType === "mysql" && asAny && typeof asAny.errno === "number" && MYSQL_ERRNO_MAP[asAny.errno as number]) {
    klass = MYSQL_ERRNO_MAP[asAny.errno as number];
  } else if (dbType === "postgres" && typeof code === "string" && PG_SQLSTATE_MAP[code]) {
    klass = PG_SQLSTATE_MAP[code];
  }

  // 3) Message-pattern fallback
  if (klass === "unknown") {
    for (const p of MESSAGE_PATTERNS) {
      if (p.pattern.test(message)) {
        klass = p.class;
        break;
      }
    }
  }

  return {
    class: klass,
    message,
    code,
    transient: TRANSIENT_CLASSES.has(klass),
  };
}

function pickMessage(err: Record<string, unknown> | null | undefined): string {
  if (!err) return "Unknown error";
  const m = (err.sqlMessage as string) || (err.message as string);
  if (m && typeof m === "string") return m;
  try {
    return String(err);
  } catch {
    return "Unknown error";
  }
}

function pickCode(err: Record<string, unknown> | null | undefined): string | number | undefined {
  if (!err) return undefined;
  // mysql2 puts the ER_ name in `code` and the number in `errno`
  // pg puts the SQLSTATE in `code`
  // Node transport errors put ECONNRESET etc. in `code`
  const c = err.code as string | number | undefined;
  if (typeof c === "number") return c;
  if (typeof c === "string") return c;
  if (typeof err.errno === "number") return err.errno as number;
  return undefined;
}

// ── Heal strategy catalog per class ──

const BASE_ACTIONS: HealOptionDescriptor[] = [
  {
    strategy: "retry-with-edit",
    label: "Edit & retry",
    description: "Open the statement in an editor, fix it, then re-run.",
  },
  {
    strategy: "skip",
    label: "Skip this statement",
    description: "Log the error and continue with the next statement.",
  },
  {
    strategy: "quarantine",
    label: "Quarantine",
    description: "Write this statement to a side file for later review, then continue.",
  },
  {
    strategy: "abort",
    label: "Abort",
    description: "Stop the operation now. Transaction (if any) will roll back.",
  },
];

export function getHealOptions(
  errClass: HealErrorClass,
  dbType: DatabaseType,
): HealOptionDescriptor[] {
  const options: HealOptionDescriptor[] = [];

  switch (errClass) {
    case "duplicate-key":
      options.push(
        dbType === "mysql"
          ? {
              strategy: "insert-ignore",
              label: "Convert to INSERT IGNORE",
              description: "Rewrite as INSERT IGNORE so duplicates are skipped at the DB level.",
              recommended: true,
            }
          : {
              strategy: "on-conflict-nothing",
              label: "Add ON CONFLICT DO NOTHING",
              description: "Rewrite to ignore the row if the key already exists.",
              recommended: true,
            },
        dbType === "mysql"
          ? {
              strategy: "replace-into",
              label: "Convert to REPLACE INTO",
              description: "Overwrite the existing row with the incoming values.",
              dataMutation: true,
            }
          : {
              strategy: "on-conflict-update",
              label: "Upsert (ON CONFLICT DO UPDATE)",
              description: "Overwrite the existing row with the incoming values.",
              dataMutation: true,
            },
      );
      break;

    case "fk-violation":
      options.push({
        strategy: "disable-fk-checks",
        label: "Disable FK checks for this run",
        description:
          dbType === "mysql"
            ? "Set FOREIGN_KEY_CHECKS=0 for the session and validate on completion."
            : "Set session_replication_role=replica for the session and validate on completion.",
        recommended: true,
      });
      options.push({
        strategy: "defer-fk",
        label: "Defer FK to end of run",
        description: "Queue this row and retry once parent rows have been inserted.",
      });
      break;

    case "not-null-violation":
      options.push(
        {
          strategy: "substitute-default",
          label: "Substitute a default value",
          description: "Replace NULL with a sensible default (0, '', or NOW()).",
          recommended: true,
          dataMutation: true,
        },
        {
          strategy: "make-nullable",
          label: "Make column nullable",
          description: "ALTER the column to DROP NOT NULL, then retry.",
          schemaMutation: true,
        },
      );
      break;

    case "data-too-long":
      options.push(
        {
          strategy: "truncate-value",
          label: "Truncate value to fit",
          description: "Trim the string/number to the column's max length and retry.",
          recommended: true,
          dataMutation: true,
        },
        {
          strategy: "widen-column",
          label: "Widen the column (ALTER)",
          description: "Enlarge the column type (e.g. VARCHAR(255) → TEXT) and retry.",
          schemaMutation: true,
        },
      );
      break;

    case "type-mismatch":
      options.push(
        {
          strategy: "coerce-type",
          label: "Coerce the value",
          description: "Cast the value to the target type (best-effort).",
          recommended: true,
          dataMutation: true,
        },
        {
          strategy: "set-null-on-value",
          label: "Set value to NULL",
          description: "Replace the offending value with NULL (if the column allows it).",
          dataMutation: true,
        },
      );
      break;

    case "bad-default":
      options.push(
        {
          strategy: "strip-default",
          label: "Strip the DEFAULT clause",
          description: "Remove the offending DEFAULT expression and rely on implicit default.",
          recommended: true,
        },
        {
          strategy: "substitute-default",
          label: "Replace with a working default",
          description: "Substitute a literal (NULL, empty string, 0) for the bad default.",
        },
      );
      break;

    case "unknown-column":
      options.push(
        {
          strategy: "remove-column-ref",
          label: "Remove the missing column from this statement",
          description: "Rewrite the INSERT/UPDATE without that column.",
          recommended: true,
        },
        {
          strategy: "add-column",
          label: "Add the missing column (ALTER)",
          description: "Create the column on the target table, then retry.",
          schemaMutation: true,
        },
      );
      break;

    case "unknown-table":
      options.push({
        strategy: "create-table-stub",
        label: "Create a stub table",
        description: "Create the missing table with columns inferred from this statement.",
        schemaMutation: true,
      });
      break;

    case "table-exists":
      options.push(
        {
          strategy: "drop-if-exists",
          label: "Drop existing table first",
          description: "Prepend DROP TABLE IF EXISTS before the CREATE. Destructive.",
          dataMutation: true,
        },
        {
          strategy: "if-not-exists",
          label: "Skip if already exists",
          description: "Rewrite as CREATE TABLE IF NOT EXISTS.",
          recommended: true,
        },
      );
      break;

    case "duplicate-constraint":
      options.push({
        strategy: "strip-constraint-name",
        label: "Strip explicit constraint names",
        description:
          "Remove `CONSTRAINT <name>` prefixes before FOREIGN KEY / UNIQUE / CHECK so MySQL auto-generates unique names.",
        recommended: true,
      });
      break;

    case "charset":
      options.push(
        {
          strategy: "strip-invalid-chars",
          label: "Strip invalid characters",
          description: "Remove bytes that can't be encoded and retry.",
          recommended: true,
          dataMutation: true,
        },
        {
          strategy: "reencode-utf8",
          label: "Re-encode to UTF-8",
          description: "Force the connection charset to utf8mb4 / UTF8 for the rest of the run.",
        },
      );
      break;

    case "syntax":
      options.push({
        strategy: "retry-with-edit",
        label: "Edit & retry",
        description: "Open the statement, fix the syntax, then re-run.",
        recommended: true,
      });
      break;

    case "privileges":
      // No safe auto-heal: user must fix credentials. Only control actions.
      break;

    case "lock-wait":
      options.push({
        strategy: "retry-with-backoff",
        label: "Retry with backoff",
        description: "Wait briefly and retry (up to 5 times with exponential backoff).",
        recommended: true,
      });
      break;

    case "connection-lost":
      options.push({
        strategy: "reconnect-and-retry",
        label: "Reconnect and retry",
        description: "Re-establish the database connection and re-execute this statement.",
        recommended: true,
      });
      break;

    case "disk-or-memory":
      options.push({
        strategy: "retry-with-backoff",
        label: "Wait and retry",
        description: "Pause briefly for resources to free up, then retry.",
        recommended: true,
      });
      break;

    case "unknown":
      // Fall through to base actions only
      break;
  }

  // Always add the base control actions last so they're consistent.
  options.push(...BASE_ACTIONS);
  return options;
}

/**
 * Strategy that should be applied automatically in Full Auto mode (and in
 * Smart mode for low-risk classes). Returns null if no safe auto-heal exists
 * and we must ask the user.
 */
export function pickAutoStrategy(
  errClass: HealErrorClass,
  dbType: DatabaseType,
): HealStrategy | null {
  const opts = getHealOptions(errClass, dbType);
  const rec = opts.find((o) => o.recommended);
  return rec ? rec.strategy : null;
}

/**
 * Classes Smart mode heals automatically (no prompt). Everything else is asked.
 * Criterion: the recommended heal is safe (no schema mutation) AND the fix is
 * well-understood for that class.
 */
export function isSafeForSmartAuto(errClass: HealErrorClass): boolean {
  return (
    errClass === "duplicate-key" ||
    errClass === "table-exists" ||
    errClass === "lock-wait" ||
    errClass === "connection-lost" ||
    errClass === "charset" ||
    errClass === "disk-or-memory" ||
    // bad-default: strip-default is targeted to the offending column (see
    // HealingEngine.healStripDefault) — safe for dump-file restores where
    // source MySQL 8.0.13+ stored DEFAULTs on TEXT/BLOB/JSON columns that
    // older targets reject.
    errClass === "bad-default" ||
    // duplicate-constraint: stripping an explicit CONSTRAINT name before
    // FOREIGN KEY lets MySQL auto-generate a unique one. Semantics are
    // preserved — the constraint still exists and enforces identically.
    errClass === "duplicate-constraint"
  );
}
