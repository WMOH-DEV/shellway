import { blocksTagged, firstArgs, splitBlocks } from './shell'
import type { ServerUser, UsersFacts } from './types'

export function parseUsers(stdout: string): UsersFacts {
  const blocks = splitBlocks(stdout)
  const users = blocksTagged(blocks, 'user').flatMap((block): ServerUser[] => {
    const [name, uid, ...home] = block.args.split(' ')
    return name && /^\d+$/.test(uid ?? '') ? [{ name, uid: Number(uid), home: home.join(' ') }] : []
  })
  return { self: firstArgs(blocks, 'self'), sudo: firstArgs(blocks, 'sudo') === 'yes', users }
}

export const hasUser = (facts: UsersFacts, name: string): boolean => facts.users.some((user) => user.name === name)

export const USERS_SCRIPT = `echo "@@self $(id -un)"
if [ "$(id -u)" -eq 0 ] || sudo -n true 2>/dev/null; then echo '@@sudo yes'; else echo '@@sudo no'; fi
getent passwd | awk -F: -v self="$(id -un)" '$1 == self || $3 == 0 || $3 == 33 || ($3 >= 1000 && $3 < 65534) { print "@@user " $1 " " $3 " " $6 }' | head -n 200
`
