import { useNowMs } from '@/components/deploy/useNowMs'
import { Toggle } from '@/components/ui/Toggle'
import { toast } from '@/components/ui/Toast'
import type { AlertSettings } from '@/types/ssl'
import { lastAlertText } from '@/utils/ssl/settingsServer'
import { sslApi } from '../sslApi'
import { CardHeading, ErrorLine, LoadingLine, SettingsCard } from './SettingsCard'
import { useSslResource } from './useSslResource'

const loadAlerts = () => sslApi().alerts()

function AlertDetails({ alerts, now }: { alerts: AlertSettings; now: number }) {
  const last = lastAlertText(alerts.lastAlert, now)
  return (
    <div className="flex flex-col gap-1.5 text-xs text-nd-text-muted">
      <span>Last alert: <span className="text-nd-text-secondary">{last ?? 'none yet'}</span></span>
      {alerts.unreachable.map(({ host, reason }) => (
        <span key={host}>Can't check from this PC: <span className="font-mono text-nd-text-secondary">{host}</span> ({reason})</span>
      ))}
    </div>
  )
}

export function AlertsCard() {
  const { data, error, loading, reload, replace } = useSslResource(loadAlerts)
  const nowSeconds = Math.floor(useNowMs(false) / 1000)

  const setEnabled = async (enabled: boolean) => {
    const result = await sslApi().setAlertsEnabled(enabled)
    if (result.success && result.data) replace(result.data)
    else toast.error('Could not change the alert setting', result.error)
  }

  return (
    <SettingsCard label="Background alerts">
      <CardHeading title="Alerts">
        {data && <Toggle className="ml-auto" ariaLabel="Background certificate alerts" checked={data.probeEnabled} onChange={(enabled) => void setEnabled(enabled)} />}
      </CardHeading>
      <span className="text-[13px] text-nd-text-secondary">
        While Shellway is open, this PC checks each hostname's server certificate every 12 hours, even for servers you have not opened today.
      </span>
      {data && <AlertDetails alerts={data} now={nowSeconds} />}
      {!data && loading && <LoadingLine text="Loading alert settings…" />}
      {!data && error && <ErrorLine message={error} onRetry={() => void reload()} />}
    </SettingsCard>
  )
}
