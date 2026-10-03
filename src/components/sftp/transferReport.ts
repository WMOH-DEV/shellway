import { toast } from '@/components/ui/Toast'

export type TransferResult = Awaited<ReturnType<typeof window.novadeck.sftp.download>>
export type TransferVerb = 'Download' | 'Upload'

export interface NamedTransferResult {
  name: string
  res: TransferResult
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function enqueuedFileCount(res: TransferResult): number {
  if (!res?.success || res.skipped) return 0
  return res.directory ? res.enqueued ?? 0 : 1
}

export function reportTransfer(
  res: TransferResult,
  verb: TransferVerb,
  name: string,
  destination: string
): void {
  if (!res?.success) {
    toast.error(`${verb} failed`, res?.error || 'Unknown error')
    return
  }
  if (res.directory) {
    if (res.enqueued === 0) {
      toast.warning(
        `Nothing to ${verb.toLowerCase()}`,
        res.conflicts
          ? `${name}: every file already exists at the destination`
          : `${name} is empty`
      )
      return
    }
    const skippedNote = res.conflicts ? `, ${res.conflicts} already existed` : ''
    toast.info(
      `${verb} started`,
      `${name} — ${plural(res.enqueued ?? 0, 'file')}${skippedNote} → ${destination}`
    )
    return
  }
  if (res.skipped) {
    toast.warning(`${verb} skipped`, `${name} already exists at the destination`)
    return
  }
  toast.info(`${verb} started`, `${name} → ${destination}`)
}

export function reportTransfers(
  results: NamedTransferResult[],
  verb: TransferVerb,
  destination: string
): void {
  if (results.length === 1) {
    reportTransfer(results[0].res, verb, results[0].name, destination)
    return
  }

  const failures = results.filter((r) => !r.res?.success)
  const fileCount = results.reduce((sum, r) => sum + enqueuedFileCount(r.res), 0)

  if (failures.length > 0) {
    toast.error(
      `${failures.length} of ${results.length} ${verb.toLowerCase()}s failed`,
      failures.map((f) => `${f.name}: ${f.res?.error || 'Unknown error'}`).join('\n')
    )
  }
  if (fileCount === 0) {
    if (failures.length === 0) toast.warning(`Nothing to ${verb.toLowerCase()}`, 'Every file already exists at the destination')
    return
  }
  toast.info(`${verb} started`, `${plural(fileCount, 'file')} → ${destination}`)
}
