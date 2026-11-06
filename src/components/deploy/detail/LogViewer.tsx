import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Minus, Search, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatSeconds } from '@/utils/deploy/siteStatus'
import { filterSections, stepResult, type LogLine, type LogSection, type StepResult } from '@/utils/deploy/runLog'
import { STAGE_LABELS, type SkippedRow } from '@/utils/deploy/runSummary'

interface LogViewerProps {
  sections: LogSection[]
  skipped: SkippedRow[]
  live: boolean
  focusKey: string | null
  focusRequest: number
  empty: string
}

const RESULT_ICON: Record<StepResult, ReactNode> = {
  ok: <Check size={13} className="text-nd-success" />,
  failed: <X size={13} className="text-nd-error" />,
  warning: <AlertTriangle size={13} className="text-nd-warning" />,
  running: <Loader2 size={13} className="animate-spin text-nd-info" />
}

const LINE_TONE: Record<LogLine['tone'], string> = {
  plain: 'text-nd-text-secondary',
  error: 'bg-nd-error/10 text-nd-error-fg',
  warning: 'text-nd-warning-fg'
}

function sectionTitle(section: LogSection): string {
  if (section.kind === 'step') return section.command || 'Command'
  return section.stage ? STAGE_LABELS[section.stage] : 'Output'
}

function sectionTime(section: LogSection): string {
  return section.started !== null && section.ended !== null ? formatSeconds(Math.max(0, section.ended - section.started)) : ''
}

function initiallyOpen(section: LogSection, total: number): boolean {
  if (total === 1) return true
  if (section.kind === 'stage') return section.lines.some((l) => l.tone !== 'plain')
  return stepResult(section) !== 'ok'
}

function ToolbarToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('h-[26px] rounded-md px-2.5 text-xs transition-colors', active ? 'bg-nd-surface-raised text-nd-text-primary' : 'text-nd-text-muted hover:text-nd-text-primary')}
    >
      {children}
    </button>
  )
}

function Lines({ lines, timestamps }: { lines: LogLine[]; timestamps: boolean }) {
  return (
    <>
      {lines.map((line) => (
        <div key={line.n} data-error={line.tone === 'error' || undefined} className={cn('flex gap-3 py-px pl-8 pr-3', LINE_TONE[line.tone])}>
          <span className="w-8 shrink-0 select-none text-right text-nd-text-faint">{line.n}</span>
          {timestamps && <span className="w-16 shrink-0 select-none text-nd-text-muted">{line.time}</span>}
          <span className="min-w-0">{line.text}</span>
        </div>
      ))}
    </>
  )
}

interface SectionProps {
  section: LogSection
  open: boolean
  onToggle: () => void
  timestamps: boolean
}

function Section({ section, open, onToggle, timestamps }: SectionProps) {
  const result = section.kind === 'step' ? stepResult(section) : null
  return (
    <div data-section={section.key}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn('flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-nd-surface-hover', open && 'bg-nd-surface-hover/60')}
      >
        {open ? <ChevronDown size={13} className="shrink-0 text-nd-text-muted" /> : <ChevronRight size={13} className="shrink-0 text-nd-text-muted" />}
        {result ? RESULT_ICON[result] : <span className="w-[13px]" />}
        <span className={cn('min-w-0 flex-1 truncate', result === 'failed' ? 'text-nd-text-primary' : section.kind === 'stage' ? 'text-nd-text-muted' : 'text-nd-text-secondary')}>
          {section.kind === 'step' && section.optional ? `${sectionTitle(section)} (optional)` : sectionTitle(section)}
        </span>
        <span className="shrink-0 text-nd-text-muted">{sectionTime(section)}</span>
      </button>
      {open && <Lines lines={section.lines} timestamps={timestamps} />}
    </div>
  )
}

export function LogViewer({ sections, skipped, live, focusKey, focusRequest, empty }: LogViewerProps) {
  const [query, setQuery] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [timestamps, setTimestamps] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)

  const filtering = query !== '' || errorsOnly
  const shown = useMemo(() => filterSections(sections, { query, errorsOnly }), [sections, query, errorsOnly])
  const isOpen = (s: LogSection) => filtering || (toggled[s.key] ?? initiallyOpen(s, sections.length))

  useEffect(() => {
    if (!focusKey || focusRequest === 0) return
    setToggled((t) => ({ ...t, [focusKey]: true }))
    requestAnimationFrame(() => {
      const target = scrollRef.current?.querySelector(`[data-section="${focusKey}"]`)
      const firstError = target?.querySelector('[data-error]') ?? target
      firstError?.scrollIntoView({ block: 'center' })
    })
  }, [focusKey, focusRequest])

  useEffect(() => {
    const el = scrollRef.current
    if (el && live && followRef.current) el.scrollTop = el.scrollHeight
  }, [sections, live])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-nd-border bg-nd-bg-sunken">
      <div className="flex items-center gap-1 border-b border-nd-border px-2 py-1.5">
        <label className="flex h-[26px] min-w-0 flex-1 items-center gap-2 px-1.5 text-nd-text-muted">
          <Search size={13} className="shrink-0" />
          <input
            aria-label="Filter log"
            placeholder="Filter log"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            className="min-w-0 flex-1 bg-transparent text-xs text-nd-text-primary outline-none placeholder:text-nd-text-muted"
          />
        </label>
        <ToolbarToggle active={errorsOnly} onClick={() => setErrorsOnly(!errorsOnly)}>Errors only</ToolbarToggle>
        <ToolbarToggle active={timestamps} onClick={() => setTimestamps(!timestamps)}>Timestamps</ToolbarToggle>
        <ToolbarToggle active={wrap} onClick={() => setWrap(!wrap)}>Wrap</ToolbarToggle>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn('min-h-0 flex-1 overflow-auto py-1 font-mono text-xs leading-relaxed', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}
      >
        {shown.length === 0 && (
          <div className="px-3 py-2 text-nd-text-muted">{filtering ? 'No lines match' : empty}</div>
        )}
        {shown.map((section) => (
          <Section
            key={section.key}
            section={section}
            open={isOpen(section)}
            onToggle={() => setToggled((t) => ({ ...t, [section.key]: !isOpen(section) }))}
            timestamps={timestamps}
          />
        ))}
        {!filtering && skipped.map((row) => (
          <div key={row.title} className="flex items-center gap-2 px-3 py-1 text-nd-text-muted">
            <span className="w-[13px]" />
            <Minus size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{row.title}</span>
            <span className="shrink-0">skipped</span>
          </div>
        ))}
      </div>
    </div>
  )
}
