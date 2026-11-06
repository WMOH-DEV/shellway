import { useState } from 'react'
import { toast } from '@/components/ui/Toast'
import type { CloudflareStatus } from '@/types/ssl'
import { sslApi } from '../sslApi'
import { useSslResource, type SslResource } from './useSslResource'

const NO_TOKEN: CloudflareStatus = { saved: false, tokenHint: '', error: null, permissions: [], zones: [] }

const loadStatus = () => sslApi().cloudflareStatus()

export interface CloudflareToken {
  status: SslResource<CloudflareStatus>
  busy: boolean
  save: (token: string) => Promise<boolean>
  remove: () => Promise<void>
}

export function useCloudflareToken(onChanged: () => void): CloudflareToken {
  const status = useSslResource(loadStatus)
  const [busy, setBusy] = useState(false)

  const save = async (token: string): Promise<boolean> => {
    setBusy(true)
    const result = await sslApi().saveCloudflareToken(token)
    setBusy(false)
    if (!result.success || !result.data) {
      toast.error('Could not save the token', result.error)
      return false
    }
    status.replace(result.data)
    onChanged()
    return true
  }

  const remove = async () => {
    setBusy(true)
    const result = await sslApi().removeCloudflareToken()
    setBusy(false)
    if (!result.success) {
      toast.error('Could not remove the token', result.error)
      return
    }
    status.replace(NO_TOKEN)
    onChanged()
  }

  return { status, busy, save, remove }
}
