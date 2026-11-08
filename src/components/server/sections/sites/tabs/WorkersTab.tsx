import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ServerRoute } from '@/types/server/core'
import type { SiteJob } from '@/utils/server/sites/jobs'
import { Chip, SectionCard, type KitTone } from '../../../kit'
import type { SitePageProps } from '../SiteDetailPage'
import { useSiteJobs } from './useSiteJobs'

const RUNNING = /^(running|active|online|ok)$/i
const STOPPED = /^(stopped|fatal|exited|failed|errored|backoff)/i

function stateTone(state: string): KitTone {
  if (RUNNING.test(state)) return 'success'
  if (STOPPED.test(state)) return 'error'
  return 'neutral'
}

export const jobsRoute = (site: string, path: string): ServerRoute => ({ section: 'jobs', params: { site, path } })

export function JobRows({ jobs }: { jobs: SiteJob[] }) {
  if (jobs.length === 0) {
    return <p className="text-[13px] text-nd-text-muted">No workers or cron jobs found for this site folder.</p>
  }
  return (
    <div className="flex flex-col divide-y divide-nd-border">
      {jobs.map((job, index) => (
        <div key={`${job.name}-${index}`} className="flex min-w-0 items-center gap-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[13px] text-nd-text-primary">{job.name || 'Job'}</span>
            <span className="truncate font-mono text-xs text-nd-text-muted">{job.command}</span>
          </div>
          {job.state && <Chip dense tone={stateTone(job.state)}>{job.state.toLowerCase()}</Chip>}
        </div>
      ))}
    </div>
  )
}

export function WorkersTab({ page }: { page: SitePageProps }) {
  const { ctx, data, entry } = page
  const { name, path } = entry.summary.config
  const jobs = useSiteJobs(data.connectionId, path)
  const open = <Button size="sm" onClick={() => ctx.navigate(jobsRoute(name, path))}>Open Cron &amp; workers <ArrowRight size={13} /></Button>
  return (
    <SectionCard title="Workers & cron" count={jobs.length} aside={open}>
      <p className="text-[13px] text-nd-text-muted">Queue workers, pm2 apps and cron jobs that run in {path}. Add or change them in Cron &amp; workers.</p>
      <JobRows jobs={jobs} />
    </SectionCard>
  )
}
