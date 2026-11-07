export function validateNoParams(raw: unknown): Record<string, never> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) return {}
  throw new Error('This action takes no options')
}
