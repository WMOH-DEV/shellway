import type { ActionStep } from '@/types/server/core'
import { MASK } from './identifiers'
import { PSQL } from './postgres'
import type { DbEngine } from './types'

const CLIENT: Record<DbEngine, string> = {
  mysql: 'mysql --batch',
  postgresql: `cd /tmp && ${PSQL} -q -v ON_ERROR_STOP=1`
}

export function sqlScript(engine: DbEngine, statements: string[]): string {
  return [`${CLIENT[engine]} <<'SHELLWAY_SQL'`, ...statements, 'SHELLWAY_SQL', ''].join('\n')
}

export interface SqlStepSpec {
  id: string
  label: string
  engine: DbEngine
  statements: (secret: string) => string[]
  secret?: string
  rollback?: string[]
}

export function sqlStep(spec: SqlStepSpec): ActionStep {
  return {
    id: spec.id,
    label: spec.label,
    kind: 'command',
    root: true,
    script: sqlScript(spec.engine, spec.statements(spec.secret ?? MASK)),
    display: sqlScript(spec.engine, spec.statements(MASK)),
    timeoutSeconds: 120,
    ...(spec.rollback ? { rollback: sqlScript(spec.engine, spec.rollback) } : {})
  }
}
