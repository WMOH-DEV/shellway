import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { AlertCircle, Check, Copy } from "lucide-react";

interface JsonCellModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  value: unknown;
  /** When true, the user can edit and save the JSON. */
  editable: boolean;
  /** Called with the parsed/serialized JSON text on save. */
  onSave?: (newJsonText: string) => void;
}

/**
 * Pretty-prints a JSON cell value (object or JSON-string) with optional
 * inline editing. Validates on every keystroke so the user sees immediate
 * parse errors without blocking their typing.
 */
export function JsonCellModal({
  open,
  onClose,
  title,
  value,
  editable,
  onSave,
}: JsonCellModalProps) {
  const initial = useMemo(() => toPrettyJson(value), [value]);
  const [text, setText] = useState(initial);
  const [parseError, setParseError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset when the opened value changes
  useEffect(() => {
    if (open) {
      setText(initial);
      setParseError(null);
      setCopied(false);
    }
  }, [open, initial]);

  // Live-parse so the Save button reflects validity without waiting for submit.
  useEffect(() => {
    if (!editable) {
      setParseError(null);
      return;
    }
    if (text.trim() === "") {
      setParseError(null);
      return;
    }
    try {
      JSON.parse(text);
      setParseError(null);
    } catch (e: any) {
      setParseError(e?.message ?? "Invalid JSON");
    }
  }, [text, editable]);

  const isDirty = text !== initial;
  const canSave = editable && isDirty && !parseError;

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const handleSave = () => {
    if (!canSave || !onSave) return;
    onSave(text);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="max-w-3xl"
      closeOnBackdrop={false}
    >
      <div className="flex flex-col gap-3 min-h-0">
        <textarea
          value={text}
          readOnly={!editable}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="font-mono text-xs bg-nd-bg-primary text-nd-text-primary border border-nd-border rounded-md p-3 min-h-[50vh] max-h-[60vh] resize-none focus:outline-none focus:ring-1 focus:ring-nd-accent"
        />

        {parseError && (
          <div className="flex items-start gap-2 text-xs text-red-400">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{parseError}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {editable ? "Cancel" : "Close"}
            </Button>
            {editable && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={!canSave}
                title={
                  parseError
                    ? "Fix JSON syntax before saving"
                    : !isDirty
                      ? "No changes"
                      : "Stage this JSON change"
                }
              >
                Save
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function toPrettyJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    // MySQL drivers typically return JSON as a string; try parsing so the
    // modal opens on structured content rather than an escape-encoded blob.
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
