import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  AlertTriangle,
  Bandage,
  SkipForward,
  Archive,
  X as XIcon,
  Pencil,
  Sparkles,
  AlertCircle,
  Search,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type {
  HealDecision,
  HealErrorClass,
  HealOptionDescriptor,
  HealStrategy,
  ResolutionRequest,
} from "@/types/sql";

interface HealingDialogProps {
  /** The paused-import request the user must resolve. When null, the dialog is hidden. */
  request: ResolutionRequest | null;
  /** User submitted a decision — send it back to the main process. */
  onResolve: (operationId: string, decision: HealDecision) => Promise<void> | void;
  /** User dismissed without deciding — defaults to Skip. */
  onDismiss?: () => void;
}

const CLASS_LABEL: Record<HealErrorClass, string> = {
  syntax: "Syntax error",
  "duplicate-key": "Duplicate key",
  "fk-violation": "Foreign key violation",
  "not-null-violation": "NOT NULL violation",
  "data-too-long": "Value too long for column",
  "type-mismatch": "Type mismatch",
  "bad-default": "Invalid default value",
  "unknown-column": "Unknown column",
  "unknown-table": "Unknown table",
  "table-exists": "Table already exists",
  "duplicate-constraint": "Duplicate constraint name",
  charset: "Character-set / encoding error",
  privileges: "Insufficient privileges",
  "lock-wait": "Lock timeout / deadlock",
  "connection-lost": "Connection lost",
  "disk-or-memory": "Insufficient resources",
  unknown: "Unrecognised error",
};

/**
 * The strategies that are considered "control-level" (always available)
 * vs "class-specific heals". Splitting them lets the UI put control
 * actions in a separate row of buttons at the bottom.
 */
const CONTROL_STRATEGIES = new Set<HealStrategy>([
  "retry-with-edit",
  "skip",
  "quarantine",
  "abort",
]);

