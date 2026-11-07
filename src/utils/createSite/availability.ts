import type { ServerTools, TemplateId } from '@/types/createSite'
import { TEMPLATES, type ToolId } from './templates'

export type AvailabilityState = 'ok' | 'installs' | 'blocked'

export interface Availability {
  state: AvailabilityState
  reason: string
}

function canInstall(tool: ToolId, tools: ServerTools): boolean {
  if (tool === 'php-fpm') return tools.php.installable.length > 0
  return tool === 'composer' || tool === 'pm2'
}

const MISSING_NAME: Record<ToolId, string> = {
  'php-fpm': 'PHP-FPM',
  composer: 'composer',
  node: 'node',
  pm2: 'pm2',
  docker: 'docker'
}

function foundName(tool: ToolId, tools: ServerTools): string | null {
  switch (tool) {
    case 'php-fpm':
      return tools.php.installed.length === 0 ? null : `PHP-FPM ${tools.php.installed.join(', ')}`
    case 'node':
      return tools.node === null ? null : `node ${tools.node}`
    default:
      return tools[tool] ? tool : null
  }
}

const joined = (names: string[]): string => names.join(' and ')

export function templateAvailability(template: TemplateId, tools: ServerTools): Availability {
  const needs = TEMPLATES[template].needs
  if (needs.length === 0) return { state: 'ok', reason: 'Nothing else needed' }
  const missing = needs.filter((tool) => foundName(tool, tools) === null)
  const blocker = missing.find((tool) => !canInstall(tool, tools))
  if (blocker !== undefined) return { state: 'blocked', reason: `${MISSING_NAME[blocker]} not installed` }
  const found = needs.flatMap((tool) => foundName(tool, tools) ?? [])
  if (missing.length === 0) return { state: 'ok', reason: `${joined(found)} found` }
  const installs = `${joined(missing.map((tool) => MISSING_NAME[tool]))} will be installed`
  return { state: 'installs', reason: found.length === 0 ? installs : `${joined(found)} found · ${installs}` }
}
