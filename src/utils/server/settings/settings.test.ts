import { describe, expect, it } from 'vitest'
import { notifyPayload, notifyUrlError, parseNotifications } from './notifications'
import { deployUserError, parseServerPrefs } from './prefs'

describe('notifyUrlError', () => {
  it.each([
    'https://hooks.slack.com/services/T000/B000/XXXX',
    'https://discord.com/api/webhooks/1/abc',
    'http://localhost:8080/hook',
    'http://127.0.0.1/hook',
    'http://[::1]:9000/hook'
  ])('accepts %s', (url) => {
    expect(notifyUrlError(url)).toBeNull()
  })

  it.each([
    ['', 'Enter the address to send to'],
    ['not a url', 'That is not a valid address'],
    ['http://example.com/hook', 'The address must start with https://'],
    ['ftp://example.com/hook', 'The address must start with https://'],
    ['https://user:secret@example.com/hook', 'Remove the user name and password from the address'],
    [`https://example.com/${'a'.repeat(2100)}`, 'That address is too long']
  ])('rejects %j', (url, message) => {
    expect(notifyUrlError(url)).toBe(message)
  })
})

describe('parseNotifications', () => {
  it('accepts valid settings and drops duplicate events', () => {
    expect(parseNotifications({ kind: 'slack', url: 'https://hooks.slack.com/x', events: ['deploy-failed', 'deploy-failed'] }))
      .toEqual({ kind: 'slack', url: 'https://hooks.slack.com/x', events: ['deploy-failed'] })
  })

  it('does not require an address when notifications are off', () => {
    expect(parseNotifications({ kind: 'off', url: '', events: [] }).kind).toBe('off')
  })

  it.each([
    [null, 'Invalid notification settings'],
    [{ kind: 'email', url: '', events: [] }, 'Invalid notification kind'],
    [{ kind: 'webhook', url: 5, events: [] }, 'Invalid notification address'],
    [{ kind: 'webhook', url: 'https://example.com', events: ['disk-full'] }, 'Invalid notification events'],
    [{ kind: 'webhook', url: 'http://example.com', events: [] }, 'The address must start with https://']
  ])('rejects %j', (raw, message) => {
    expect(() => parseNotifications(raw)).toThrow(message)
  })
})

describe('notifyPayload', () => {
  it('shapes the body for each kind', () => {
    expect(notifyPayload('slack', 'hi', 'test')).toEqual({ text: 'hi' })
    expect(notifyPayload('discord', 'hi', 'test')).toEqual({ content: 'hi' })
    expect(notifyPayload('webhook', 'hi', 'deploy-failed')).toEqual({ source: 'shellway', event: 'deploy-failed', text: 'hi' })
  })
})

describe('server prefs', () => {
  it.each(['', 'deploy', 'www-data', '_svc1'])('accepts the deploy user %j', (user) => {
    expect(deployUserError(user)).toBeNull()
  })

  it.each(['Deploy', 'root;rm', '1user', 'a'.repeat(33), 'de ploy'])('rejects the deploy user %j', (user) => {
    expect(deployUserError(user)).not.toBeNull()
  })

  it('parses valid prefs', () => {
    expect(parseServerPrefs({ deployUser: 'deploy', osFamily: 'debian', extra: true })).toEqual({ deployUser: 'deploy', osFamily: 'debian' })
  })

  it.each([
    [null, 'Invalid server settings'],
    [{ deployUser: 'Bad User', osFamily: 'auto' }, 'Invalid deploy user'],
    [{ deployUser: 'deploy', osFamily: 'arch' }, 'Invalid OS family']
  ])('rejects %j', (raw, message) => {
    expect(() => parseServerPrefs(raw)).toThrow(message)
  })
})
