import { memo, useState, useCallback, useRef } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

// ── Props ──

interface SafeModeIndicatorProps {
  isProduction: boolean
}

// ── Indicator component ──

export const SafeModeIndicator = memo(function SafeModeIndicator({
  isProduction,
}: SafeModeIndicatorProps) {
  if (!isProduction) return null

  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="error" className="animate-pulse">
        <ShieldAlert size={11} />
        PRODUCTION
      </Badge>
    </div>
  )
})

// ── Confirmation hook ──

interface ConfirmState {
  open: boolean
  action: string
  callback: (() => void) | null
}

export function useProductionConfirm(isProduction: boolean) {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    action: '',
    callback: null,
  })
  const callbackRef = useRef<(() => void) | null>(null)

  const confirm = useCallback(
    (action: string, callback: () => void) => {
      if (!isProduction) {
        // Non-production: execute immediately
        callback()
        return
      }
      callbackRef.current = callback
      setState({ open: true, action, callback })
    },
    [isProduction]
  )

  const handleConfirm = useCallback(() => {
    callbackRef.current?.()
    callbackRef.current = null
    setState({ open: false, action: '', callback: null })
  }, [])

  const handleCancel = useCallback(() => {
    callbackRef.current = null
    setState({ open: false, action: '', callback: null })
  }, [])

  const ConfirmDialog = useCallback(
    () => (
      <Modal
        open={state.open}
        onClose={handleCancel}
        title="Production Database"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-full bg-nd-error/10">
              <ShieldAlert size={20} className="text-nd-error" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-nd-text-primary">
                You are modifying a production database
              </p>
              <p className="text-xs text-nd-text-muted">
                {state.action}. This action cannot be undone.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={handleConfirm}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    ),
    [state.open, state.action, handleCancel, handleConfirm]
  )

  return { confirm, ConfirmDialog }
}
