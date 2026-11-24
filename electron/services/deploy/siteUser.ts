import type { SiteUser } from '../../../src/types/deploy'
import { assertOwner, isValidOwner } from '../../../src/utils/createSite/validate'
import { shellEscape } from '../../utils/shellEscape'
import type { RemoteExec } from './DeployService'

const NOT_ROOT = '@@notroot'

export const SITE_USERS_SCRIPT = `[ "$(id -u)" = 0 ] || { echo ${NOT_ROOT}; exit 0; }
getent passwd | while IFS=: read -r name _ uid _ _ home _; do
  [ "$uid" -ge 1000 ] 2>/dev/null && [ "$uid" -lt 60000 ] || continue
  if [ -x "$home/.shellway-deploy/bin/shellway-deploy" ]; then echo "$name 1"; else echo "$name 0"; fi
done
`

export function parseSiteUsers(stdout: string): SiteUser[] | null {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines[0] === NOT_ROOT) return null
  return lines.flatMap((line) => {
    const [name, runner] = line.split(' ')
    return isValidOwner(name) ? [{ name, hasRunner: runner === '1' }] : []
  })
}

export async function readSiteUsers(exec: RemoteExec): Promise<SiteUser[] | null> {
  const result = await exec('sh -s', { stdin: SITE_USERS_SCRIPT, timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'Could not list the users on the server')
  return parseSiteUsers(result.stdout)
}

export function asSiteUser(exec: RemoteExec, user: string): RemoteExec {
  const name = assertOwner(user)
  if (name === 'root') throw new Error('A site cannot run as root')
  return (command, options) => exec(`sudo -n -u ${name} -H -- sh -c ${shellEscape(`cd "$HOME" || exit 1\n${command}`)}`, options)
}
