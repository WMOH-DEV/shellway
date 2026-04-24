import { Bandage, Sparkles, HandMetal, Ban } from "lucide-react";
import { cn } from "@/utils/cn";
import type { HealRunMode } from "@/types/sql";

interface RunModeSelectorProps {
  value: HealRunMode;
  onChange: (mode: HealRunMode) => void;
  /** Hide the "Strict" option if the caller only wants healing modes. */
  showStrict?: boolean;
  /** Compact two-column grid vs one-column stack. */
  compact?: boolean;
  /** Disable entire selector (e.g. during a running operation). */
  disabled?: boolean;
}

interface ModeOption {
  mode: HealRunMode;
  label: string;
  description: string;
  Icon: typeof Bandage;
  accent: string;
}

const OPTIONS: ModeOption[] = [
  {
    mode: "smart",
    label: "Smart (recommended)",
    description:
      "Auto-heal safe issues (duplicate keys, table exists, transient errors, charset). Ask on risky ones (FK, schema, syntax).",
    Icon: Sparkles,
    accent: "text-nd-accent",
  },
  {
    mode: "full-auto",
    label: "Full auto-heal",
    description:
      "Apply the recommended heal for every recognised error without prompting. Best for unattended runs.",
    Icon: Bandage,
    accent: "text-emerald-400",
  },
  {
    mode: "ask-always",
    label: "Ask on every error",
    description:
      "Pause on every failure and let you pick the heal. Highest control, slowest.",
    Icon: HandMetal,
    accent: "text-amber-400",
  },
  {
    mode: "strict-abort",
    label: "Strict — stop on first error",
    description:
      "Classic behaviour: wrap in a transaction and roll back on any failing statement.",
    Icon: Ban,
    accent: "text-red-400",
  },
];

export function RunModeSelector({
  value,
  onChange,
  showStrict = true,
  compact = true,
  disabled,
}: RunModeSelectorProps) {
  const opts = showStrict ? OPTIONS : OPTIONS.filter((o) => o.mode !== "strict-abort");
  return (
    <div>
      <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
        Error handling
      </label>
      <div
        className={cn(
          "grid gap-1.5",
          compact ? "grid-cols-2" : "grid-cols-1",
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        {opts.map(({ mode, label, description, Icon, accent }) => {
          const active = value === mode;
          return (
            <button
              type="button"
              key={mode}
              onClick={() => onChange(mode)}
              className={cn(
                "flex items-start gap-2 px-2.5 py-2 rounded-md border text-left transition-colors",
                active
                  ? "border-nd-accent bg-nd-accent/10"
                  : "border-nd-border bg-nd-surface hover:border-nd-border-hover",
              )}
            >
              <Icon size={13} className={cn("mt-0.5 shrink-0", active ? accent : "text-nd-text-muted")} />
              <div className="min-w-0">
                <span className="block text-[11px] font-medium text-nd-text-primary">{label}</span>
                <span className="block text-[10px] text-nd-text-muted leading-snug mt-0.5">
                  {description}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default RunModeSelector;
