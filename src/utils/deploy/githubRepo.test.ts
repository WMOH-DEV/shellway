import { describe, it, expect } from 'vitest'
import { githubSshUrl, isHttpUrl, parseGitHubRepo } from './githubRepo'

describe('parseGitHubRepo', () => {
  it.each([
    ['git@github.com:owner/my-repo.git', 'owner', 'my-repo'],
    ['git@github.com:owner/my.repo', 'owner', 'my.repo'],
    ['ssh://git@github.com/owner/repo.git', 'owner', 'repo'],
    ['https://github.com/owner/repo', 'owner', 'repo'],
    ['https://token@github.com/owner/repo.git', 'owner', 'repo'],
    ['https://github.com/owner/repo/', 'owner', 'repo']
  ])('reads %s', (url, owner, repo) => {
    expect(parseGitHubRepo(url)).toEqual({ owner, repo })
  })

  it.each(['git@gitlab.com:owner/repo.git', 'https://github.com/owner', 'https://evilgithub.com/o/r', ''])('ignores %s', (url) => {
    expect(parseGitHubRepo(url)).toBeNull()
  })

  it('builds the ssh form used by deploy keys', () => {
    expect(githubSshUrl({ owner: 'o', repo: 'r' })).toBe('git@github.com:o/r.git')
    expect(isHttpUrl('https://github.com/o/r')).toBe(true)
    expect(isHttpUrl('git@github.com:o/r.git')).toBe(false)
  })
})
