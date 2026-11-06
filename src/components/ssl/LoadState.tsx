import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'

export function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center bg-nd-bg-primary" role="status" aria-label="Checking certificates">
      <Spinner size="md" />
    </div>
  )
}

export function ErrorBanner({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-[10px] border border-nd-error/30 bg-nd-error/[0.07] px-3.5 py-2.5 text-[13px] text-nd-text-primary">
      <AlertTriangle size={15} className="shrink-0 text-nd-error-fg" />
      <span className="flex-1">{message}</span>
      <Button size="sm" onClick={onRetry} disabled={retrying}>Try again</Button>
    </div>
  )
}

export function ErrorState({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-nd-bg-primary px-7">
      <div className="w-full max-w-xl">
        <ErrorBanner message={message} retrying={retrying} onRetry={onRetry} />
      </div>
    </div>
  )
}
