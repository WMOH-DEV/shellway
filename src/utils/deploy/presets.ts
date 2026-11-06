import type { DeployLayout, DeployStep, DetectResult, SiteConfig } from '@/types/deploy'

export type PresetId = 'laravel' | 'php' | 'node' | 'static' | 'compose' | 'custom'

export interface Preset {
  id: PresetId
  label: string
  sharedPaths: string[]
  layout: DeployLayout
  buildSteps: (hints: Pick<DetectResult, 'buildScript'>) => DeployStep[]
  activateSteps: DeployStep[]
}

const required = (command: string): DeployStep => ({ command, optional: false })
const optional = (command: string): DeployStep => ({ command, optional: true })

const COMPOSER_INSTALL = required('composer install --no-dev --optimize-autoloader --no-interaction')
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']

export const PRESETS: Preset[] = [
  {
    id: 'laravel',
    label: 'Laravel',
    sharedPaths: ['.env', 'storage'],
    layout: 'releases',
    buildSteps: () => [COMPOSER_INSTALL],
    activateSteps: [
      required('php artisan migrate --force'),
      required('php artisan config:cache'),
      optional('php artisan route:cache'),
      optional('php artisan view:cache'),
      optional('php artisan queue:restart')
    ]
  },
  {
    id: 'php',
    label: 'PHP',
    sharedPaths: ['.env'],
    layout: 'releases',
    buildSteps: () => [COMPOSER_INSTALL],
    activateSteps: []
  },
  {
    id: 'node',
    label: 'Node.js',
    sharedPaths: ['.env'],
    layout: 'releases',
    buildSteps: ({ buildScript }) => [required('npm ci'), ...(buildScript ? [required('npm run build')] : [])],
    activateSteps: []
  },
  {
    id: 'static',
    label: 'Static site',
    sharedPaths: [],
    layout: 'releases',
    buildSteps: () => [],
    activateSteps: []
  },
  {
    id: 'compose',
    label: 'Docker Compose',
    sharedPaths: ['.env'],
    layout: 'inplace',
    buildSteps: () => [],
    activateSteps: [optional('docker compose pull'), required('docker compose up -d --build')]
  },
  {
    id: 'custom',
    label: 'Custom',
    sharedPaths: [],
    layout: 'releases',
    buildSteps: () => [],
    activateSteps: []
  }
]

export function presetById(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1]
}

export function suggestPreset(files: string[]): PresetId {
  const has = (name: string) => files.includes(name)
  if (has('artisan')) return 'laravel'
  if (COMPOSE_FILES.some(has)) return 'compose'
  if (has('composer.json')) return 'php'
  if (has('package.json')) return 'node'
  if (has('index.html')) return 'static'
  return 'custom'
}

export function siteNameFromPath(path: string): string {
  const last = path.replace(/\/+$/, '').split('/').pop() ?? ''
  return last.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

export function newSite(path = ''): SiteConfig {
  return {
    name: siteNameFromPath(path),
    path,
    repoUrl: '',
    branch: 'main',
    sourceMode: 'auto',
    layout: 'releases',
    sharedPaths: [],
    envFile: '.env',
    healthUrl: '',
    healthStatus: 200,
    autoRevert: true,
    keepReleases: 5,
    pollMinutes: 1,
    approveMigrations: false,
    migrationsPath: 'database/migrations',
    pcAuto: false,
    buildSteps: [],
    activateSteps: []
  }
}

export function applyPreset(site: SiteConfig, id: PresetId, hints: Pick<DetectResult, 'buildScript'>): SiteConfig {
  const preset = presetById(id)
  return {
    ...site,
    layout: preset.layout,
    sharedPaths: [...preset.sharedPaths],
    buildSteps: preset.buildSteps(hints),
    activateSteps: preset.activateSteps.map((s) => ({ ...s }))
  }
}
