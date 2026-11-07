import { PROFILES, ROWS, ROW_VALUES, SECURITY_ITEMS } from './catalog'
import type { ProfileId, RowChoice, RowChoices, SecurityChoices, SetupParams } from './types'

type Raw = Record<string, unknown>

function asObject(value: unknown, what: string): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} must be an object`)
  return value as Raw
}

function asBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${what} must be true or false`)
  return value
}

function asProfile(value: unknown): ProfileId {
  const profile = PROFILES.find((item) => item.id === value)
  if (!profile) throw new Error(`Unknown profile: ${String(value)}`)
  return profile.id
}

function asRows(value: unknown): RowChoices {
  const raw = asObject(value, 'rows')
  const rows = ROWS.map(({ id }): [string, RowChoice] => {
    const row = asObject(raw[id], `rows.${id}`)
    const choice = row.value
    if (typeof choice !== 'string' || !ROW_VALUES[id].includes(choice)) throw new Error(`rows.${id}.value is not an offered choice`)
    return [id, { on: asBoolean(row.on, `rows.${id}.on`), value: choice }]
  })
  return Object.fromEntries(rows) as RowChoices
}

function asSecurity(value: unknown): SecurityChoices {
  const raw = asObject(value, 'security')
  return Object.fromEntries(SECURITY_ITEMS.map(({ id }) => [id, asBoolean(raw[id], `security.${id}`)])) as SecurityChoices
}

export function validateSetupParams(value: unknown): SetupParams {
  const raw = asObject(value, 'params')
  return {
    profile: asProfile(raw.profile),
    rows: asRows(raw.rows),
    security: asSecurity(raw.security),
    keyLogin: asBoolean(raw.keyLogin, 'keyLogin')
  }
}
