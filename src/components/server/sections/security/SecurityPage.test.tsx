import { readFileSync } from 'fs'
import { resolve } from 'path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { parseFail2ban } from '@/utils/server/security/fail2ban'
import { parseHardening } from '@/utils/server/security/hardening'
import { parseKeys } from '@/utils/server/security/keys'
import { parseSsh } from '@/utils/server/security/ssh'
import { parseUfw } from '@/utils/server/security/ufw'
import type { GuardRun } from '@/utils/server/security/guard'
import type { ServerSectionContext } from '../types'
import { SecurityPage } from './SecurityPage'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../../../utils/server/security/fixtures', name), 'utf8')
const ok = <T,>(data: T) => ({ status: 'ok' as const, data, at: 0 })

const facts: ServerFacts = {
  'security.ufw': ok(parseUfw(fixture('ufw-root.txt'))),
  'security.ssh': ok(parseSsh(fixture('ssh-root.txt'))),
  'security.keys': ok(parseKeys(fixture('keys-root.txt'))),
  'security.fail2ban': ok(parseFail2ban(fixture('fail2ban-running.txt'))),
  'security.hardening': ok(parseHardening(fixture('hardening.txt')))
}

const ctx: ServerSectionContext = {
  tabId: 'tab-1',
  connectionId: 'conn-1',
  sessionId: 'session-1',
  sessionName: 'Test server',
  connectionStatus: 'connected',
  route: { section: 'security' },
  active: true,
  navigate: () => {}
}

function mockApi() {
  let guardListener: ((run: GuardRun) => void) | null = null
  const security = {
    session: vi.fn().mockResolvedValue({ success: true, data: { keyAuth: true, fingerprints: ['SHA256:k3Jd1111111111111111111111111111111111119fQ'], source: 'key', canVerify: true, reason: '', configPort: 22 } }),
    preview: vi.fn().mockResolvedValue({ success: true, data: { title: 'Remove firewall rule', summary: '80/tcp', commands: 'ufw --force delete 8\nufw --force delete 2', verifyPort: 22, warnings: [] } }),
    run: vi.fn().mockResolvedValue({ success: true, data: { runId: 'abcdef0123456789' } }),
    current: vi.fn().mockResolvedValue({ success: true, data: null }),
    onGuard: vi.fn((callback: (run: GuardRun) => void) => {
      guardListener = callback
      return () => {}
    })
  }
  Object.defineProperty(window, 'novadeck', {
    configurable: true,
    value: { server: { scan: vi.fn().mockResolvedValue({ success: true, data: facts }), onFacts: vi.fn(() => () => {}), security } }
  })
  return { security, emit: (run: GuardRun) => guardListener?.(run) }
}

describe('SecurityPage', () => {
  it('renders the firewall, SSH access, fail2ban and hardening from probe data', async () => {
    mockApi()
    render(<SecurityPage ctx={ctx} />)
    expect(await screen.findByText('6379/tcp')).toBeInTheDocument()
    expect(screen.getByText('SSH · protected')).toBeInTheDocument()
    expect(screen.getByText('Password login is on')).toBeInTheDocument()
    expect(screen.getByText(/deploy@laptop \(this PC\)/)).toBeInTheDocument()
    expect(screen.getByText('RSA 1024 is too short')).toBeInTheDocument()
    expect(screen.getByText('192.0.2.44')).toBeInTheDocument()
    expect(screen.getByText(/is not banned and is on the ignore list/)).toBeInTheDocument()
    expect(screen.getByText('Automatic security updates')).toBeInTheDocument()
    expect(screen.getByText('Docker ports skip the firewall')).toBeInTheDocument()
  })

  it('confirms a guarded change, then shows live progress with the undo countdown', async () => {
    const { security, emit } = mockApi()
    render(<SecurityPage ctx={ctx} />)
    const removes = await screen.findAllByRole('button', { name: 'Remove' })
    await waitFor(() => expect(removes[0]).toBeEnabled())
    fireEvent.click(removes[0])
    expect(await screen.findByText('Automatic undo after 60 seconds')).toBeInTheDocument()
    expect(security.preview).toHaveBeenCalledWith('conn-1', { kind: 'ufw.rule.remove', rules: [{ number: 2, raw: '[ 2] 80/tcp                     ALLOW IN    Anywhere' }, { number: 8, raw: '[ 8] 80/tcp (v6)                ALLOW IN    Anywhere (v6)' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Apply with automatic undo' }))
    await waitFor(() => expect(security.run).toHaveBeenCalled())
    act(() => emit({
      id: 'abcdef0123456789',
      connectionId: 'conn-1',
      kind: 'ufw.rule.remove',
      title: 'Remove firewall rule',
      startedAt: Date.now(),
      finishedAt: null,
      revertAt: Date.now() + 40_000,
      outcome: 'reverting',
      message: 'Could not log in with a new connection. The change will be undone automatically within 40 s.',
      steps: [{ id: 'verify', label: 'Log in again with a new connection', status: 'failed', detail: 'Connection refused', display: '', output: 'Connection refused' }]
    }))
    expect(await screen.findByText(/Reverting in \d+ s/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled()
  })
})
