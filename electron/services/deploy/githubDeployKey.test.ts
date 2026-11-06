import { describe, it, expect, vi } from 'vitest'
import { registerDeployKey } from './githubDeployKey'

const repo = { owner: 'acme', repo: 'example-app' }

function respond(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('registerDeployKey', () => {
  it('posts a read-only key to the repo with the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(201))
    await expect(registerDeployKey('tok', repo, 'shellway: server', 'ssh-ed25519 AAA', fetchImpl)).resolves.toEqual({ alreadyAdded: false })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/acme/example-app/keys')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ title: 'shellway: server', key: 'ssh-ed25519 AAA', read_only: true })
  })

  it('treats a key that is already on the repo as done', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(422, { message: 'Validation Failed', errors: [{ message: 'key is already in use' }] }))
    await expect(registerDeployKey('tok', repo, 't', 'k', fetchImpl)).resolves.toEqual({ alreadyAdded: true })
  })

  it.each([
    [401, /rejected the token/],
    [404, /could not find acme\/example-app/],
    [500, /GitHub: /]
  ])('explains a %i response', async (status, message) => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(status, { message: 'Boom' }))
    await expect(registerDeployKey('tok', repo, 't', 'k', fetchImpl)).rejects.toThrow(message)
  })
})
