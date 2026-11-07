import type { ActionStep } from '@/types/server/core'
import type { OsInfo } from '@/types/server/identity'
import { fileEditStep } from '../fileEdit'
import { installRecipe, type ComponentId } from '../install'
import { SHORT, rootStep } from '../install/steps'
import { swapSizeGb } from './catalog'
import { FAIL2BAN_JAIL, SSHD_DROPIN, UNATTENDED_FILE, sudoersFile } from './inventory'
import { effectiveDeployUser } from './overrides'
import type { SecurityId, SetupFiles, SetupInventory, SetupParams } from './types'

export interface SecurityContext {
  os: OsInfo
  inventory: SetupInventory
  files: SetupFiles
  params: SetupParams
}

export interface SecurityPart {
  steps: ActionStep[]
  problems: string[]
  notes: string[]
}

const HOME = /^\/[A-Za-z0-9._/-]{0,200}$/

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/

const IGNORE_ENTRY = /^[0-9A-Za-z.:/_-]{1,253}$/

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

const steps = (list: ActionStep[], notes: string[] = []): SecurityPart => ({ steps: list, problems: [], notes })

const problem = (message: string): SecurityPart => ({ steps: [], problems: [message], notes: [] })

const note = (message: string): SecurityPart => ({ steps: [], problems: [], notes: [message] })

const isValidIp = (value: string | null): value is string => value !== null && (IPV4.test(value) || (value.includes(':') && IPV6.test(value)))

function installIfMissing(component: ComponentId, packageName: string, { os, inventory }: SecurityContext): SecurityPart {
  if (inventory.packages.includes(packageName)) return steps([])
  const recipe = installRecipe({ component }, os)
  return recipe.supported ? steps(recipe.steps) : problem(recipe.reason)
}

const merge = (...parts: SecurityPart[]): SecurityPart => ({
  steps: parts.flatMap((part) => part.steps),
  problems: parts.flatMap((part) => part.problems),
  notes: parts.flatMap((part) => part.notes)
})

const originalSha = (files: SetupFiles, path: string): string | null => files.hashes[path] ?? null

function deployUserLines(user: string, home: string): string[] {
  const source = quote(`${home}/.ssh/authorized_keys`)
  return [
    `deploy_user=${quote(user)}`,
    'if ! id -u "$deploy_user" >/dev/null 2>&1; then useradd --create-home --shell /bin/bash "$deploy_user"; fi',
    'usermod -aG sudo "$deploy_user"',
    'deploy_home=$(getent passwd "$deploy_user" | cut -d: -f6)',
    'install -d -m 700 -o "$deploy_user" -g "$(id -gn "$deploy_user")" "$deploy_home/.ssh"',
    'touch "$deploy_home/.ssh/authorized_keys"',
    `if [ -f ${source} ]; then`,
    '  while IFS= read -r key || [ -n "$key" ]; do',
    "    case \"$key\" in ''|'#'*) continue ;; esac",
    '    grep -qxF -- "$key" "$deploy_home/.ssh/authorized_keys" || printf \'%s\\n\' "$key" >> "$deploy_home/.ssh/authorized_keys"',
    `  done < ${source}`,
    'fi',
    'chown "$deploy_user":"$(id -gn "$deploy_user")" "$deploy_home/.ssh/authorized_keys"',
    'chmod 600 "$deploy_home/.ssh/authorized_keys"'
  ]
}

function deployUser({ inventory, files, params }: SecurityContext): SecurityPart {
  const user = effectiveDeployUser(params.deployUser)
  if (inventory.user === user) return note(`You are already logged in as ${user}, so no deploy user was added.`)
  if (!HOME.test(inventory.home) || inventory.home.includes('..')) return problem(`Could not read your home folder, so your SSH keys cannot be copied to ${user}.`)
  const notes = inventory.authorizedKeys === 0 ? [`${inventory.user} has no SSH keys on this server, so ${user} gets none. Add a key to ${user} before logging in as it.`] : []
  const sudoers = sudoersFile(user)
  return steps([
    rootStep('deploy-user', `Create the ${user} user and copy your SSH keys`, deployUserLines(user, inventory.home), SHORT),
    fileEditStep({
      id: 'deploy-sudoers',
      label: `Let ${user} use sudo without a password`,
      path: sudoers,
      content: `${user} ALL=(ALL) NOPASSWD:ALL\n`,
      originalSha256: originalSha(files, sudoers),
      mode: '0440',
      owner: 'root:root',
      test: `visudo -cf ${sudoers}`
    })
  ], notes)
}

export const firewallPorts = (sshPort: number): number[] => [...new Set([22, sshPort, 80, 443])]

function firewallRules(sshPort: number): ActionStep {
  return rootStep('ufw-enable', 'Allow SSH, 80 and 443, then turn the firewall on', [
    'ufw default deny incoming',
    'ufw default allow outgoing',
    ...firewallPorts(sshPort).map((port) => `ufw allow ${port}/tcp`),
    'ufw --force enable',
    'ufw status verbose'
  ], SHORT)
}

function firewall(context: SecurityContext): SecurityPart {
  const port = context.inventory.sshPort
  if (port === null) return problem('Could not read the SSH port of this connection, so the firewall cannot be turned on safely. Turn the firewall off here and set it up in Security.')
  return merge(installIfMissing('ufw', 'ufw', context), steps([firewallRules(port)]))
}

