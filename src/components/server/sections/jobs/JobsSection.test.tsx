import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ServerFacts } from '@/types/server/core'
import { shellwayCronLine } from '@/utils/server/jobs/crontab'
import { parseCrontabs } from '@/utils/server/jobs/crontabs'
import { PM2_STDOUT } from '@/utils/server/jobs/fixtures/pm2'
import { SUPERVISOR_STDOUT } from '@/utils/server/jobs/fixtures/supervisor'
import { parsePm2 } from '@/utils/server/jobs/pm2'
import { parseSupervisor } from '@/utils/server/jobs/supervisor'
import { parseTimers } from '@/utils/server/jobs/timers'
import { parseUsers } from '@/utils/server/jobs/users'
import type { ServerSectionContext } from '../types'

const launch = vi.fn()
const navigate = vi.fn()
const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 1 })
const failed = shellwayCronLine({ id: 'nightly', expression: '0 3 * * *', command: 'backup.sh', logOutput: true })
const facts: ServerFacts = {
  'jobs.supervisor': ok(parseSupervisor(SUPERVISOR_STDOUT)),
  'jobs.pm2': ok(parsePm2(PM2_STDOUT)),
  'jobs.crontabs': ok(parseCrontabs(`@@self deploy\n@@crontab deploy abc\n${failed}\n@@end\n@@others yes\n@@last nightly shellway-exit 1 1793000000\n`)),
  'jobs.timers': ok(parseTimers('Id=certbot.timer\nDescription=Run certbot twice daily\nUnit=certbot.service\nNextElapseUSecRealtime=Sat 2026-11-07 12:13:00 UTC\nLastTriggerUSec=n/a\nActiveState=active\n')),
  'jobs.users': ok(parseUsers('@@self deploy\n@@sudo yes\n@@user root 0 /root\n@@user deploy 1000 /home/deploy\n')),
  'core.identity': ok({ timezone: 'UTC' })
}

vi.mock('../../useServerFacts', () => ({ useServerFacts: () => ({ facts, loading: false, error: null, refresh: vi.fn() }) }))
vi.mock('../../action', () => ({ useActionLauncher: () => ({ launch }) }))

import { JobsSection } from './JobsSection'

const ctx: ServerSectionContext = {
  tabId: 't',
  connectionId: 'c',
  sessionId: 's',
  sessionName: 'Test server',
  connectionStatus: 'connected',
  route: { section: 'jobs' },
  active: true,
  navigate
}

beforeEach(() => {
  launch.mockReset()
  navigate.mockReset()
  Object.assign(window, {
    novadeck: {
      deploy: { list: vi.fn().mockResolvedValue({ success: true, data: [{ config: { name: 'shop.example.com', path: '/var/www/shop', layout: 'releases' } }] }) },
      server: { jobs: { tail: vi.fn().mockResolvedValue({ success: true, data: 'line\n' }) } }
    }
  })
})

describe('JobsSection', () => {
  it('lists workers with the root cause and links to Services', async () => {
    render(<JobsSection ctx={ctx} />)
    expect(screen.getByText('Queue: default and Horizon keep failing because Redis is stopped.')).toBeInTheDocument()
    expect(await screen.findByText('shop.example.com · 2 processes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fix Redis' }))
    expect(navigate).toHaveBeenCalledWith({ section: 'services' })
  })

  it('restarts a worker through the action launcher', () => {
    render(<JobsSection ctx={ctx} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Restart' })[0])
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: 'jobs.worker-control', params: { name: 'shop-queue', op: 'restart' } }))
  })

  it('shows tasks with their last result and timers', () => {
    render(<JobsSection ctx={ctx} />)
    expect(screen.getByText(/failed \(exit 1\)/)).toBeInTheDocument()
    expect(screen.getByText('certbot.timer')).toBeInTheDocument()
  })

  it('adds a task with live validation and the next runs', () => {
    render(<JobsSection ctx={ctx} />)
    fireEvent.change(screen.getByPlaceholderText('cd /var/www/app/current && php artisan reports:daily'), { target: { value: 'cd /var/www/api/current && php artisan reports:daily' } })
    expect(screen.getByText(/^Next: .*06:30, .*06:30, .*06:30$/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'jobs.cron-save',
        params: expect.objectContaining({ user: 'deploy', ref: null, expression: '30 6 * * *', command: 'cd /var/www/api/current && php artisan reports:daily', logOutput: true })
      })
    )
  })

  it('flags an invalid custom schedule', () => {
    render(<JobsSection ctx={ctx} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('Cron expression'), { target: { value: '61 * * * *' } })
    expect(screen.getAllByText('minute must be between 0 and 59').length).toBeGreaterThan(0)
  })

  it('opens the worker drawer with the Laravel queue preset', () => {
    render(<JobsSection ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add worker' }))
    expect(screen.getByDisplayValue('php artisan queue:work --sleep=3 --tries=3 --max-time=3600')).toBeInTheDocument()
  })
})
