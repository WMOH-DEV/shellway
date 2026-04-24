// electron/services/HealingEngine.ts
//
// Stateless-per-call transformations that rewrite a failing SQL statement
// according to the heal strategy the user (or auto mode) picked.
//
// These functions MUST preserve the original meaning wherever possible and
// only mutate what the strategy calls for. They intentionally avoid full SQL
// parsing — SQL dump files use a predictable subset (INSERT INTO, CREATE TABLE,
// UPDATE ... WHERE, ALTER ...) and regex-level rewrites handle that subset well.
// When a rewrite isn't confidently possible, return null and the caller falls
// back to Skip/Quarantine.

import type { ClassifiedError } from "../utils/sqlErrorClassifier";
import type { DatabaseType } from "./SQLService";
import type { HealDecision, HealStrategy } from "../../src/types/sql";

export interface HealContext {
  dbType: DatabaseType;
  /** Original failing statement (untrimmed). */
  statement: string;
  /** Classified error for the failure. */
  error: ClassifiedError;
  /** Decision chosen by user or auto mode. */
  decision: HealDecision;
}

export interface HealOutcome {
  /**
   * The rewritten statement to re-execute. When null, the heal is not a
   * statement-level rewrite (e.g. disable-fk-checks sets a session flag) or
   * the heal cannot be applied to this statement — caller decides fallback.
   */
  rewritten: string | null;
  /**
   * Additional statements to run ONCE before the rewritten statement (or
   * instead of it when `rewritten` is null). Examples: SET FOREIGN_KEY_CHECKS=0,
   * an ALTER TABLE to widen a column, a DROP TABLE IF EXISTS.
   */
  preStatements?: string[];
  /** Short human-readable explanation of what the heal did. */
  note: string;
  /**
   * When true, the decision should be persisted on the operation and
   * applied *as a side-effect session flag* — the caller should NOT
   * re-execute the offending statement (session flag already applied).
   * Example: disable-fk-checks changes the session; the failing insert
   * should be retried separately.
   */
  sessionFlagOnly?: boolean;
}

// ── Entry point ──

export function applyHeal(ctx: HealContext): HealOutcome {
  const strat = ctx.decision.strategy;
  if (!strat) {
    return { rewritten: ctx.statement, note: "No strategy — retrying as-is" };
  }

  switch (strat) {
    case "retry-as-is":
      return { rewritten: ctx.statement, note: "Retrying as-is" };

    case "retry-with-edit":
      return {
        rewritten: ctx.decision.editedStatement ?? ctx.statement,
        note: "User-edited statement",
      };

    case "insert-ignore":
      return healInsertIgnore(ctx);

    case "replace-into":
      return healReplaceInto(ctx);

    case "on-conflict-nothing":
      return healOnConflictNothing(ctx);

    case "on-conflict-update":
      return healOnConflictUpdate(ctx);

    case "disable-fk-checks":
      return healDisableFkChecks(ctx);

    case "drop-if-exists":
      return healDropIfExists(ctx);

    case "if-not-exists":
      return healIfNotExists(ctx);

    case "strip-constraint-name":
      return healStripConstraintName(ctx);

    case "strip-default":
      return healStripDefault(ctx);

    case "strip-invalid-chars":
      return healStripInvalidChars(ctx);

    case "reencode-utf8":
      return healReencodeUtf8(ctx);

    case "truncate-value":
    case "coerce-type":
    case "set-null-on-value":
    case "substitute-default":
      // These heals need column-level metadata (type, max length) which is
      // only accessible from the service layer. The service performs the
      // lookup then calls applyHeal with `param` set on the decision.
      return healValueSubstitution(ctx);

    case "widen-column":
    case "make-nullable":
    case "add-column":
    case "create-table-stub":
    case "remove-column-ref":
      // Schema-level heals: the service builds the ALTER/CREATE and passes it
      // via `decision.editedStatement`. This keeps introspection in one place.
      if (ctx.decision.editedStatement) {
        return {
          rewritten: ctx.statement,
          preStatements: [ctx.decision.editedStatement],
          note: `Applied schema heal: ${strat}`,
        };
      }
      return {
        rewritten: null,
        note: `Schema heal ${strat} requires service-side preparation`,
      };

    case "defer-fk":
      // Deferred retry is handled at the loop level — engine returns a sentinel.
      return {
        rewritten: null,
        note: "Deferred — will retry after current pass completes",
      };

    case "retry-with-backoff":
    case "reconnect-and-retry":
      // Transient retries — handled by the loop, not rewritten here.
      return { rewritten: ctx.statement, note: `Transient retry: ${strat}` };

    default:
      return {
        rewritten: ctx.statement,
        note: `Unknown strategy ${strat} — retrying as-is`,
      };
  }
}

