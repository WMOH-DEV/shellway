import type { Tone } from '@/utils/ssl/tone'

export const CLOUDFLARE_ORANGE = '#f38020'

export const TONE_TEXT: Record<Tone, string> = {
  error: 'text-nd-error',
  warning: 'text-nd-warning',
  success: 'text-nd-success',
  neutral: 'text-nd-text-muted'
}

export const TONE_INK: Record<Tone, string> = {
  error: 'text-nd-error',
  warning: 'text-nd-warning',
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
  error: 'border-nd-error/40 bg-nd-error/5',
  warning: 'border-nd-warning/40 bg-nd-warning/5',
  success: 'border-nd-success/35 bg-nd-success/5',
  neutral: 'border-nd-border bg-nd-bg-tertiary/30'
}

export const TONE_LINE: Record<Tone, string> = {
  error: 'border-nd-error',
  warning: 'border-nd-warning',
  success: 'border-nd-success',
  neutral: 'border-nd-border-hover'
}
