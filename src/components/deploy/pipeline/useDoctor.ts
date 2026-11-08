import { useEffect, useState } from 'react'
import type { DoctorReport } from '@/types/deploy'
import { deployApi } from '../useDeploySites'

export function useDoctor(connectionId: string, siteName: string, refreshKey: string) {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let current = true
    setLoading(true)
    void deployApi().doctor(connectionId, siteName).then((result) => {
      if (!current) return
      setReport(result.success && result.data ? result.data : null)
      setLoading(false)
    })
    return () => { current = false }
  }, [connectionId, siteName, refreshKey])

  return { report, loading }
}