// ── Statement-level rewrites ──

function healInsertIgnore(ctx: HealContext): HealOutcome {
  if (ctx.dbType !== "mysql") {
    return { rewritten: null, note: "INSERT IGNORE is MySQL-only" };
  }
  const stmt = ctx.statement;
  // Replace leading INSERT INTO (case-insensitive) with INSERT IGNORE INTO.
  // Already-ignored INSERT passes through.
  const replaced = stmt.replace(
    /^(\s*)INSERT\s+(?!IGNORE\b)(INTO\b)/i,
    "$1INSERT IGNORE $2",
  );
  if (replaced === stmt && !/^\s*INSERT\s+IGNORE/i.test(stmt)) {
    return {
      rewritten: null,
      note: "Statement is not an INSERT — cannot apply IGNORE",
    };
  }
  return { rewritten: replaced, note: "Converted to INSERT IGNORE" };
}

function healReplaceInto(ctx: HealContext): HealOutcome {
  if (ctx.dbType !== "mysql") {
    return { rewritten: null, note: "REPLACE INTO is MySQL-only" };
  }
  const replaced = ctx.statement.replace(
    /^(\s*)INSERT(\s+IGNORE)?\s+INTO\b/i,
    "$1REPLACE INTO",
  );
  if (replaced === ctx.statement) {
    return {
      rewritten: null,
      note: "Statement is not an INSERT — cannot convert to REPLACE",
    };
  }
  return { rewritten: replaced, note: "Converted to REPLACE INTO" };
}

function healOnConflictNothing(ctx: HealContext): HealOutcome {
  if (ctx.dbType !== "postgres") {
    return { rewritten: null, note: "ON CONFLICT is Postgres-only" };
  }
  const stmt = ctx.statement;
  if (!/^\s*INSERT\s+INTO\b/i.test(stmt)) {
    return { rewritten: null, note: "Statement is not an INSERT" };
  }
  if (/ON\s+CONFLICT\b/i.test(stmt)) {
    return { rewritten: stmt, note: "ON CONFLICT already present" };
  }
  // Append before the terminating semicolon (if any).
  const withConflict = stmt.replace(/;?\s*$/, " ON CONFLICT DO NOTHING;");
  return { rewritten: withConflict, note: "Added ON CONFLICT DO NOTHING" };
}

