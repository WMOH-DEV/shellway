export type RawParams = Record<string, unknown>

export function asParams(raw: unknown): RawParams {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid parameters')
  return raw as RawParams
}

export function pick<T extends string>(params: RawParams, key: string, allowed: readonly T[]): T {
  const value = params[key]
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Invalid ${key}`)
  return value as T
}

export function matching(params: RawParams, key: string, pattern: RegExp): string {
  const value = params[key]
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`Invalid ${key}`)
  return value
}

export function optionalMatching(params: RawParams, key: string, pattern: RegExp): string | undefined {
  const value = params[key]
  if (value === undefined || value === null || value === '') return undefined
  return matching(params, key, pattern)
}

export function flag(params: RawParams, key: string): boolean {
  const value = params[key]
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new Error(`Invalid ${key}`)
  return value
}

export function integer(params: RawParams, key: string, min: number, max: number): number {
  const value = params[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`)
  return value
}

export function confirmed(params: RawParams, expected: string): void {
  if (params.confirm !== expected) throw new Error(`Type ${expected} to confirm`)
}
