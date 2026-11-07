import { useState } from 'react'
import { History, Play } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { commandPresets, commandProblem, pushHistory } from '@/utils/server/sites/commands'
import { siteStack } from '@/utils/server/sites/join'
import { useActionLauncher } from '../../../action'
import { Label, SectionCard } from '../../../kit'
import type { SitePageProps } from '../SiteDetailPage'

const historyKey = (sessionId: string, site: string) => `shellway.sites.commands.${sessionId}.${site}`

function readHistory(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function useCommandHistory(key: string): [string[], (command: string) => void] {
  const [history, setHistory] = useState(() => readHistory(key))
  const remember = (command: string) => {
    const next = pushHistory(history, command)
    setHistory(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      return
    }
  }
  return [history, remember]
}

function CommandButton({ command, label, onRun }: { command: string; label?: string; onRun: (command: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onRun(command)}
      className="flex min-w-0 items-center gap-2.5 rounded-[10px] border border-nd-border px-3 py-2 text-left hover:border-nd-border-hover hover:bg-nd-surface-hover"
    >
      <Play size={13} className="shrink-0 text-nd-text-muted" />
      <span className="flex min-w-0 flex-col">
        {label && <span className="truncate text-[13px] text-nd-text-primary">{label}</span>}
        <span className="truncate font-mono text-xs text-nd-text-muted">{command}</span>
      </span>
    </button>
  )
}

export function CommandsTab({ page }: { page: SitePageProps }) {
  const { ctx, data, entry } = page
  const { name, path } = entry.summary.config
  const launcher = useActionLauncher(ctx)
  const [history, remember] = useCommandHistory(historyKey(data.sessionId, name))
  const [command, setCommand] = useState('')
  const problem = commandProblem(command)
  const presets = commandPresets(siteStack(entry.summary))

  const run = (text: string) => {
    const trimmed = text.trim()
    remember(trimmed)
    launcher.launch({ type: 'sites.command', params: { site: name, command: trimmed } })
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Run a command">
        <p className="text-[13px] text-nd-text-muted">Runs as the folder owner in <span className="font-mono">{path}</span>. You review the exact command first, then see its output.</p>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!problem) run(command) }}>
          <input
            aria-label="Command"
            placeholder="php artisan about"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-nd-border-hover bg-nd-bg-sunken px-2.5 font-mono text-[13px] text-nd-text-primary outline-none focus:border-nd-accent"
          />
          <Button type="submit" variant="primary" disabled={problem !== null}><Play size={13} /> Run</Button>
        </form>
        {presets.length > 0 && (
          <>
            <Label>Common commands</Label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {presets.map((preset) => <CommandButton key={preset.command} command={preset.command} label={preset.label} onRun={run} />)}
            </div>
          </>
        )}
      </SectionCard>
      <SectionCard title="Recent" count={history.length} aside={<History size={14} className="text-nd-text-muted" />}>
        {history.length === 0
          ? <p className="text-[13px] text-nd-text-muted">Commands you run on this site show up here.</p>
          : <div className="flex flex-col gap-1.5">{history.map((entryText) => <CommandButton key={entryText} command={entryText} onRun={setCommand} />)}</div>}
      </SectionCard>
    </div>
  )
}
