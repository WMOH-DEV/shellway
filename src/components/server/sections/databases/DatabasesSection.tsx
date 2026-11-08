import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import type { ProbeResult, ServerFacts } from '@/types/server/core'
import { publicAddresses } from '@/utils/server/databases/attention'
import { BACKUPS_PROBE, backupFacts, engineFacts, flavorLabel, MYSQL_PROBE, POSTGRES_PROBE, REDIS_PROBE, redisFacts, SITES_PROBE, siteEnvFacts } from '@/utils/server/databases/facts'
import type { BackupFacts, BackupFile, DbEngine, EngineFacts, RedisFacts, SiteEnv } from '@/utils/server/databases/types'
import type { ComponentId } from '@/utils/server/install/types'
import { useActionLauncher } from '../../action'
import { Notice, PageHeader, ProbeState, SectionPage, Segmented, type SegmentOption } from '@/components/server/kit'
import { serverApi } from '../../serverApi'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'
import { BackupsCard } from './BackupsCard'
import { DatabaseDialogs, type DialogState, type RunAction } from './DatabaseDialogs'
import { DatabasesTable } from './DatabasesTable'
import { EngineNotInstalled, type EngineTab } from './EngineNotReady'
import { openInSqlTab } from './openInSql'
import { generatePassword } from '@/utils/server/databases/password'
import { RedisPanel } from './RedisPanel'
import { UsersTable } from './UsersTable'
import { useWithOsFamily } from '../../useWithOsFamily'

const PROBES = [MYSQL_PROBE, POSTGRES_PROBE, REDIS_PROBE, BACKUPS_PROBE, SITES_PROBE]
const TABS: EngineTab[] = ['mysql', 'postgresql', 'redis']

const shortVersion = (version: string): string => version.split('.').slice(0, 2).join('.')

function engineTabLabel(tab: EngineTab, facts: ServerFacts): string {
  if (tab === 'redis') {
    const redis = redisFacts(facts)
    if (redis?.status === 'missing') return '+ Redis'
    return redis?.version ? `Redis ${shortVersion(redis.version)}` : 'Redis'
  }
  const data = engineFacts(facts, tab)
  const name = flavorLabel(data?.flavor ?? tab)
  if (data?.status === 'missing') return `+ ${name}`
  return data?.version ? `${name} ${shortVersion(data.version)}` : name
}

function isInstalled(tab: EngineTab, facts: ServerFacts): boolean {
  const status = tab === 'redis' ? redisFacts(facts)?.status : engineFacts(facts, tab)?.status
  return status !== undefined && status !== 'missing'
}

const defaultTab = (facts: ServerFacts): EngineTab => TABS.find((tab) => isInstalled(tab, facts)) ?? 'mysql'

const routeTab = (engine: string | undefined): EngineTab | null => TABS.find((tab) => tab === engine) ?? null

function EngineBody({ data, children }: { data: EngineFacts; children: React.ReactNode }) {
  if (data.status === 'ok') return <>{children}</>
  const title = data.status === 'stopped' ? `${flavorLabel(data.flavor)} is not running` : `Shellway cannot sign in to ${flavorLabel(data.flavor)}`
  return <Notice tone="warning" title={title}>{data.reason}</Notice>
}