export function fail2banIgnoreList(files: SetupFiles, clientIp: string | null): string[] {
  const kept = files.fail2banIgnore.filter((entry) => IGNORE_ENTRY.test(entry))
  return [...new Set([...kept, '127.0.0.1/8', '::1', ...(isValidIp(clientIp) ? [clientIp] : [])])]
}

export function fail2banJail(context: SecurityContext): string {
  const { inventory, files, os } = context
  return [
    '[sshd]',
    'enabled = true',
    `port = ${inventory.sshPort ?? 22}`,
    ...(os.family === 'debian' ? ['backend = systemd'] : []),
    `ignoreip = ${fail2banIgnoreList(files, inventory.clientIp).join(' ')}`,
    ''
  ].join('\n')
}

function fail2ban(context: SecurityContext): SecurityPart {
  const notes = isValidIp(context.inventory.clientIp) ? [] : ['Could not read your IP address, so it was not added to the fail2ban ignore list.']
  return merge(
    installIfMissing('fail2ban', 'fail2ban', context),
    steps([fileEditStep({
      id: 'fail2ban-jail',
      label: 'Protect SSH with fail2ban and never ban your current IP',
      path: FAIL2BAN_JAIL,
      content: fail2banJail(context),
      originalSha256: originalSha(context.files, FAIL2BAN_JAIL),
      mode: '0644',
      owner: 'root:root',
      test: 'fail2ban-client -t',
      reload: 'systemctl enable fail2ban && systemctl restart fail2ban'
    })], notes)
  )
}

const DEBIAN_SECURITY_ONLY = [
  '#clear Unattended-Upgrade::Origins-Pattern;',
  'Unattended-Upgrade::Origins-Pattern {',
  '  "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";',
  '  "origin=Debian,codename=${distro_codename},label=Debian-Security";',
  '};'
]

export function unattendedConfig(os: OsInfo): string {
  return [
    'APT::Periodic::Update-Package-Lists "1";',
    'APT::Periodic::Unattended-Upgrade "1";',
    'Unattended-Upgrade::Automatic-Reboot "false";',
    ...(os.family === 'debian' ? DEBIAN_SECURITY_ONLY : []),
    ''
  ].join('\n')
}

function autoUpdates(context: SecurityContext): SecurityPart {
  return merge(
    installIfMissing('unattended-upgrades', 'unattended-upgrades', context),
    steps([fileEditStep({
      id: 'unattended-config',
      label: 'Install security updates automatically, never reboot on its own',
      path: UNATTENDED_FILE,
      content: unattendedConfig(context.os),
      originalSha256: originalSha(context.files, UNATTENDED_FILE),
      mode: '0644',
      owner: 'root:root',
      test: 'apt-config dump >/dev/null',
      verify: 'apt-config dump | grep -q \'^APT::Periodic::Unattended-Upgrade "1";\''
    })])
  )
}

export function swapLines(sizeGb: number): string[] {
  return [
    "if [ -n \"$(swapon --noheadings --show=NAME)\" ]; then echo 'Swap is already on.'; exit 0; fi",
    "if [ -e /swapfile ]; then echo '/swapfile already exists, so Shellway left it alone.' >&2; exit 1; fi",
    "trap 'swapon --show=NAME --noheadings | grep -qx /swapfile || rm -f /swapfile' EXIT",
    `fallocate -l ${sizeGb}G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=${sizeGb * 1024}`,
    'chmod 600 /swapfile',
    'mkswap /swapfile',
    'swapon /swapfile',
    "grep -qE '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab"
  ]
}

function swap({ inventory }: SecurityContext): SecurityPart {
  if (inventory.swapBytes > 0) return note('Swap is already on, so no swap file was added.')
  const size = swapSizeGb(inventory.memoryBytes)
  return steps([rootStep('swap', `Add a ${size} GB swap file`, swapLines(size), { detached: false, timeoutSeconds: 600 })])
}

const SSHD_RELOAD = 'if systemctl is-active --quiet ssh; then systemctl reload ssh; fi'

function passwordLoginOff({ params, inventory, files }: SecurityContext): SecurityPart {
  if (!params.keyLogin) return problem('Turning off SSH password login needs this connection to log in with an SSH key. Leave it on, or switch this server to a key first.')
  if (inventory.authorizedKeys === 0) return problem(`${inventory.user} has no SSH keys on this server, so turning off password login could lock you out.`)
  return steps([fileEditStep({
    id: 'ssh-password-off',
    label: 'Turn off SSH password login',
    path: SSHD_DROPIN,
    content: 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n',
    originalSha256: originalSha(files, SSHD_DROPIN),
    mode: '0644',
    owner: 'root:root',
    test: 'sshd -t',
    reload: SSHD_RELOAD,
    verify: "sshd -T | grep -qx 'passwordauthentication no'"
  })])
}

const BUILDERS: Record<SecurityId, (context: SecurityContext) => SecurityPart> = {
  deployUser,
  firewall,
  fail2ban,
  autoUpdates,
  swap,
  passwordLoginOff
}

const ORDER: readonly SecurityId[] = ['deployUser', 'firewall', 'fail2ban', 'autoUpdates', 'swap', 'passwordLoginOff']

export function securityPart(context: SecurityContext): SecurityPart {
  return merge(...ORDER.filter((id) => context.params.security[id]).map((id) => BUILDERS[id](context)))
}
