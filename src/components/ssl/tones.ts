import type { Tone } from '@/utils/ssl/tone'

export const TONE_TEXT: Record<Tone, string> = {
  error: 'text-nd-error-fg',
  warning: 'text-nd-warning-fg',
  success: 'text-nd-success-fg',
  neutral: 'text-nd-text-muted'
}

export const TONE_INK: Record<Tone, string> = {
  error: 'text-nd-error-fg',
  warning: 'text-nd-warning-fg',
  success: 'text-nd-text-secondary',
  neutral: 'text-nd-text-muted'
}

export const TONE_FILL: Record<Tone, string> = {
  error: 'bg-nd-error',
  warning: 'bg-nd-warning',
  success: 'bg-nd-success',
  neutral: 'bg-nd-text-muted'
}

export const TONE_BADGE: Record<Tone, 'error' | 'warning' | 'success' | 'default'> = {
  error: 'error',
  warning: 'warning',
  success: 'success',
  neutral: 'default'
}

export const TONE_CARD: Record<Tone, string> = {
  error: 'border-nd-error/30 bg-nd-error/[0.07]',
  warning: 'border-nd-warning/30 bg-nd-warning/[0.07]',
  success: 'border-nd-success/30 bg-nd-success/[0.07]',
  neutral: 'border-nd-border bg-nd-surface'
}

export const TONE_LINE: Record<Tone, string> = {
  error: 'border-nd-error',
  warning: 'border-nd-warning',
  success: 'border-nd-success',
  neutral: 'border-nd-border-hover'
}
