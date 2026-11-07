import { describe, it, expect } from 'vitest'
import { certbotCommand } from './commands'

describe('certbotCommand', () => {
  it('builds the exact command for each action', () => {
    expect(certbotCommand('app.example.com', 'test')).toBe('sudo -n certbot renew --no-random-sleep-on-renew --dry-run --cert-name app.example.com')
    expect(certbotCommand('app.example.com', 'renew')).toBe('sudo -n certbot renew --no-random-sleep-on-renew --cert-name app.example.com')
    expect(certbotCommand('app.example.com-0001', 'force')).toBe('sudo -n certbot renew --no-random-sleep-on-renew --force-renewal --cert-name app.example.com-0001')
  })

  it.each(['', 'a b', 'x;rm -rf /', '-flag', '$(id)'])('rejects the name %j', (name) => {
    expect(() => certbotCommand(name, 'test')).toThrow(/Invalid certificate name/)
  })
})
