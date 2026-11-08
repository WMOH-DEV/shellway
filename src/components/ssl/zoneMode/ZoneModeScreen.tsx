import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { STRICT_LABEL } from '@/utils/ssl/zoneMode/zoneModeView'
import { ModeChip } from './Chips'
import { useZoneMode } from './useZoneMode'
import { ZoneModeBody } from './ZoneModeBody'
import { ZoneModeFooter } from './ZoneModeFooter'

interface ZoneModeScreenProps {
  zone: string
  onCancel: () => void
  onFinished: () => void
}

export function ZoneModeScreen({ zone, onCancel, onFinished }: ZoneModeScreenProps) {
  const flow = useZoneMode(zone)
  const shownMode = flow.change?.result.mode ?? flow.preflight?.currentMode ?? null
  const showChip = flow.change !== null || flow.preflight !== null
  const leave = flow.change ? onFinished : onCancel
  return (
    <div className="flex h-full flex-col bg-nd-bg-primary">
      <header className="flex items-center gap-2.5 border-b border-nd-border px-7 py-4">
        <Button size="icon" variant="ghost" aria-label="Leave the SSL mode change" disabled={flow.busy} onClick={leave}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold text-nd-text-primary">{STRICT_LABEL} for {zone}</h1>
        {showChip && <ModeChip mode={shownMode} />}
      </header>
      <div className="flex-1 overflow-y-auto px-7 py-6">
        <ZoneModeBody zone={zone} flow={flow} />
      </div>
      <ZoneModeFooter flow={flow} onCancel={onCancel} onFinished={onFinished} />
    </div>
  )
}