function healOnConflictUpdate(ctx: HealContext): HealOutcome {
  if (ctx.dbType !== "postgres") {
    return { rewritten: null, note: "ON CONFLICT is Postgres-only" };
  }
  const stmt = ctx.statement;
  // Extract the column list from INSERT INTO tbl (col1, col2, ...) VALUES ...
  const m = stmt.match(/^\s*INSERT\s+INTO\s+[^\s(]+\s*\(\s*([^)]+?)\s*\)/i);
  if (!m) {
    return {
      rewritten: null,
      note: "Could not parse column list — cannot build ON CONFLICT UPDATE",
    };
  }
  const cols = m[1]
    .split(",")
    .map((c) => c.trim().replace(/^["`]|["`]$/g, ""))
    .filter(Boolean);
  if (!cols.length) {
    return { rewritten: null, note: "Empty column list" };
  }
  // Detect PK — we don't know it here. Default: the first column is assumed PK.
  // User can rewrite via edit if that's wrong.
  const pk = cols[0];
  const updates = cols
    .filter((c) => c !== pk)
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");
  const clause = updates
    ? ` ON CONFLICT ("${pk}") DO UPDATE SET ${updates}`
    : ` ON CONFLICT ("${pk}") DO NOTHING`;
  const withConflict = stmt.replace(/;?\s*$/, `${clause};`);
  return {
    rewritten: withConflict,
    note: `Added ON CONFLICT ("${pk}") DO UPDATE (upsert on first column)`,
  };
}

function healDisableFkChecks(ctx: HealContext): HealOutcome {
  const pre =
    ctx.dbType === "mysql"
      ? ["SET FOREIGN_KEY_CHECKS=0"]
      : ["SET session_replication_role = replica"];
  return {
    rewritten: ctx.statement,
    preStatements: pre,
    note: "Disabled FK checks for this session",
  };
}

function healDropIfExists(ctx: HealContext): HealOutcome {
  const m = ctx.statement.match(
    /^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([`"][^`"]+[`"]|[A-Za-z_][\w.]*)/i,
  );
  if (!m) {
    return { rewritten: null, note: "Not a CREATE TABLE statement" };
  }
  const table = m[2];
  return {
    rewritten: ctx.statement,
    preStatements: [`DROP TABLE IF EXISTS ${table}`],
    note: `Dropped existing ${table} before CREATE`,
  };
}

function healIfNotExists(ctx: HealContext): HealOutcome {
  const stmt = ctx.statement;
  if (/^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(stmt)) {
    return { rewritten: stmt, note: "Already IF NOT EXISTS" };
  }
  const replaced = stmt.replace(/^(\s*CREATE\s+TABLE)\b/i, "$1 IF NOT EXISTS");
  if (replaced === stmt) {
    return { rewritten: null, note: "Not a CREATE TABLE statement" };
  }
  return { rewritten: replaced, note: "Added IF NOT EXISTS" };
}

function healStripConstraintName(ctx: HealContext): HealOutcome {
  const stmt = ctx.statement;
  // Strip explicit `CONSTRAINT <name>` prefixes before FOREIGN KEY / UNIQUE /
  // PRIMARY / CHECK. MySQL will auto-generate a unique name (e.g. table_ibfk_N)
  // so duplicate-name DDL collisions disappear. Name can be backticked,
  // double-quoted, or a bare identifier.
  const re =
    /\bCONSTRAINT\s+(?:`[^`]+`|"[^"]+"|[A-Za-z_][\w$]*)\s+(?=FOREIGN\s+KEY\b|UNIQUE\b|PRIMARY\s+KEY\b|CHECK\b)/gi;
  const rewritten = stmt.replace(re, "").replace(/ {2,}/g, " ");
  if (rewritten === stmt) {
    return {
      rewritten: null,
      note: "No explicit CONSTRAINT <name> prefix found to strip",
    };
  }
  return {
    rewritten,
    note: "Stripped explicit CONSTRAINT name(s) — MySQL will auto-generate",
  };
}

function healStripDefault(ctx: HealContext): HealOutcome {
  const stmt = ctx.statement;
  const defaultRe =
    /\bDEFAULT\s+(?:\([^()]*\)|'(?:[^']|'')*'|"(?:[^"]|"")*"|[^,\s)]+)/gi;

  // Targeted strip: if the error message names a column (e.g. MySQL 1101
  // "BLOB/TEXT column 'x' can't have a default value"), remove the DEFAULT
  // only on that column's line. Protects multi-column CREATE TABLE from
  // losing every unrelated default in the dump.
  const colName = extractColumnFromMessage(ctx.error.message);
  if (colName) {
    const lines = stmt.split("\n");
    const idx = lines.findIndex((line) => lineDefinesColumn(line, colName));
    if (idx >= 0) {
      const before = lines[idx];
      const after = before.replace(defaultRe, "").replace(/ {2,}/g, " ");
      if (after !== before) {
        lines[idx] = after;
        return {
          rewritten: lines.join("\n"),
          note: `Stripped DEFAULT on column \`${colName}\``,
        };
      }
    }
  }

  // Fallback: global strip (ALTER TABLE single-column case, or when the
  // error message did not carry a column name).
  const rewritten = stmt.replace(defaultRe, "").replace(/ {2,}/g, " ");
  if (rewritten === stmt) {
    return { rewritten: null, note: "No DEFAULT clause found to strip" };
  }
  return { rewritten, note: "Stripped DEFAULT clause(s)" };
}

function extractColumnFromMessage(msg: string): string | null {
  // Covers MySQL and Postgres phrasings:
  //   "... column 'colname' can't have a default value"
  //   "Invalid default value for 'colname'"
  //   'column "colname" ...'
  const patterns = [
    /column\s+['"`]([^'"`]+)['"`]/i,
    /for\s+['"`]([^'"`]+)['"`]/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

function lineDefinesColumn(line: string, colName: string): boolean {
  const escaped = colName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Start of a column definition: leading whitespace, optional quote/backtick,
  // the column name, closing quote/backtick, then whitespace (the type).
  const re = new RegExp(`^\\s*[\`"]?${escaped}[\`"]?\\s`, "");
  return re.test(line);
}

function healStripInvalidChars(ctx: HealContext): HealOutcome {
  // We don't know which specific byte was invalid — best-effort: strip anything
  // outside the BMP printable + whitespace range from string literals only.
  // For binary/blob columns, user should use retry-with-edit instead.
  const stmt = ctx.statement.replace(
    /'((?:[^']|'')*)'/g,
    (_m, inner: string) => {
      const cleaned = inner.replace(/[ --￾￿]/g, "");
      return `'${cleaned}'`;
    },
  );
  if (stmt === ctx.statement) {
    return { rewritten: null, note: "No invalid characters found to strip" };
  }
  return {
    rewritten: stmt,
    note: "Stripped control chars from string literals",
  };
}

function healReencodeUtf8(ctx: HealContext): HealOutcome {
  const pre =
    ctx.dbType === "mysql"
      ? ["SET NAMES utf8mb4", "SET CHARACTER SET utf8mb4"]
      : ["SET client_encoding = 'UTF8'"];
  return {
    rewritten: ctx.statement,
    preStatements: pre,
    note: "Forced UTF-8 for this connection",
  };
}

/**
 * Substitute a literal value in the failing INSERT row.
 *
 * `decision.param` carries either the replacement value directly, or the
 * column index (as a number) when combined with truncate-value — the service
 * fills in the right value before calling us.
 */
function healValueSubstitution(ctx: HealContext): HealOutcome {
  if (ctx.decision.editedStatement) {
    // Service pre-computed the rewrite — just use it.
    return {
      rewritten: ctx.decision.editedStatement,
      note: `Applied ${ctx.decision.strategy} (service-prepared)`,
    };
  }
  return {
    rewritten: null,
    note: `${ctx.decision.strategy} requires service-side column metadata — falling back`,
  };
}

// ── Public helpers ──

/**
 * Report which strategies are truly statement-level (i.e. applyHeal will
 * produce a non-null rewrite from just the statement text). The service uses
 * this to decide whether it needs to fetch schema metadata before calling.
 */
export function needsSchemaLookup(strategy: HealStrategy): boolean {
  switch (strategy) {
    case "truncate-value":
    case "coerce-type":
    case "set-null-on-value":
    case "substitute-default":
    case "widen-column":
    case "make-nullable":
    case "add-column":
    case "create-table-stub":
    case "remove-column-ref":
      return true;
    default:
      return false;
  }
}
