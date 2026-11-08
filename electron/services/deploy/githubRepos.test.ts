import { describe, it, expect, vi } from 'vitest'
import { createGithubRepo, githubLogin, githubRepoExists } from './githubRepos'

function respond(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('githubLogin', () => {
  it('returns the account the token belongs to', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200, { login: 'acme' }))
    await expect(githubLogin('tok', fetchImpl)).resolves.toBe('acme')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.github.com/user')
  })

  it('says when GitHub rejects the token', async () => {
    await expect(githubLogin('tok', vi.fn().mockResolvedValue(respond(401, { message: 'Bad credentials' })))).rejects.toThrow(/rejected the saved token/)
  })
})

describe('githubRepoExists', () => {
  it('is false only for a 404', async () => {
    await expect(githubRepoExists('tok', 'acme', 'shop', vi.fn().mockResolvedValue(respond(404)))).resolves.toBe(false)
    await expect(githubRepoExists('tok', 'acme', 'shop', vi.fn().mockResolvedValue(respond(200, {})))).resolves.toBe(true)
    await expect(githubRepoExists('tok', 'acme', 'shop', vi.fn().mockResolvedValue(respond(500, { message: 'Boom' })))).rejects.toThrow('GitHub: Boom')
  })
})

describe('createGithubRepo', () => {
  it('creates an empty repository and returns both addresses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(201, { ssh_url: 'git@github.com:acme/shop.git', clone_url: 'https://github.com/acme/shop.git' }))
    await expect(createGithubRepo('tok', 'shop', true, fetchImpl)).resolves.toEqual({ sshUrl: 'git@github.com:acme/shop.git', httpsUrl: 'https://github.com/acme/shop.git' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.github.com/user/repos')
    expect(JSON.parse(init.body)).toEqual({ name: 'shop', private: true, auto_init: false })
  })

  it('explains a token that cannot create repositories', async () => {
    await expect(createGithubRepo('tok', 'shop', true, vi.fn().mockResolvedValue(respond(403, { message: 'Resource not accessible' })))).rejects.toThrow(/cannot create repositories/)
  })

  it('passes on why GitHub refused, such as a taken name', async () => {
    const taken = respond(422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] })
    await expect(createGithubRepo('tok', 'shop', true, vi.fn().mockResolvedValue(taken))).rejects.toThrow('name already exists on this account')
  })
})
