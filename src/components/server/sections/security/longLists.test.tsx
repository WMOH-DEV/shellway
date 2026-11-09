import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseFail2ban } from '@/utils/server/security/fail2ban'
import { parseUfw, type UfwRule } from '@/utils/server/security/ufw'
import { Fail2banCard } from './Fail2banCard'
import { FirewallCard } from './FirewallCard'
import type { SecurityActions } from './types'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../../../utils/server/security/fixtures', name), 'utf8')
const ok = <T,>(data: T) => ({ status: 'ok' as const, data, at: 0 })
const actions: SecurityActions = { canGuard: true, session: null, guard: vi.fn(), launch: vi.fn() }

const blocked = (index: number): UfwRule => ({ number: index + 1, to: 'Anywhere', action: 'reject', direction: 'in', from: `198.51.100.${index}`, comment: index === 7 ? 'scraper' : '', v6: false, raw: '' })

describe('long firewall and ignore lists', () => {
  it('shows the first rules, a search box and a way to show them all', () => {
    const ufw = { ...parseUfw(fixture('ufw-root.txt')), rules: Array.from({ length: 30 }, (_, index) => blocked(index)) }
    render(<FirewallCard result={ok(ufw)} actions={actions} />)
    expect(screen.getAllByText(/^198\.51\.100\./)).toHaveLength(8)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search firewall rules' }), { target: { value: 'scraper' } })
    expect(screen.getAllByText(/^198\.51\.100\./).map((cell) => cell.textContent)).toEqual(['198.51.100.7'])
    fireEvent.change(screen.getByRole('textbox', { name: 'Search firewall rules' }), { target: { value: '100.2' } })
    expect(screen.getAllByText(/^198\.51\.100\./)).toHaveLength(11)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search firewall rules' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show all 30 rules' }))
    expect(screen.getAllByText(/^198\.51\.100\./)).toHaveLength(30)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByText(/^198\.51\.100\./)).toHaveLength(8)
  })

  it('keeps a short firewall list as it is', () => {
    render(<FirewallCard result={ok(parseUfw(fixture('ufw-root.txt')))} actions={actions} />)
    expect(screen.queryByRole('textbox', { name: 'Search firewall rules' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('caps the never-banned list and names the jails by count', () => {
    const f2b = parseFail2ban(fixture('fail2ban-running.txt'))
    const many = { ...f2b, jails: ['sshd', 'nginx-badbots', 'nginx-http-auth', 'bad-signature'], sshd: { ...f2b.sshd!, ignoreIp: Array.from({ length: 35 }, (_, index) => `203.0.113.${index}`) } }
    render(<Fail2banCard result={ok(many)} actions={actions} />)
    expect(screen.getByText('4 jails').parentElement).toHaveAttribute('title', 'sshd, nginx-badbots, nginx-http-auth, bad-signature')
    expect(screen.getAllByText(/^203\.0\.113\./)).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 35 addresses' }))
    expect(screen.getAllByText(/^203\.0\.113\./)).toHaveLength(35)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByText(/^203\.0\.113\./)).toHaveLength(12)
  })

  it('drops a search when the list shrinks and the search box goes away', () => {
    const base = parseUfw(fixture('ufw-root.txt'))
    const many = { ...base, rules: Array.from({ length: 30 }, (_, index) => blocked(index)) }
    const { rerender } = render(<FirewallCard result={ok(many)} actions={actions} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search firewall rules' }), { target: { value: 'nothing matches this' } })
    rerender(<FirewallCard result={ok({ ...base, rules: [blocked(1), blocked(2)] })} actions={actions} />)
    expect(screen.queryByRole('textbox', { name: 'Search firewall rules' })).toBeNull()
    expect(screen.getAllByText(/^198\.51\.100\./)).toHaveLength(2)
  })
})
