import { useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ProbeResult, ServerRoute } from '@/types/server/core'
import { cn } from '@/utils/cn'
import { APT_CLEAN_COMMAND, AUTOREMOVE_COMMAND, autoremoveBytes, journalSavings, JOURNAL_KEEP_BYTES, JOURNAL_VACUUM_COMMAND, type CleanupInfo } from '@/utils/server/overview/cleanup'
import { DISK_ERROR_PERCENT, DISK_WARNING_PERCENT, type Filesystem } from '@/utils/server/overview/disk'
import { FOLDER_SCAN_SECONDS, type Folder, type FolderUsage } from '@/utils/server/overview/folders'
import { formatSize, formatUsage } from '@/utils/server/overview/format'
import { APT_CLEAN_ACTION, AUTOREMOVE_ACTION, CLEANUP_PROBE, DISK_PROBE, FOLDERS_PROBE, JOURNAL_VACUUM_ACTION, OVERVIEW_ROUTE } from '@/utils/server/overview/ids'
import { useActionLauncher } from '../../action'
import { DOT_TONE, Label, Notice, PageHeader, ProbeState, SectionCard, SectionPage, type KitTone } from '../../kit'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'
import { BackLink } from './BackLink'

const DISK_PROBES = [DISK_PROBE, CLEANUP_PROBE]
const FOLDER_PROBES = [FOLDERS_PROBE]
const DOCKER: ServerRoute = { section: 'docker' }

const fillTone = (percent: number): KitTone => (percent >= DISK_ERROR_PERCENT ? 'error' : percent >= DISK_WARNING_PERCENT ? 'warning' : 'success')

function Bar({ percent, tone }: { percent: number; tone: KitTone }) {
  return (
    <div className="flex h-1 overflow-hidden rounded-sm bg-nd-surface-raised">
      <span className={cn('h-full', DOT_TONE[tone])} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  )
}

function FilesystemRow({ fs }: { fs: Filesystem }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center gap-4 border-b border-nd-border px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-mono text-[12.5px] text-nd-text-primary">{fs.mount}</span>
        <span className="truncate font-mono text-xs text-nd-text-muted">{fs.device} · {fs.type}</span>
      </div>
      <Bar percent={fs.usedPercent} tone={fillTone(fs.usedPercent)} />
      <span className="whitespace-nowrap text-xs text-nd-text-secondary">{fs.usedPercent}% · {formatUsage(fs.usedBytes, fs.sizeBytes)}</span>
    </div>
  )
}

function FolderList({ title, folders }: { title: string; folders: Folder[] }) {
  const largest = folders[0]?.sizeBytes ?? 0
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label>{title}</Label>
      {folders.length === 0 && <span className="text-xs text-nd-text-muted">Nothing found.</span>}
      {folders.map((folder) => (
        <div key={folder.path} className="grid grid-cols-[minmax(0,1fr)_72px_64px] items-center gap-3">
          <span className="truncate font-mono text-xs text-nd-text-primary" title={folder.path}>{folder.path}</span>
          <Bar percent={largest > 0 ? (folder.sizeBytes / largest) * 100 : 0} tone="info" />
          <span className="text-right text-xs text-nd-text-secondary">{formatSize(folder.sizeBytes)}</span>
        </div>
      ))}
    </div>
  )
}

function FolderScan({ ctx }: { ctx: ServerSectionContext }) {
  const { facts, loading, refresh } = useServerFacts(ctx, FOLDER_PROBES)
  return (
    <div className="flex flex-col gap-3">
      <ProbeState result={facts[FOLDERS_PROBE]} label="folder sizes">
        {(data) => {
          const usage = data as FolderUsage
          return (
            <>
              {usage.partial && <Notice tone="warning">The scan stopped after {FOLDER_SCAN_SECONDS} seconds, so some sizes are too small.</Notice>}
              <div className="grid grid-cols-2 gap-6">
                <FolderList title="In /" folders={usage.root} />
                <FolderList title="In /var" folders={usage.var} />
              </div>
            </>
          )
        }}
      </ProbeState>
      <Button size="sm" className="self-start" onClick={() => void refresh()} disabled={loading}>Scan again</Button>
    </div>
  )
}

function BiggestFolders({ ctx }: { ctx: ServerSectionContext }) {
  const [requested, setRequested] = useState(false)
  return (
    <SectionCard title="Biggest folders">
      {requested ? <FolderScan ctx={ctx} /> : (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[13px] text-nd-text-muted">Measures every folder on the main disk. Takes up to {FOLDER_SCAN_SECONDS} seconds and runs with low priority.</p>
          <Button size="sm" onClick={() => setRequested(true)}>Scan folders</Button>
        </div>
      )}
    </SectionCard>
  )
}

