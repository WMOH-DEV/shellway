import type { IssueRequest } from '../../../types/ssl'

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const EMAIL = /^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,63}$/
const MAX_NAMES = 100

export const isIssuableName = (name: string): boolean => HOSTNAME.test(name)

export const isValidEmail = (email: string): boolean => email.length <= 254 && EMAIL.test(email)

export function issueRequestError(request: IssueRequest): string | null {
  if (request.names.length === 0) return 'Pick at least one name'
  if (request.names.length > MAX_NAMES) return `At most ${MAX_NAMES} names per certificate`
  const bad = request.names.find((name) => !isIssuableName(name))
  if (bad !== undefined) return `${bad} cannot get a certificate this way`
  if (new Set(request.names).size !== request.names.length) return 'A name is listed twice'
  if (!isValidEmail(request.email)) return 'Enter a valid email address'
  return null
}

function assertValid(request: IssueRequest): void {
  const error = issueRequestError(request)
  if (error) throw new Error(error)
}

export const lineageFor = (request: IssueRequest): string => request.names[0]

function sharedFlags(request: IssueRequest): string {
  const domains = request.names.map((name) => `-d ${name}`).join(' ')
  return `--non-interactive --agree-tos -m ${request.email} --cert-name ${lineageFor(request)} ${domains}`
}

export function stagingCommand(request: IssueRequest): string {
  assertValid(request)
  return `sudo -n certbot certonly --nginx --dry-run ${sharedFlags(request)}`
}

export function issueCommand(request: IssueRequest): string {
  assertValid(request)
  return `sudo -n certbot --nginx ${sharedFlags(request)} ${request.redirect ? '--redirect' : '--no-redirect'}`
}
