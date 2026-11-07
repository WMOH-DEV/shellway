import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ServerFacts } from '@/types/server/core'
import { NGINX_CONF } from '@/utils/server/software/fixtures/nginxConf'
import { PACKAGES_UBUNTU, PHP_OUTPUT, UPDATES_UBUNTU, USAGE } from '@/utils/server/software/fixtures/outputs'
import { parseNginx } from '@/utils/server/software/nginx'
import { parsePackages } from '@/utils/server/software/packages'
import { parsePhp } from '@/utils/server/software/php'
import { NGINX_PROBE, PACKAGES_PROBE, PHP_PROBE, UPDATES_PROBE, USAGE_PROBE } from '@/utils/server/software/types'
import { parseUpdates } from '@/utils/server/software/updates'
import { parseUsage } from '@/utils/server/software/usage'
import type { ServerSectionContext } from '../types'

const launch = vi.fn()
const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 1 })
const confOutput = `@@conf\nsha=${'c'.repeat(64)}\nb64=${Buffer.from(NGINX_CONF).toString('base64')}\n`

const baseFacts: ServerFacts = {
  [UPDATES_PROBE]: ok(parseUpdates(UPDATES_UBUNTU)),
  [PACKAGES_PROBE]: ok(parsePackages(PACKAGES_UBUNTU)),
  [PHP_PROBE]: ok(parsePhp(PHP_OUTPUT)),
  [USAGE_PROBE]: ok(parseUsage(USAGE)),
  [NGINX_PROBE]: ok(parseNginx(confOutput))
}
let facts: ServerFacts = baseFacts

vi.mock('@/components/server/useWithOsFamily', () => ({ useWithOsFamily: () => (params: Record<string, unknown>) => params }))
vi.mock('../../useServerFacts', () => ({ useServerFacts: () => ({ facts, loading: false, error: null, refresh: vi.fn() }) }))
vi.mock('../../action', () => ({ useActionLauncher: () => ({ launch }) }))

import { SoftwareSection } from './SoftwareSection'

const controls = () => within(screen.getByRole('button', { name: 'Test config' }).parentElement as HTMLElement)

const ctx = (): ServerSectionContext => ({
  tabId: 't',
  connectionId: 'c',
  sessionId: 's',
  sessionName: 'Test server',
  connectionStatus: 'connected',
  route: { section: 'software', sub: 'nginx' },
  active: true,
  navigate: vi.fn()
})

describe('NginxPanel', () => {
  beforeEach(() => {
    launch.mockReset()
    facts = baseFacts
  })

  it('shows the server controls and the settings card', () => {
    render(<SoftwareSection ctx={ctx()} />)
    expect(controls().getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(controls().getByRole('button', { name: 'Restart' })).toBeInTheDocument()
    expect(screen.getByText('nginx.conf · http')).toBeInTheDocument()
  })

  it('runs the config test through the read-only action', () => {
    render(<SoftwareSection ctx={ctx()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Test config' }))
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: 'software.nginx-test', params: {} }))
  })

  it('reloads and restarts through the Services action', () => {
    render(<SoftwareSection ctx={ctx()} />)
    fireEvent.click(controls().getByRole('button', { name: 'Reload' }))
    fireEvent.click(controls().getByRole('button', { name: 'Restart' }))
    expect(launch).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'services.control', params: { kind: 'systemd', name: 'nginx', verb: 'reload', user: null } }))
    expect(launch).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'services.control', params: { kind: 'systemd', name: 'nginx', verb: 'restart', user: null } }))
  })

  it('applies only the changed settings', () => {
    render(<SoftwareSection ctx={ctx()} />)
    fireEvent.change(screen.getByDisplayValue('65'), { target: { value: '30s' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: 'software.nginx-settings', params: { values: { keepalive_timeout: '30s' } } }))
  })

  it('does not apply an invalid value', () => {
    render(<SoftwareSection ctx={ctx()} />)
    fireEvent.change(screen.getByDisplayValue('65'), { target: { value: 'soon' } })
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('shows a setting defined in an included file as read-only with its file', () => {
    facts = { ...baseFacts, [NGINX_PROBE]: ok(parseNginx(`${confOutput}@@included\n/etc/nginx/conf.d/uploads.conf|client_max_body_size|100M\n`)) }
    render(<SoftwareSection ctx={ctx()} />)
    expect(screen.queryByText('client_max_body_size', { selector: 'label span' })).not.toBeInTheDocument()
    expect(screen.getByText('/etc/nginx/conf.d/uploads.conf')).toBeInTheDocument()
    expect(screen.getByText('client_max_body_size 100M')).toBeInTheDocument()
    expect(screen.getByDisplayValue('65')).toBeInTheDocument()
  })

  it('hides the settings card when nginx.conf could not be read', () => {
    facts = { ...baseFacts, [NGINX_PROBE]: ok(parseNginx('@@none\n')) }
    render(<SoftwareSection ctx={ctx()} />)
    expect(screen.queryByText('nginx.conf · http')).not.toBeInTheDocument()
  })
})
