export type KitTone = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export const CHIP_TONE: Record<KitTone, string> = {
  success: 'bg-nd-success/12 text-nd-success-fg',
  warning: 'bg-nd-warning/12 text-nd-warning-fg',
  error: 'bg-nd-error/12 text-nd-error-fg',
  info: 'bg-nd-info/12 text-nd-info-fg',
  neutral: 'bg-nd-surface-raised text-nd-text-muted'
}

export const DOT_TONE: Record<KitTone, string> = {
  success: 'bg-nd-success',
  warning: 'bg-nd-warning',
  error: 'bg-nd-error',
  info: 'bg-nd-info',
  neutral: 'bg-nd-text-muted'
}

export const CALLOUT_TONE: Record<KitTone, string> = {
  success: 'border-nd-success/30 bg-nd-success/[0.07]',
  warning: 'border-nd-warning/30 bg-nd-warning/[0.07]',
  error: 'border-nd-error/30 bg-nd-error/[0.07]',
  info: 'border-nd-info/30 bg-nd-info/[0.07]',
  neutral: 'border-nd-border bg-nd-surface'
}

export const TEXT_TONE: Record<KitTone, string> = {
  success: 'text-nd-success-fg',
  warning: 'text-nd-warning-fg',
  error: 'text-nd-error-fg',
  info: 'text-nd-info-fg',
  neutral: 'text-nd-text-muted'
}
