import { useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { toast } from '@/components/ui/Toast'

interface ServiceRestartPickerProps {
  connectionId: string
  onPick: (unit: string) => void
}

export function ServiceRestartPicker({ connectionId, onPick }: ServiceRestartPickerProps) {
  const [units, setUnits] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const result = await window.novadeck.services.list(connectionId)
    setLoading(false)
    if (!result?.success) {
      toast.error('Could not list services', result?.error)
      return
    }
    setUnits((result.data as { unit: string }[]).map((service) => service.unit).sort())
  }

  if (!units) {
    return (
      <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
        <RotateCw size={13} /> Add service restart
      </Button>
    )
  }
  return (
    <div className="w-56">
      <Select
        aria-label="Restart which service"
        value=""
        placeholder="Restart which service?"
        options={units.map((unit) => ({ value: unit, label: unit }))}
        onChange={(e) => e.target.value && onPick(e.target.value)}
      />
    </div>
  )
}
