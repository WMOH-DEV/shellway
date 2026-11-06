import type { GitHubRepo } from '../../../src/utils/deploy/githubRepo'

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const ALREADY_ADDED = /key is already in use/i

async function apiMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; errors?: { message?: string }[] }
    return [body.message, ...(body.errors ?? []).map((e) => e.message)].filter(Boolean).join(': ')
  } catch {
    return response.statusText
  }
}

export async function registerDeployKey(
  token: string,
  { owner, repo }: GitHubRepo,
  title: string,
  publicKey: string,
  fetchImpl: FetchLike = fetch
): Promise<{ alreadyAdded: boolean }> {
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/keys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Shellway',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title, key: publicKey, read_only: true })
  })
  if (response.status === 201) return { alreadyAdded: false }
  const message = await apiMessage(response)
  if (response.status === 422 && ALREADY_ADDED.test(message)) return { alreadyAdded: true }
  if (response.status === 404) throw new Error(`GitHub could not find ${owner}/${repo}, or the token cannot manage its deploy keys`)
  if (response.status === 401) throw new Error('GitHub rejected the token')
  throw new Error(`GitHub: ${message || response.status}`)
}
