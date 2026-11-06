import { useEffect, useState } from 'react'
import type { ServerBlock } from '@/types/ssl'
import { blockForSite } from '@/utils/ssl/https/siteMatch'
import { sslApi } from '../sslApi'

export function useUnencryptedBlock(connectionId: string, path: string, healthUrl: string): ServerBlock | null {
  const [block, setBlock] = useState<ServerBlock | null>(null)

  useEffect(() => {
    let active = true
    setBlock(null)
    void sslApi().lastReport(connectionId).then(({ success, data }) => {
      if (!active || !success || !data) return
      const match = blockForSite({ path, healthUrl }, data.blocks)
      setBlock(match && !match.tls ? match : null)
    })
    return () => { active = false }
  }, [connectionId, path, healthUrl])

  return block
}
