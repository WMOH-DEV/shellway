import type { ServerTools, TemplateId } from '@/types/createSite'
import { TEMPLATES, type ToolId } from './templates'

export type AvailabilityState = 'ok' | 'installs' | 'blocked'

export interface Availability {
  state: AvailabilityState
  reason: string
}

const INSTALLABLE: ReadonlySet<ToolId> = new Set(['composer', 'pm2'])

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
      return tools.phpFpm === null ? null : `PHP ${tools.phpFpm}-fpm`
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
  const blocker = missing.find((tool) => !INSTALLABLE.has(tool))
  if (blocker !== undefined) return { state: 'blocked', reason: `${MISSING_NAME[blocker]} not installed` }
  const found = needs.flatMap((tool) => foundName(tool, tools) ?? [])
  if (missing.length === 0) return { state: 'ok', reason: `${joined(found)} found` }
  return { state: 'installs', reason: `${joined(found)} found · ${joined(missing)} will be installed` }
}