export function HealingDialog({ request, onResolve, onDismiss }: HealingDialogProps) {
  const [selected, setSelected] = useState<HealStrategy | null>(null);
  const [rememberForClass, setRememberForClass] = useState<boolean>(true);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [editedStatement, setEditedStatement] = useState<string>("");
  const [findQuery, setFindQuery] = useState<string>("");
  const [findIndex, setFindIndex] = useState<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset state when a new request arrives.
  useEffect(() => {
    if (!request) return;
    const recommended = request.availableStrategies.find((s) => s.recommended);
    setSelected(recommended?.strategy ?? request.availableStrategies[0]?.strategy ?? null);
    setRememberForClass(true);
    setEditMode(false);
    setEditedStatement(request.statement);
    setFindQuery("");
    setFindIndex(0);
  }, [request]);

  const findMatches = useMemo<number[]>(() => {
    if (!findQuery) return [];
    const hay = editedStatement.toLowerCase();
    const needle = findQuery.toLowerCase();
    const out: number[] = [];
    let from = 0;
    while (from <= hay.length) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      out.push(at);
      from = at + Math.max(1, needle.length);
    }
    return out;
  }, [findQuery, editedStatement]);

  const jumpToMatch = useCallback(
    (idx: number) => {
      const ta = textareaRef.current;
      if (!ta || findMatches.length === 0) return;
      const wrapped = ((idx % findMatches.length) + findMatches.length) % findMatches.length;
      const start = findMatches[wrapped];
      const end = start + findQuery.length;
      ta.focus();
      ta.setSelectionRange(start, end);
      // Scroll the match into view by approximating its line position.
      const linesBefore = editedStatement.slice(0, start).split("\n").length - 1;
      const lineHeight = 16; // matches text-[11px] line-height
      ta.scrollTop = Math.max(0, linesBefore * lineHeight - ta.clientHeight / 2);
      setFindIndex(wrapped);
    },
    [findMatches, findQuery, editedStatement],
  );

  const healOptions = useMemo<HealOptionDescriptor[]>(() => {
    if (!request) return [];
    return request.availableStrategies.filter(
      (s) => !CONTROL_STRATEGIES.has(s.strategy),
    );
  }, [request]);

  const handleSubmit = useCallback(
    async (action: HealDecision["action"], strategy?: HealStrategy) => {
      if (!request) return;
      const decision: HealDecision = { action };
      if (strategy) decision.strategy = strategy;
      if (editMode && action === "retry") {
        decision.editedStatement = editedStatement;
      }
      if (rememberForClass && (action === "heal" || action === "skip" || action === "quarantine")) {
        decision.rememberForClass = true;
      }
      await onResolve(request.operationId, decision);
    },
    [request, editMode, editedStatement, rememberForClass, onResolve],
  );

  if (!request) return null;

  const open = true;

  return (
    <Modal
      open={open}
      onClose={() => onDismiss?.()}
      title={`Healing required — ${CLASS_LABEL[request.errorClass] ?? request.errorClass}`}
      maxWidth="max-w-2xl"
      closeOnBackdrop={false}
      closeOnEscape={false}
    >
      <div className="flex flex-col gap-4">
        {/* Error summary */}
        <div className="flex items-start gap-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 select-text">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="min-w-0 space-y-1 select-text">
            <p className="text-xs font-medium text-amber-400 select-text">
              Statement #{request.statementIndex.toLocaleString()} failed
              {request.errorCode !== undefined && (
                <span className="text-amber-300/80 font-mono ml-1.5">
                  ({String(request.errorCode)})
                </span>
              )}
            </p>
            <p
              className="text-[11px] text-amber-300/90 break-words font-mono select-text cursor-text"
              style={{ userSelect: "text", WebkitUserSelect: "text" }}
            >
              {request.errorMessage}
            </p>
          </div>
        </div>

        {/* Statement preview / editor */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-nd-text-secondary">
              {editMode ? "Edit statement" : "Failing statement"}
            </label>
            <button
              type="button"
              onClick={() => setEditMode((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-nd-text-muted hover:text-nd-text-primary transition-colors"
            >
              <Pencil size={11} />
              {editMode ? "Collapse" : "Edit & retry"}
            </button>
          </div>
          {editMode ? (
            <div className="space-y-1.5">
              {/* Inline find bar — Cmd/Ctrl+F focuses, Enter = next, Shift+Enter = prev, Esc = clear */}
              <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-nd-surface border border-nd-border">
                <Search size={12} className="text-nd-text-muted shrink-0" />
                <input
                  type="text"
                  value={findQuery}
                  onChange={(e) => {
                    setFindQuery(e.target.value);
                    setFindIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (findMatches.length === 0) return;
                      jumpToMatch(e.shiftKey ? findIndex - 1 : findIndex + 1);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setFindQuery("");
                      setFindIndex(0);
                    }
                  }}
                  placeholder="Find in statement…"
                  className="flex-1 bg-transparent text-[11px] text-nd-text-primary placeholder-nd-text-muted focus:outline-none"
                />
                <span className="text-[10px] text-nd-text-muted font-mono tabular-nums shrink-0">
                  {findQuery
                    ? findMatches.length > 0
                      ? `${findIndex + 1} / ${findMatches.length}`
                      : "0 / 0"
                    : ""}
                </span>
                <button
                  type="button"
                  onClick={() => jumpToMatch(findIndex - 1)}
                  disabled={findMatches.length === 0}
                  className="p-0.5 text-nd-text-muted hover:text-nd-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous match (Shift+Enter)"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => jumpToMatch(findIndex + 1)}
                  disabled={findMatches.length === 0}
                  className="p-0.5 text-nd-text-muted hover:text-nd-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Next match (Enter)"
                >
                  <ChevronDown size={12} />
                </button>
              </div>
              <textarea
                ref={textareaRef}
                value={editedStatement}
                onChange={(e) => setEditedStatement(e.target.value)}
                onKeyDown={(e) => {
                  // Cmd/Ctrl+F inside the textarea → focus the find bar.
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
                    e.preventDefault();
                    const input = (e.currentTarget.parentElement?.querySelector(
                      "input[type='text']",
                    ) as HTMLInputElement | null);
                    input?.focus();
                    input?.select();
                  }
                }}
                spellCheck={false}
                className="w-full h-40 px-2.5 py-2 rounded-md bg-nd-surface border border-nd-border text-[11px] font-mono text-nd-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-nd-accent"
              />
            </div>
          ) : (
            <div
              className="max-h-28 overflow-y-auto rounded-md bg-nd-surface border border-nd-border px-3 py-2 text-[11px] font-mono text-nd-text-secondary whitespace-pre-wrap break-words select-text"
              style={{ userSelect: "text", WebkitUserSelect: "text" }}
            >
              {request.statement.length > 800
                ? request.statement.slice(0, 800) + "\n… (truncated)"
                : request.statement}
            </div>
          )}
        </div>

        {/* Heal options */}
        {healOptions.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
              Heal strategies
            </label>
            <div className="space-y-1.5">
              {healOptions.map((opt) => (
                <label
                  key={opt.strategy}
                  className={cn(
                    "flex items-start gap-2.5 px-3 py-2 rounded-md border cursor-pointer transition-colors",
                    selected === opt.strategy
                      ? "border-nd-accent bg-nd-accent/10"
                      : "border-nd-border bg-nd-surface hover:border-nd-border-hover",
                  )}
                >
                  <input
                    type="radio"
                    name="healStrategy"
                    value={opt.strategy}
                    checked={selected === opt.strategy}
                    onChange={() => setSelected(opt.strategy)}
                    className="mt-0.5 accent-nd-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium text-nd-text-primary">
                        {opt.label}
                      </span>
                      {opt.recommended && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-nd-accent font-semibold">
                          <Sparkles size={10} />
                          Recommended
                        </span>
                      )}
                      {opt.schemaMutation && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">
                          Schema change
                        </span>
                      )}
                      {opt.dataMutation && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-300/80 font-semibold">
                          Data change
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-nd-text-muted mt-0.5">
                      {opt.description}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* "Apply to all" */}
        <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={rememberForClass}
            onChange={(e) => setRememberForClass(e.target.checked)}
            className="rounded accent-nd-accent"
          />
          Apply this choice to all further &ldquo;{CLASS_LABEL[request.errorClass] ?? request.errorClass}&rdquo; errors in this run
        </label>

        {healOptions.length === 0 && (
          <div className="flex items-start gap-2 rounded-md bg-red-500/5 border border-red-500/20 px-3 py-2 text-[11px] text-red-300/90">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>
              No automatic heals exist for this error class. Use Edit &amp; retry to fix the
              statement manually, or Skip / Quarantine to move past it.
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleSubmit("abort")}
            >
              <XIcon size={12} />
              Abort
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSubmit("quarantine")}
            >
              <Archive size={12} />
              Quarantine
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleSubmit("skip")}
            >
              <SkipForward size={12} />
              Skip
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {editMode && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleSubmit("retry")}
                disabled={!editedStatement.trim()}
              >
                <Pencil size={12} />
                Retry with edits
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => selected && handleSubmit("heal", selected)}
              disabled={!selected || healOptions.length === 0}
            >
              <Bandage size={12} />
              Heal &amp; continue
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default HealingDialog;
