import type { OsInfo } from '@/types/server/identity'
import { OS_FAMILY_OVERRIDES, deployUserError, type OsFamilyOverride } from '../settings/prefs'

export const DEFAULT_DEPLOY_USER = 'deploy'

export function asDeployUser(value: unknown): string {
  if (typeof value !== 'string') throw new Error('deployUser must be text')
  const problem = deployUserError(value)
  if (problem) throw new Error(problem)
  return value
}

export function asOsFamilyOverride(value: unknown): OsFamilyOverride {
  if (typeof value !== 'string' || !OS_FAMILY_OVERRIDES.includes(value as OsFamilyOverride)) throw new Error(`${String(value)} is not a valid OS family`)
  return value as OsFamilyOverride
}

export const effectiveDeployUser = (deployUser: string): string => deployUser || DEFAULT_DEPLOY_USER

export const withOsFamily = (os: OsInfo, family: OsFamilyOverride): OsInfo => (family === 'auto' ? os : { ...os, family })
