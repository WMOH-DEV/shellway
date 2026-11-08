import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { MYSQL_PROBE } from '@/utils/server/databases/facts'
import { parseMysql } from '@/utils/server/databases/mysql'
import type { ServerSectionContext } from '../types'

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 1 })
const DENIED = "@@client\nmysql  Ver 15.1 Distrib 10.6.22-MariaDB, for debian-linux-gnu (x86_64)\n@@failed\nERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: NO)\n"
const facts: ServerFacts = { [MYSQL_PROBE]: ok(parseMysql(DENIED)) }

vi.mock('../../useServerFacts', () => ({ useServerFacts: () => ({ facts, loading: false, error: null, refresh: vi.fn() }) }))
vi.mock('../../action', () => ({ useActionLauncher: () => ({ launch: vi.fn() }) }))
vi.mock('../../useWithOsFamily', () => ({ useWithOsFamily: () => async (params: Record<string, unknown>) => params }))

import { DatabasesSection } from './DatabasesSection'

const ctx: ServerSectionContext = {
  tabId: 't',
  connectionId: 'c',
  sessionId: 's',
  sessionName: 'Test server',
  connectionStatus: 'connected',
  route: { section: 'databases' },
  active: true,
  navigate: vi.fn()
}

describe('DatabasesSection', () => {
  it('names MariaDB and shows how to let root in when it has a password only', () => {
    render(<DatabasesSection ctx={ctx} />)
    expect(screen.getByRole('tab', { name: 'MariaDB' })).toBeInTheDocument()
    expect(screen.getByText('Shellway cannot sign in to MariaDB')).toBeInTheDocument()
    expect(screen.getByText('[client] user=root password=your-root-password', { normalizer: (text) => text.replace(/\s+/g, ' ').trim() })).toBeInTheDocument()
    expect(screen.getByText(/IDENTIFIED VIA unix_socket OR mysql_native_password/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy /root/.my.cnf' })).toBeInTheDocument()
  })
})
