type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const API = 'https://api.github.com'

const headers = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Shellway',
  'Content-Type': 'application/json'
})

async function apiMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; errors?: { message?: string }[] }
    return [body.message, ...(body.errors ?? []).map((e) => e.message)].filter(Boolean).join(': ')
  } catch {
    return response.statusText
  }
}

function rejected(status: number, message: string): Error {
  if (status === 401) return new Error('GitHub rejected the saved token. Replace it in Settings, GitHub login.')
  return new Error(`GitHub: ${message || status}`)
}

export async function githubLogin(token: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const response = await fetchImpl(`${API}/user`, { method: 'GET', headers: headers(token) })
  if (!response.ok) throw rejected(response.status, await apiMessage(response))
  const { login } = (await response.json()) as { login?: unknown }
  if (typeof login !== 'string' || login === '') throw new Error('GitHub did not say which account the token belongs to')
  return login
}

export async function githubRepoExists(token: string, owner: string, name: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const response = await fetchImpl(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { method: 'GET', headers: headers(token) })
  if (response.status === 404) return false
  if (response.ok) return true
  throw rejected(response.status, await apiMessage(response))
}

export async function createGithubRepo(token: string, name: string, isPrivate: boolean, fetchImpl: FetchLike = fetch): Promise<{ sshUrl: string; httpsUrl: string }> {
  const response = await fetchImpl(`${API}/user/repos`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ name, private: isPrivate, auto_init: false })
  })
  if (response.status === 403 || response.status === 404) {
    throw new Error('The saved GitHub token cannot create repositories. Give it the repo scope, or Administration write for a fine-grained token.')
  }
  if (response.status !== 201) throw rejected(response.status, await apiMessage(response))
  const body = (await response.json()) as { ssh_url?: unknown; clone_url?: unknown }
  if (typeof body.ssh_url !== 'string' || typeof body.clone_url !== 'string') throw new Error('GitHub created the repository but did not return its address')
  return { sshUrl: body.ssh_url, httpsUrl: body.clone_url }
}
