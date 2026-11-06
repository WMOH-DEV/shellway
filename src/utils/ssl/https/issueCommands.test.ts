import { describe, expect, it } from 'vitest'
import type { IssueRequest } from '../../../types/ssl'
import { isIssuableName, issueCommand, issueRequestError, lineageFor, stagingCommand } from './issueCommands'

const request = (overrides: Partial<IssueRequest> = {}): IssueRequest => ({
  blockId: '/etc/nginx/sites-enabled/app:1',
  names: ['app.example.com', 'www.example.com'],
  email: 'admin@example.com',
  redirect: true,
  staging: true,
  ...overrides
})

describe('issue commands', () => {
  it('builds the staging test and the real request with every name and the first name as the lineage', () => {
    expect(stagingCommand(request())).toBe(
      'sudo -n certbot certonly --nginx --dry-run --non-interactive --agree-tos -m admin@example.com --cert-name app.example.com -d app.example.com -d www.example.com'
    )
    expect(issueCommand(request())).toBe(
      'sudo -n certbot --nginx --non-interactive --agree-tos -m admin@example.com --cert-name app.example.com -d app.example.com -d www.example.com --redirect'
    )
    expect(issueCommand(request({ redirect: false }))).toMatch(/ --no-redirect$/)
    expect(lineageFor(request())).toBe('app.example.com')
  })

  it('refuses names and emails that could change the command', () => {
    expect(() => issueCommand(request({ names: ['app.example.com; rm -rf /'] }))).toThrow(/cannot get a certificate/)
    expect(() => issueCommand(request({ names: ['-d evil.example.com'] }))).toThrow()
    expect(() => stagingCommand(request({ email: 'a@example.com --staging' }))).toThrow(/valid email/)
    expect(() => stagingCommand(request({ email: "a'$(id)@example.com" }))).toThrow(/valid email/)
  })

  it('explains what is wrong with a request', () => {
    expect(issueRequestError(request({ names: [] }))).toBe('Pick at least one name')
    expect(issueRequestError(request({ names: ['*.example.com'] }))).toBe('*.example.com cannot get a certificate this way')
    expect(issueRequestError(request({ names: ['app.example.com', 'app.example.com'] }))).toBe('A name is listed twice')
    expect(issueRequestError(request({ email: 'not-an-email' }))).toBe('Enter a valid email address')
    expect(issueRequestError(request({ email: '-d@example.com' }))).toBe('Enter a valid email address')
    expect(issueRequestError(request())).toBeNull()
  })

  it('only accepts plain lowercase hostnames', () => {
    expect(['app.example.com', 'a-1.example.org', 'xn--bcher-kva.example'].every(isIssuableName)).toBe(true)
    expect(['App.example.com', 'localhost', '.example.com', 'example.com.', '_', '~^www'].some(isIssuableName)).toBe(false)
  })
})
