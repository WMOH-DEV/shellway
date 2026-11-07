import { toast } from '@/components/ui/Toast'
import type { ActivityEntry } from '@/types/server/core'
import { activityToJson, activityToText, exportFileName, type ActivityExportFormat } from '@/utils/server/activity/export'
import { ACTIVITY_PAGE_SIZE, matchesView, mergeEntries, oldestAt, toActivityQuery, type ActivityFilter } from '@/utils/server/activity/filter'
import { serverApi } from '../../serverApi'

const MAX_PAGES = 40

export async function exportActivity(sessionKey: string, sessionName: string, filter: ActivityFilter, format: ActivityExportFormat): Promise<void> {
  try {
    const entries = (await fetchAll(sessionKey, filter)).filter((entry) => matchesView(entry, filter.view))
    const content = format === 'json' ? activityToJson(entries) : activityToText(entries)
    const result = await serverApi().activityArea.exportFile(format, exportFileName(sessionName, format, Date.now()), content)
    if (!result.success) throw new Error(result.error)
    if (result.data.saved) toast.success('Activity exported', `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`)
  } catch (err) {
    toast.error('Could not export the activity', (err as Error).message)
  }
}

async function fetchAll(sessionKey: string, filter: ActivityFilter): Promise<ActivityEntry[]> {
  let all: ActivityEntry[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await serverApi().activity(sessionKey, toActivityQuery(filter, oldestAt(all)))
    if (!result.success) throw new Error(result.error)
    all = mergeEntries(all, result.data)
    if (result.data.length < ACTIVITY_PAGE_SIZE) break
  }
  return all
}