export function DatabasesSection({ ctx }: { ctx: ServerSectionContext }) {
  const { facts, loading, refresh } = useServerFacts(ctx, PROBES)
  const launcher = useActionLauncher(ctx)
  const withOsFamily = useWithOsFamily(ctx.sessionId)
  const [picked, setPicked] = useState<EngineTab | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const backupsRef = useRef<HTMLDivElement>(null)
  const routeEngine = routeTab(ctx.route.params?.engine)
  const tab = picked ?? defaultTab(facts)
  const engine: DbEngine | null = tab === 'redis' ? null : tab
  const data = engine ? engineFacts(facts, engine) : null
  const sites = siteEnvFacts(facts)?.sites ?? []
  const backups = backupFacts(facts)
  const backupsResult = facts[BACKUPS_PROBE] as ProbeResult<BackupFacts> | undefined
  const files = backups?.files.filter((file) => file.engine === engine) ?? []

  useEffect(() => {
    if (routeEngine) setPicked(routeEngine)
  }, [routeEngine])

  useEffect(() => {
    if (ctx.route.sub === 'backups') backupsRef.current?.scrollIntoView({ block: 'nearest' })
  }, [ctx.route.sub, backups])

  const run: RunAction = (type, params, onDone) => {
    setDialog(null)
    launcher.launch({
      type,
      params,
      onFinished: (result) => {
        void refresh()
        if (result.status === 'done') onDone?.()
      }
    })
  }

  const download = async (path: string) => {
    setDownloading(path)
    const result = await serverApi().databases.downloadBackup(ctx.connectionId, path)
    setDownloading(null)
    if (!result.success) toast.error('Download failed', result.error)
    else if (result.data) toast.success('Backup saved', result.data.savedTo)
  }

  const install = async (component: ComponentId) => launcher.launch({ type: 'software.install', params: await withOsFamily({ component }), onFinished: () => void refresh() })

  const tabs: SegmentOption<EngineTab>[] = TABS.map((value) => ({ value, label: engineTabLabel(value, facts) }))
  const canCreate = data?.status === 'ok'

  return (
    <SectionPage>
      <PageHeader
        title="Databases"
        subtitle="Create databases and users for your sites. Query them in the SQL tab."
        actions={
          <>
            <Segmented<EngineTab> ariaLabel="Database engine" options={tabs} value={tab} onChange={setPicked} />
            <Button variant="ghost" size="icon" aria-label="Refresh" title="Refresh" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            </Button>
            {engine && <Button variant="primary" disabled={!canCreate} onClick={() => setDialog({ kind: 'create', password: generatePassword() })}>Create database</Button>}
          </>
        }
      />
      {tab === 'redis' ? (
        <ProbeState result={facts[REDIS_PROBE] as ProbeResult<RedisFacts> | undefined} label="Redis">
          {(redis) => (redis.status === 'missing' ? <EngineNotInstalled engine="redis" onInstall={install} /> : <RedisPanel redis={redis} />)}
        </ProbeState>
      ) : (
        <ProbeState result={facts[engine === 'mysql' ? MYSQL_PROBE : POSTGRES_PROBE] as ProbeResult<EngineFacts> | undefined} label={tab === 'mysql' ? 'MySQL' : 'PostgreSQL'}>
          {(current) =>
            current.status === 'missing' ? (
              <EngineNotInstalled engine={tab} onInstall={install} />
            ) : (
              <EngineBody data={current}>
                <EngineContent
                  data={current}
                  backups={backupsResult}
                  files={files}
                  sites={sites}
                  downloading={downloading}
                  backupsRef={backupsRef}
                  tabId={ctx.tabId}
                  show={setDialog}
                  run={run}
                  download={download}
                />
              </EngineBody>
            )
          }
        </ProbeState>
      )}
      {dialog && <DatabaseDialogs dialog={dialog} data={data} sites={sites} backups={backups} files={files} run={run} show={setDialog} />}
    </SectionPage>
  )
}

interface ContentProps {
  data: EngineFacts
  backups: ProbeResult<BackupFacts> | undefined
  files: BackupFile[]
  sites: SiteEnv[]
  downloading: string | null
  backupsRef: React.RefObject<HTMLDivElement>
  tabId: string
  show(dialog: DialogState): void
  run: RunAction
  download(path: string): void
}

function EngineContent({ data, backups, files, sites, downloading, backupsRef, tabId, show, run, download }: ContentProps) {
  const exposed = data.engine === 'mysql' ? publicAddresses(data) : []
  return (
    <>
      {exposed.length > 0 && (
        <Notice tone="warning" title="MySQL listens on every network address">
          {exposed.join(', ')}. If apps only run on this server, set bind-address = 127.0.0.1 in the MySQL config, or block the port in the firewall.
        </Notice>
      )}
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4">
        <DatabasesTable
          data={data}
          sites={sites}
          onOpen={(name) => void openInSqlTab(tabId, data.engine, name)}
          onBackup={(name) => run('databases.backup-now', { engine: data.engine, name })}
          onDrop={(name) => show({ kind: 'drop-database', name })}
        />
        <UsersTable
          data={data}
          onAdd={() => show({ kind: 'add-user', password: generatePassword() })}
          onPassword={(user) => show({ kind: 'password', user, password: generatePassword() })}
          onDrop={(user) => show({ kind: 'drop-user', user })}
        />
      </div>
      <div ref={backupsRef}>
        <ProbeState result={backups} label="backups">
          {(current) => <BackupsCard backups={current} files={files} downloading={downloading} onSettings={() => show({ kind: 'schedule' })} onRestore={(file) => show({ kind: 'restore', file })} onDownload={download} />}
        </ProbeState>
      </div>
    </>
  )
}
