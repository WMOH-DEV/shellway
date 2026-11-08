import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { RunRecord } from '@/types/createSite'
import { deleteBlockedReason } from '@/utils/createSite/runView'
import type { ServerSectionContext } from '../types'

export function DeleteSiteRow({ ctx, run }: { ctx: ServerSectionContext; run: RunRecord }) {
  const open = () => ctx.navigate({ section: 'sites', sub: 'create', params: { run: run.id, delete: '1' } })
  const blocked = deleteBlockedReason(run)
  if (blocked !== null) return <p className="text-[13px] text-nd-text-muted">Create site made this site. {blocked}</p>
  return (
    <div className="flex items-center gap-3">
      <p className="flex-1 text-[13px] text-nd-text-muted">Create site made this site. Delete it to stop the app and remove its web server site, DNS records, certificate and deploy setup. The folder and database stay on the server.</p>
      <Button variant="danger" onClick={open}><Trash2 size={13} /> Delete site</Button>
    </div>
  )
}
