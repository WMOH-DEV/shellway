import type { Verdict } from '../../types/ssl'

export type Tone = 'error' | 'warning' | 'success' | 'neutral'

const VERDICT_TONES: Record<Verdict, Tone> = {
  broken: 'error',
  'will-break': 'error',
  expiring: 'warning',
  'not-encrypted': 'warning',
  unchecked: 'neutral',
  ok: 'success'
}

export const verdictTone = (verdict: Verdict): Tone => VERDICT_TONES[verdict]
