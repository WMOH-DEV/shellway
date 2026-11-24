import { describe, it, expect, vi } from 'vitest'
import { asSiteUser, parseSiteUsers, readSiteUsers, SITE_USERS_SCRIPT } from './siteUser'

const ok = (stdout: string) => ({ stdout, stdoutBytes: stdout.length, stderr: '', code: 0 })

describe('parseSiteUsers', () => {
  it('lists regular users and whether they already have the deploy runner', () => {
    expect(parseSiteUsers('deploy 1\nubuntu 0\n')).toEqual([{ name: 'deploy', hasRunner: true }, { name: 'ubuntu', hasRunner: false }])
  })

  it('returns null when the login is not root', () => {
    expect(parseSiteUsers('@@notroot\n')).toBeNull()
  })

  it('skips names that are not valid user names', () => {
    expect(parseSiteUsers('Bad;Name 1\ndeploy 0\n')).toEqual([{ name: 'deploy', hasRunner: false }])
  })
})

describe('readSiteUsers', () => {
  it('runs the user listing through sh', async () => {
    const exec = vi.fn(async () => ok('deploy 0\n'))
    expect(await readSiteUsers(exec)).toEqual([{ name: 'deploy', hasRunner: false }])
    expect(exec).toHaveBeenCalledWith('sh -s', expect.objectContaining({ stdin: SITE_USERS_SCRIPT }))
  })
})

describe('asSiteUser', () => {
  it('runs the command as the user from their home folder and keeps stdin', async () => {
    const exec = vi.fn(async () => ok(''))
    await asSiteUser(exec, 'deploy')('cat > "$HOME/x"', { stdin: 'data' })
    expect(exec).toHaveBeenCalledWith(`sudo -n -u deploy -H -- sh -c 'cd "$HOME" || exit 1\ncat > "$HOME/x"'`, { stdin: 'data' })
  })

  it('refuses root and names that could break the command', () => {
    const exec = vi.fn()
    expect(() => asSiteUser(exec, 'root')).toThrow(/root/)
    expect(() => asSiteUser(exec, 'deploy; rm -rf /')).toThrow()
  })
})
