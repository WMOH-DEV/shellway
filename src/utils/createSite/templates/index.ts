import type { CreateSiteInput, TemplateId } from '@/types/createSite'
import type { PresetId } from '@/utils/deploy/presets'
import { APACHE_TEMPLATES } from './apache'
import { NGINX_TEMPLATES } from './nginx'

export type ToolId = 'php-fpm' | 'composer' | 'node' | 'pm2' | 'docker'

export interface SiteTemplate {
  id: TemplateId
  label: string
  needs: ToolId[]
  apacheModules: string[]
  proxiesToApp: boolean
  preset: PresetId
  healthPath: string
}

const PHP_MODULES = ['rewrite', 'proxy_fcgi', 'setenvif']
const PROXY_MODULES = ['proxy', 'proxy_http']

export const TEMPLATES: Record<TemplateId, SiteTemplate> = {
  laravel: { id: 'laravel', label: 'Laravel', needs: ['php-fpm', 'composer'], apacheModules: PHP_MODULES, proxiesToApp: false, preset: 'laravel', healthPath: '/' },
  node: { id: 'node', label: 'Node.js', needs: ['node', 'pm2'], apacheModules: PROXY_MODULES, proxiesToApp: true, preset: 'node', healthPath: '/' },
  static: { id: 'static', label: 'Static site', needs: [], apacheModules: [], proxiesToApp: false, preset: 'static', healthPath: '/' },
  php: { id: 'php', label: 'PHP', needs: ['php-fpm', 'composer'], apacheModules: PHP_MODULES, proxiesToApp: false, preset: 'php', healthPath: '/' },
  compose: { id: 'compose', label: 'Docker Compose', needs: ['docker'], apacheModules: PROXY_MODULES, proxiesToApp: true, preset: 'compose', healthPath: '/' },
  blank: { id: 'blank', label: 'Blank', needs: [], apacheModules: [], proxiesToApp: false, preset: 'custom', healthPath: '/' }
}

export const usesPhp = (template: SiteTemplate): boolean => template.needs.includes('php-fpm')

export function siteFileText(input: CreateSiteInput): string {
  const templates = input.server.kind === 'nginx' ? NGINX_TEMPLATES : APACHE_TEMPLATES
  return templates[input.template](input)
}
