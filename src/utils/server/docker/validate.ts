const COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*'
const DOMAIN = '(?:[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*(?::[0-9]{1,5})?/)?'
const IMAGE = new RegExp(`^${DOMAIN}${COMPONENT}(?:/${COMPONENT})*$`)
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
const DIGEST = /^sha256:[a-f0-9]{64}$/
const CONTAINER_REF = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/
const VOLUME_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/
const PATH = /^\/[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*\/?$/
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

export const MAX_ENV_VALUE = 4096

export function fail(message: string): never {
  throw new Error(message)
}

export const asObject = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : fail('Invalid parameters')

export const asString = (value: unknown, field: string): string => (typeof value === 'string' ? value.trim() : fail(`${field} is required`))

export const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T =>
  allowed.find((candidate) => candidate === value) ?? fail(`${field} must be one of: ${allowed.join(', ')}`)

export const matches = (value: string, pattern: RegExp, message: string): string => (pattern.test(value) ? value : fail(message))

export const isImageName = (value: string): boolean => value.length <= 255 && IMAGE.test(value)

export const isTag = (value: string): boolean => TAG.test(value)

export const containerRef = (value: unknown): string => matches(asString(value, 'Container'), CONTAINER_REF, 'Invalid container name')

export const projectName = (value: unknown): string => matches(asString(value, 'Project'), PROJECT, 'Invalid compose project name')

export const stackName = (value: unknown): string =>
  matches(asString(value, 'Name'), PROJECT, 'Name: use lowercase letters, numbers, dashes or underscores (start with a letter or number)')

export function imageReference(value: unknown): string {
  const text = asString(value, 'Image')
  if (DIGEST.test(text)) return text
  const [name, tag, extra] = splitReference(text)
  if (extra !== undefined || !isImageName(name) || (tag !== undefined && !isTag(tag))) fail('Invalid image reference')
  return text
}

export function splitReference(text: string): [string, string | undefined, string | undefined] {
  const slash = text.lastIndexOf('/')
  const colon = text.lastIndexOf(':')
  if (colon <= slash) return [text, undefined, undefined]
  const rest = text.slice(colon + 1).split(':')
  return [text.slice(0, colon), rest[0], rest[1]]
}

export const isHostPath = (value: string): boolean => PATH.test(value) && !value.split('/').some((part) => part === '..' || part === '.')

export const isVolumeName = (value: string): boolean => VOLUME_NAME.test(value)

export const isEnvKey = (value: string): boolean => ENV_KEY.test(value)

export const isPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