interface CleanupRowProps {
  title: string
  detail: ReactNode
  command: string
  estimate: string | null
  actionLabel: string
  disabled: boolean
  onRun(): void
}

function CleanupRow({ title, detail, command, estimate, actionLabel, disabled, onRun }: CleanupRowProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-nd-border px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-nd-text-primary">{title}</span>
          {estimate && <span className="text-xs text-nd-success-fg">{estimate}</span>}
        </div>
        <div className="text-xs text-nd-text-muted">{detail}</div>
        <code className="truncate rounded-md bg-nd-bg-sunken px-2 py-1 font-mono text-[11.5px] text-nd-text-secondary" title={command}>{command}</code>
      </div>
      <Button size="sm" onClick={onRun} disabled={disabled}>{actionLabel}</Button>
    </div>
  )
}

const packageList = (info: CleanupInfo): string => {
  const names = info.apt?.autoremove.map((pkg) => pkg.name) ?? []
  return names.length === 0 ? 'Nothing unused right now.' : `Will remove: ${names.join(', ')}`
}

function CleanupRows({ info, run, onOpen }: { info: CleanupInfo; run(type: string): void; onOpen(route: ServerRoute): void }) {
  const apt = info.apt
  const journal = info.journalBytes
  const unused = apt?.autoremove ?? []
  return (
    <>
      {apt && (
        <CleanupRow
          title="Downloaded package files"
          detail="Package files apt keeps after installing. Installed software is not touched."
          command={APT_CLEAN_COMMAND}
          estimate={apt.cacheBytes > 0 ? `about ${formatSize(apt.cacheBytes)}` : null}
          actionLabel="Clear"
          disabled={apt.cacheBytes === 0}
          onRun={() => run(APT_CLEAN_ACTION)}
        />
      )}
      {apt && (
        <CleanupRow
          title="Unused packages"
          detail={<span className="font-mono">{packageList(info)}</span>}
          command={AUTOREMOVE_COMMAND}
          estimate={unused.length > 0 ? `about ${formatSize(autoremoveBytes(unused))}` : null}
          actionLabel="Remove"
          disabled={unused.length === 0}
          onRun={() => run(AUTOREMOVE_ACTION)}
        />
      )}
      {journal !== null && (
        <CleanupRow
          title="Old system logs"
          detail={`System logs use ${formatSize(journal)}. Keeps the newest 200 MB.`}
          command={JOURNAL_VACUUM_COMMAND}
          estimate={journal > JOURNAL_KEEP_BYTES ? `up to ${formatSize(journalSavings(journal))}` : null}
          actionLabel="Trim"
          disabled={journal <= JOURNAL_KEEP_BYTES}
          onRun={() => run(JOURNAL_VACUUM_ACTION)}
        />
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] font-medium text-nd-text-primary">Docker images and build cache</span>
          <span className="text-xs text-nd-text-muted">Unused images, stopped containers and build cache are cleaned in the Docker section.</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onOpen(DOCKER)}>Open Docker</Button>
      </div>
    </>
  )
}

function FlushProbe({ result, label, children }: { result: ProbeResult | undefined; label: string; children(data: unknown): ReactNode }) {
  if (result?.status === 'ok') return <>{children(result.data)}</>
  return (
    <div className="px-4 py-2">
      <ProbeState result={result} label={label}>{() => null}</ProbeState>
    </div>
  )
}

export function DiskPage({ ctx }: { ctx: ServerSectionContext }) {
  const { facts, loading, refresh } = useServerFacts(ctx, DISK_PROBES)
  const launcher = useActionLauncher(ctx)
  const run = (type: string) => launcher.launch({ type, params: {}, onFinished: () => void refresh() })

  return (
    <SectionPage>
      <BackLink onBack={() => ctx.navigate(OVERVIEW_ROUTE)} />
      <PageHeader
        title="Disk usage & cleanup"
        subtitle="See what fills the disk and free space safely. Every cleanup shows its command before it runs."
        actions={<Button onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} aria-hidden />Refresh</Button>}
      />
      <SectionCard title="Filesystems" flush>
        <FlushProbe result={facts[DISK_PROBE]} label="filesystems">
          {(data) => (data as Filesystem[]).map((fs) => <FilesystemRow key={fs.mount} fs={fs} />)}
        </FlushProbe>
      </SectionCard>
      <BiggestFolders ctx={ctx} />
      <SectionCard title="Free up space" flush>
        <FlushProbe result={facts[CLEANUP_PROBE]} label="cleanup options">
          {(data) => <CleanupRows info={data as CleanupInfo} run={run} onOpen={ctx.navigate} />}
        </FlushProbe>
      </SectionCard>
    </SectionPage>
  )
}
