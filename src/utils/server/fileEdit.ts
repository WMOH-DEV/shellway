import type { ActionStep } from '@/types/server/core'

export interface FileEditSpec {
  id: string
  label: string
  path: string
  content: string
  originalSha256: string | null
  mode?: string
  owner?: string
  test?: string
  reload?: string
  verify?: string
  timeoutSeconds?: number
  diff?: string
}

export const EXIT_FILE_CHANGED = 74

export function fileEditStep(spec: FileEditSpec): ActionStep {
  return {
    id: spec.id,
    label: spec.label,
    kind: 'file-edit',
    root: true,
    script: `echo ${JSON.stringify(spec.path)} >/dev/null; exit 1`,
    display: [`write ${spec.path}`, spec.test, spec.reload].filter(Boolean).join('\n'),
    diff: spec.diff,
    timeoutSeconds: spec.timeoutSeconds ?? 60,
    cleanExits: [EXIT_FILE_CHANGED]
  }
}
