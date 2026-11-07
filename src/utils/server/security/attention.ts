import type { AttentionItem, ServerFacts } from '@/types/server/core'
import { FAIL2BAN_PROBE, type Fail2banFacts } from './fail2ban'
import { KEYS_PROBE, type KeysFacts } from './keys'
import { factData } from './plan'
import { SSH_PROBE, type SshFacts } from './ssh'
import { UFW_PROBE, type UfwFacts } from './ufw'

type Draft = Omit<AttentionItem, 'area' | 'route'> & { focus: string }

const item = ({ focus, ...rest }: Draft): AttentionItem => ({ ...rest, area: 'security', route: { section: 'security', params: { focus } } })

function firewallItems(ufw: UfwFacts | null): Draft[] {
  if (!ufw || ufw.active) return []
  return [{ id: 'security.ufw-off', level: 'warning', rank: 70, title: 'Firewall is off', detail: ufw.installed ? 'ufw is installed but not active.' : 'ufw is not installed.', actionLabel: ufw.installed ? 'Turn on' : 'Install', focus: 'firewall' }]
}

function sshItems(ssh: SshFacts | null, keys: KeysFacts | null): Draft[] {
  const effective = ssh?.effective
  if (!effective) return []
  const items: Draft[] = []
  if (effective.permitRootLogin === 'yes' && effective.passwordAuthentication) {
    items.push({ id: 'security.root-password', level: 'warning', rank: 75, title: 'Root can log in with a password', detail: 'PermitRootLogin yes with password login on.', actionLabel: 'Keys only', focus: 'ssh' })
  }
  const loginKeys = keys?.owners.find((owner) => owner.user === keys.loginUser)?.keys.length ?? 0
  if (effective.passwordAuthentication && loginKeys > 0) {
    items.push({ id: 'security.password-login', level: 'info', rank: 30, title: 'Password login is on', detail: 'Your keys work, so passwords are not needed.', actionLabel: 'Turn off', focus: 'ssh' })
  }
  return items
}

function keyItems(keys: KeysFacts | null): Draft[] {
  const weak = keys?.owners.flatMap((owner) => owner.keys.filter((key) => key.weak)) ?? []
  if (weak.length === 0) return []
  return [{ id: 'security.weak-keys', level: 'warning', rank: 55, title: weak.length === 1 ? '1 weak SSH key' : `${weak.length} weak SSH keys`, detail: weak.map((key) => key.weakReason).filter((reason, index, all) => all.indexOf(reason) === index).join('. '), actionLabel: 'Review', focus: 'keys' }]
}

function fail2banItems(f2b: Fail2banFacts | null): Draft[] {
  if (!f2b || f2b.installed) return []
  return [{ id: 'security.fail2ban-missing', level: 'info', rank: 25, title: 'No brute-force protection', detail: 'fail2ban is not installed.', actionLabel: 'Install', focus: 'fail2ban' }]
}

export function securityAttention(facts: ServerFacts): AttentionItem[] {
  const ufw = factData<UfwFacts>(facts, UFW_PROBE)
  const ssh = factData<SshFacts>(facts, SSH_PROBE)
  const keys = factData<KeysFacts>(facts, KEYS_PROBE)
  const f2b = factData<Fail2banFacts>(facts, FAIL2BAN_PROBE)
  return [...firewallItems(ufw), ...sshItems(ssh, keys), ...keyItems(keys), ...fail2banItems(f2b)].map(item).sort((a, b) => b.rank - a.rank)
}
