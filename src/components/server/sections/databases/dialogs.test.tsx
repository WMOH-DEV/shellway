import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EngineFacts, SiteEnv } from '@/utils/server/databases/types'
import { CreateDatabaseDialog } from './CreateDatabaseDialog'
import { generatePassword } from '@/utils/server/databases/password'
import { TypedConfirmDialog } from './TypedConfirmDialog'

const PASSWORD = 'Abcdefghijkmnopqrstuvwx2'

const mysql: EngineFacts = {
  engine: 'mysql',
  status: 'ok',
  reason: '',
  flavor: 'mysql',
  version: '8.0.39',
  listen: ['127.0.0.1:3306'],
  databases: [{ name: 'shop_prod', sizeBytes: 1, tables: 1, owner: null, system: false }],
  users: [{ name: 'shop', host: 'localhost', grants: [], socketLogin: false, superuser: false }]
}

const site: SiteEnv = {
  site: 'admin-example',
  path: '/var/www/admin/.env',
  readable: true,
  owner: 'deploy:deploy',
  mode: '640',
  sha256: 'x',
  content: '',
  db: { connection: '', database: '', username: '' }
}

const input = (placeholder: string) => screen.getByPlaceholderText(placeholder)

describe('generatePassword', () => {
  it('makes 24 unambiguous letters and digits with one underscore, different each time', () => {
    const first = generatePassword()
    expect(first).toMatch(/^(?=[^_]*_[^_]*$)[A-HJ-NP-Za-km-z2-9_]{24}$/)
    expect(generatePassword()).not.toBe(first)
  })
})

describe('CreateDatabaseDialog', () => {
  it('fills names from the site, masks the password in the SQL and submits the site', () => {
    const onSubmit = vi.fn()
    render(<CreateDatabaseDialog data={mysql} sites={[site]} password={PASSWORD} onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: /For site/ }))
    fireEvent.click(screen.getByRole('option', { name: 'admin-example' }))
    expect(input('shop_prod')).toHaveValue('admin_example_prod')
    expect(screen.getByText(/CREATE USER 'admin_example'@'localhost' IDENTIFIED BY '••••';/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onSubmit).toHaveBeenCalledWith({ engine: 'mysql', name: 'admin_example_prod', user: 'admin_example', host: 'localhost', password: PASSWORD, site: 'admin-example' })
  })

  it('reuses an existing user without a password and blocks a taken name', () => {
    const onSubmit = vi.fn()
    render(<CreateDatabaseDialog data={mysql} sites={[]} password={PASSWORD} onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.change(input('shop_prod'), { target: { value: 'shop_prod' } })
    expect(screen.getByText('shop_prod already exists.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    fireEvent.change(input('shop_prod'), { target: { value: 'shop_staging' } })
    fireEvent.change(input('shop'), { target: { value: 'shop' } })
    expect(screen.queryByLabelText('Copy password')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'shop_staging', user: 'shop', password: undefined }))
  })
})

describe('TypedConfirmDialog', () => {
  it('only enables the button when the exact name is typed', () => {
    const onConfirm = vi.fn()
    render(
      <TypedConfirmDialog title="Drop shop_prod" name="shop_prod" confirmLabel="Drop database" onClose={vi.fn()} onConfirm={onConfirm}>
        <p>Deletes everything.</p>
      </TypedConfirmDialog>
    )
    const button = screen.getByRole('button', { name: 'Drop database' })
    fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: 'shop_pro' } })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: 'shop_prod' } })
    fireEvent.click(button)
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
