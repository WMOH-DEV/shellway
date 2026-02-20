import { useState, useCallback } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'

interface KBDIPrompt {
  prompt: string
  echo?: boolean
}

interface KBDIDialogProps {
  /** Prompts from the server */
  prompts: KBDIPrompt[]
  /** Optional name from the server */
  name?: string
  /** Optional instruction text from the server */
  instruction?: string
  /** Called when user submits responses */
  onSubmit: (responses: string[], remember: boolean) => void
  /** Called when user cancels */
  onCancel: () => void
}

/**
 * Modal for keyboard-interactive (KBDI) authentication.
 * Displays server prompts and collects user responses.
 */
export function KBDIDialog({ prompts, name, instruction, onSubmit, onCancel }: KBDIDialogProps) {
  const [responses, setResponses] = useState<string[]>(() => prompts.map(() => ''))
  const [remember, setRemember] = useState(false)

  const updateResponse = useCallback((idx: number, value: string) => {
    setResponses((prev) => {
      const next = [...prev]
      next[idx] = value
      return next
    })
  }, [])

  const handleSubmit = useCallback(() => {
    onSubmit(responses, remember)
  }, [responses, remember, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  return (
    <Modal
      open
      onClose={onCancel}
      closeOnBackdrop={false}
      closeOnEscape={true}
      maxWidth="max-w-md"
    >
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-nd-accent/10 flex items-center justify-center">
            <ShieldQuestion size={20} className="text-nd-accent" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-nd-text-primary">
              {name || 'Keyboard-Interactive Authentication'}
            </h3>
            {instruction && (
              <p className="text-xs text-nd-text-secondary mt-0.5">{instruction}</p>
            )}
          </div>
        </div>

        {/* Server prompts */}
        <div className="flex flex-col gap-3">
          {prompts.map((prompt, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-nd-text-secondary">
                {prompt.prompt || `Response ${idx + 1}`}
              </label>
              <input
                type={prompt.echo ? 'text' : 'password'}
                value={responses[idx] || ''}
                onChange={(e) => updateResponse(idx, e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus={idx === 0}
                placeholder={prompt.echo ? 'Type response...' : 'Enter password...'}
                className="h-8 w-full rounded-md border bg-nd-surface px-3 text-sm text-nd-text-primary border-nd-border placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent focus:ring-1 focus:ring-nd-accent"
              />
            </div>
          ))}
        </div>

        {/* Remember toggle */}
        <Toggle
          checked={remember}
          onChange={setRemember}
          label="Remember responses for future connections"
        />

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit}>
            Submit
          </Button>
        </div>
      </div>
    </Modal>
  )
}
