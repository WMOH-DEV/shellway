import type { UndoSwitch } from './useUndoSwitch'

export function RevokeChoice({ undo }: { undo: UndoSwitch }) {
  return (
    <label className="flex items-center gap-2 text-xs text-nd-text-secondary">
      <input
        type="checkbox"
        className="h-[15px] w-[15px] accent-nd-accent"
        checked={undo.revoke}
        disabled={undo.run.running}
        onChange={(event) => undo.setRevoke(event.target.checked)}
      />
      Also revoke the certificate in Cloudflare
    </label>
  )
}
