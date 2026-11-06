export interface GitHubRepo {
  owner: string
  repo: string
}

const GITHUB_URL = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/

export function parseGitHubRepo(url: string): GitHubRepo | null {
  const match = GITHUB_URL.exec(url.trim())
  return match ? { owner: match[1], repo: match[2] } : null
}

export function githubSshUrl({ owner, repo }: GitHubRepo): string {
  return `git@github.com:${owner}/${repo}.git`
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//.test(url.trim())
}
