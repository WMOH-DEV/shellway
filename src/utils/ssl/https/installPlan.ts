import type { InstallPlan, InstallRoute, InstallStep, PrepFacts } from '../../../types/ssl'

type Plugin = 'nginx' | 'apache'

const SNAP_ARCHES = new Set(['x86_64', 'amd64', 'aarch64', 'arm64', 'armv7l', 'armhf'])
const EPEL_DISTROS = new Set(['rocky', 'almalinux', 'centos', 'ol'])
const ROUTE_ORDER: InstallRoute[] = ['snap', 'distro']

interface DistroSetup {
  prepare: InstallStep[]
  install: string
  enableTimer: string | null
  timer: string
}

const run = (id: string, command: string, why: string): InstallStep => ({ id, command, why, status: 'run', skipReason: null })
const skip = (id: string, command: string, why: string, reason: string): InstallStep => ({ id, command, why, status: 'skip', skipReason: reason })
const check = (id: string, command: string, why: string): InstallStep => ({ id, command, why, status: 'check', skipReason: null })

export function certbotPlugin(facts: PrepFacts): Plugin {
  return facts.webServer === 'apache' ? 'apache' : 'nginx'
}

export function certbotDocsUrl(facts: PrepFacts): string {
  return `https://certbot.eff.org/instructions?ws=${certbotPlugin(facts)}&os=snap`
}

export function isCertbotReady(facts: PrepFacts): boolean {
  return facts.certbot !== null && facts.plugins.includes(certbotPlugin(facts)) && facts.renewalTimer !== null
}

function distroSetup(facts: PrepFacts): DistroSetup | null {
  const plugin = certbotPlugin(facts)
  if (facts.os.family === 'debian' && facts.packageManager === 'apt') {
    return {
      prepare: [run('apt-update', 'apt-get update', 'Refreshes the package list')],
      install: `DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-${plugin}`,
      enableTimer: null,
      timer: 'certbot.timer'
    }
  }
  if (facts.os.family !== 'rhel' || facts.packageManager !== 'dnf' || facts.os.id === 'rhel') return null
  const prepare = EPEL_DISTROS.has(facts.os.id)
    ? [run('epel', 'dnf install -y epel-release', 'certbot comes from the EPEL repository on this system')]
    : []
  return {
    prepare,
    install: `dnf install -y certbot python3-certbot-${plugin}`,
    enableTimer: 'systemctl enable --now certbot-renew.timer',
    timer: 'certbot-renew.timer'
  }
}

export function availableRoutes(facts: PrepFacts): InstallRoute[] {
  if (facts.webServer === null || facts.webServer === 'caddy') return []
  return ROUTE_ORDER.filter((route) => (route === 'snap' ? facts.snapd !== null && SNAP_ARCHES.has(facts.arch) : distroSetup(facts) !== null))
}

function blockedReason(facts: PrepFacts): string {
  if (facts.webServer === 'caddy') return 'Caddy gets and renews HTTPS certificates by itself. Nothing to install.'
  if (facts.webServer === null) return 'Neither nginx nor Apache was found on this server.'
  return `Shellway has no install commands for ${facts.os.pretty || 'this system'} (${facts.arch || 'unknown architecture'}) without snapd. Follow certbot's instructions.`
}

function checkSteps(plugin: Plugin, timer: string): InstallStep[] {
  return [
    check('check-version', 'certbot --version', 'Confirms certbot runs'),
    check('check-plugin', `certbot plugins --text | grep -w ${plugin}`, `Confirms the ${plugin} plugin is there`),
    check('check-timer', `systemctl is-active ${timer}`, 'Confirms automatic renewal is scheduled')
  ]
}

function packagedRemoval(facts: PrepFacts): InstallStep {
  const method = facts.certbot?.method
  const why = 'Removed once the snap works, so the older packaged certbot cannot clash with it'
  if (method === 'apt' || method === 'dnf' || method === 'yum') return run('remove-packaged', `${method === 'apt' ? 'apt-get' : method} remove -y certbot`, why)
  return skip('remove-packaged', 'apt-get remove -y certbot', why, 'No packaged certbot found')
}

function snapSteps(facts: PrepFacts): InstallStep[] {
  const plugin = certbotPlugin(facts)
  const hasSnap = facts.certbot?.method === 'snap'
  const installWhy = `Installs certbot with the ${plugin} plugin and a renewal timer`
  return [
    hasSnap
      ? skip('install-snap', 'snap install --classic certbot', installWhy, 'Already installed from the snap')
      : run('install-snap', 'snap install --classic certbot', installWhy),
    run('link', 'ln -sf /snap/bin/certbot /usr/local/bin/certbot', 'So certbot works from any shell'),
    packagedRemoval(facts),
    ...checkSteps(plugin, 'snap.certbot.renew.timer')
  ]
}

function distroSteps(facts: PrepFacts, setup: DistroSetup): InstallStep[] {
  const plugin = certbotPlugin(facts)
  const installed = facts.certbot !== null && facts.certbot.method === facts.packageManager && facts.plugins.includes(plugin)
  const installWhy = `Installs certbot and its ${plugin} plugin from your distribution`
  const steps = installed
    ? [skip('install-packages', setup.install, installWhy, 'Already installed')]
    : [...setup.prepare, run('install-packages', setup.install, installWhy)]
  if (setup.enableTimer) steps.push(run('enable-timer', setup.enableTimer, 'Turns on automatic renewal'))
  return [...steps, ...checkSteps(plugin, setup.timer)]
}

export function installPlan(facts: PrepFacts, preferred: InstallRoute = 'snap'): InstallPlan {
  const routes = availableRoutes(facts)
  const route = routes.includes(preferred) ? preferred : routes[0] ?? preferred
  const base = { route, routes, needed: !isCertbotReady(facts), docsUrl: certbotDocsUrl(facts) }
  if (routes.length === 0) return { ...base, steps: [], blockedReason: blockedReason(facts) }
  const setup = distroSetup(facts)
  const steps = route === 'distro' && setup ? distroSteps(facts, setup) : snapSteps(facts)
  return { ...base, steps, blockedReason: null }
}

export function installScript(plan: InstallPlan): string {
  const commands = plan.steps.filter((step) => step.status !== 'skip').map((step) => step.command)
  return ['set -e', ...commands].join('\n') + '\n'
}
