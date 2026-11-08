import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PlanAction } from '@/types/createSite'
import { buildPlan } from '@/utils/createSite/plan'
import { APACHE_DEBIAN, NGINX, allTools, baseInput, type ServerCase } from '@/utils/createSite/testFixtures'
import { ReviewStep } from './ReviewStep'

const planFor = (c: ServerCase, tools = allTools()): PlanAction[] => buildPlan(baseInput({ server: c.server }), tools, c.driver)

function renderReview(plan: PlanAction[] | string, fullSudo = true) {
  const onEdit = vi.fn()
  render(<ReviewStep plan={plan} fullSudo={fullSudo} onEdit={onEdit} />)
  return { onEdit, user: userEvent.setup() }
}

const cardTitles = (): (string | null)[] =>
  within(screen.getByRole('list', { name: 'Plan' })).getAllByRole('region').map((card) => card.getAttribute('aria-label'))

describe('ReviewStep', () => {
  it('renders one card per nginx plan action, in run order', () => {
    const plan = planFor(NGINX)
    renderReview(plan)
    expect(cardTitles()).toEqual(['Folder', 'PHP pool', 'nginx site', 'Database', 'DNS record', 'HTTPS', 'Deploys', 'Environment file', 'First deploy and check'])
    expect(cardTitles()).toEqual(plan.map((action) => action.title))
    expect(screen.getByText('9 steps, in this order. Open any step to see exactly what runs.')).toBeInTheDocument()
    expect(screen.getByText('1 step needs you')).toBeInTheDocument()
  })

  it('adds the Apache modules card when a module is missing', () => {
    renderReview(planFor(APACHE_DEBIAN, allTools({ apacheModules: ['headers', 'ssl'] })))
    expect(cardTitles()).toEqual(['Folder', 'PHP pool', 'Apache modules', 'Apache site', 'Database', 'DNS record', 'HTTPS', 'Deploys', 'Environment file', 'First deploy and check'])
    const modules = screen.getByRole('region', { name: 'Apache modules' })
    expect(within(modules).getByText('3 to enable')).toBeInTheDocument()
  })

  it('leaves the modules card out when Apache has every module', () => {
    renderReview(planFor(APACHE_DEBIAN))
    expect(cardTitles()).toEqual(['Folder', 'PHP pool', 'Apache site', 'Database', 'DNS record', 'HTTPS', 'Deploys', 'Environment file', 'First deploy and check'])
  })

  it('shows the exact config and commands when a card is opened', async () => {
    const plan = planFor(NGINX)
    const { user } = renderReview(plan)
    const site = screen.getByRole('region', { name: 'nginx site' })
    expect(within(site).queryByLabelText('Config')).not.toBeInTheDocument()
    await user.click(within(site).getByRole('button', { name: 'Show details' }))
    expect(within(site).getByLabelText('Config').textContent).toBe(plan[2].config)
    expect(within(site).getByLabelText('Commands')).toHaveTextContent('$ sudo -n sh -s')
  })

  it('sends Edit back to the step that owns the card', async () => {
    const { user, onEdit } = renderReview(planFor(NGINX))
    await user.click(within(screen.getByRole('region', { name: 'DNS record' })).getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledWith('domain')
  })

  it('warns that root steps are run by hand without full sudo', () => {
    renderReview(planFor(NGINX), false)
    expect(screen.getByText(/need to be run by hand/)).toBeInTheDocument()
  })

  it('shows the plan problem instead of cards', () => {
    renderReview('"bad name" is not a valid site name')
    expect(screen.getByRole('alert')).toHaveTextContent('is not a valid site name')
    expect(screen.queryByRole('list', { name: 'Plan' })).not.toBeInTheDocument()
  })
})
