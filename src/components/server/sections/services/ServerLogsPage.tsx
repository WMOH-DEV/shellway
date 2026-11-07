import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import type { SystemLogId } from '@/utils/server/services/logChannel'
import { SYSTEM_LOGS } from '@/utils/server/services/logSources'
import { PageHeader, SectionPage } from '../../kit'
import type { ServerSectionContext } from '../types'
import { LogPanel } from './LogPanel'

const OPTIONS = SYSTEM_LOGS.map((log) => ({ value: log.id, label: log.label }))

const isSystemLog = (value: string | undefined): value is SystemLogId => SYSTEM_LOGS.some((log) => log.id === value)

export function ServerLogsPage({ ctx }: { ctx: ServerSectionContext }) {
  const requested = ctx.route.params?.source
  const [id, setId] = useState<SystemLogId>(isSystemLog(requested) ? requested : 'journal')
  const back = (
    <Button variant="ghost" size="icon" aria-label="Back to services" onClick={() => ctx.navigate({ section: 'services' })}>
      <ArrowLeft size={16} />
    </Button>
  )

  return (
    <SectionPage>
      <PageHeader
        leading={back}
        title="Server logs"
        subtitle="Read the server's own logs. Go live to see new lines as they are written."
        actions={<Select aria-label="Log source" value={id} options={OPTIONS} onChange={(event) => setId(event.target.value as SystemLogId)} />}
      />
      <div className="h-[68vh] min-h-[360px]">
        <LogPanel ctx={ctx} source={{ kind: 'system', id }} />
      </div>
    </SectionPage>
  )
}
