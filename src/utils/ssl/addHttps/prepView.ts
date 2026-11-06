import type { ActionResult, InstallPlan, InstallRoute, InstallStep, PrepFacts } from '../../../types/ssl'
import type { Tone } from '../tone'
import { certbotPlugin } from '../https/installPlan'

export interface FactView {
  label: string
  value: string
  sub: string
  tone: Tone
}

export const ROUTE_LABELS: Record<InstallRoute, string> = {
  snap: "Snap (certbot's recommended way)",
  distro: 'From your distribution'
}

const WEB_SERVER_NAMES = { nginx: 'nginx', apache: 'Apache', caddy: 'Caddy' } as const

function webServerFact(facts: PrepFacts): FactView {
  if (facts.webServer === null) return { label: 'Web server', value: 'not found', sub: 'nginx or Apache needed', tone: 'error' }
  const supported = facts.webServer !== 'caddy'
  return { label: 'Web server', value: WEB_SERVER_NAMES[facts.webServer], sub: supported ? 'serves your sites' : 'manages certificates itself', tone: supported ? 'success' : 'warning' }
}

function certbotFact(facts: PrepFacts): FactView {
  const { certbot } = facts
  if (certbot === null) return { label: 'certbot', value: 'not installed', sub: 'no apt, dnf or snap copy', tone: 'error' }
  const plugin = certbotPlugin(facts)
  if (!facts.plugins.includes(plugin)) return { label: 'certbot', value: certbot.version, sub: `missing the ${plugin} plugin`, tone: 'warning' }
  return { label: 'certbot', value: certbot.version, sub: certbot.method === 'unknown' ? 'installed' : `from ${certbot.method}`, tone: 'success' }
}

export function factViews(facts: PrepFacts): FactView[] {
  return [
    { label: 'System', value: facts.os.pretty || facts.os.id || 'unknown', sub: facts.arch || 'unknown architecture', tone: facts.os.family === 'other' ? 'warning' : 'success' },
    webServerFact(facts),
    certbotFact(facts),
    facts.snapd !== null
      ? { label: 'snapd', value: 'available', sub: `snap ${facts.snapd}`, tone: 'success' }
      : { label: 'snapd', value: 'not found', sub: 'the snap route needs it', tone: 'neutral' },
    facts.fullSudo
      ? { label: 'sudo', value: 'passwordless', sub: 'Shellway can install for you', tone: 'success' }
      : { label: 'sudo', value: 'needs a password', sub: 'you run the commands by hand', tone: 'warning' }
  ]
}

export function planTag(step: InstallStep): string {
  if (step.status === 'skip') return `skipped · ${step.skipReason ?? 'not needed'}`
  return step.status === 'run' ? 'will run' : 'check'
}

export interface InstallOutcome {
  success: boolean
  message: string
}

export function installOutcome(result: ActionResult | null, error: string | null): InstallOutcome {
  if (result === null) return { success: false, message: `The install could not run${error ? `: ${error}` : ''}` }
  if (result.code === 0) return { success: true, message: 'certbot installed' }
  return { success: false, message: `The install failed (exit ${result.code})` }
}

export const manualCommands =(plan: InstallPlan): string[] =>
  plan.steps.filter((step) => step.status !== 'skip').map((step) => `sudo ${step.command}`)
