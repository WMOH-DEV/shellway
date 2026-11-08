import type { PhpTools, RepoFiles, TemplateId } from '@/types/createSite'
import { compareVersions } from './php'

export interface StackSuggestion {
  template: TemplateId | null
  reason: string
  phpMinimum: string | null
  buildScript: boolean
  outputDir: string | null
  envExample: string | null
}

interface PackageFacts {
  scripts: Record<string, unknown>
  dependencies: string[]
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']

const BUILD_OUTPUTS: [dependency: string, folder: string][] = [['vite', 'dist'], ['react-scripts', 'build']]

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

function parseJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return null
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return null
  }
}

function packageFacts(text: string | null): PackageFacts | null {
  const json = parseJson(text)
  if (json === null) return null
  return {
    scripts: asRecord(json.scripts),
    dependencies: [...Object.keys(asRecord(json.dependencies)), ...Object.keys(asRecord(json.devDependencies))]
  }
}

const hasScript = (pkg: PackageFacts | null, name: string): boolean => typeof pkg?.scripts[name] === 'string'

export function phpMinimum(composerJson: string | null): string | null {
  const constraint = asRecord(parseJson(composerJson)?.require).php
  if (typeof constraint !== 'string') return null
  return constraint.match(/(\d+)\.(\d+)/)?.slice(1, 3).join('.') ?? null
}

function frontendBuild(pkg: PackageFacts | null): { dependency: string; folder: string } | null {
  if (pkg === null || !hasScript(pkg, 'build') || hasScript(pkg, 'start')) return null
  const found = BUILD_OUTPUTS.find(([dependency]) => pkg.dependencies.includes(dependency))
  return found ? { dependency: found[0], folder: found[1] } : null
}

function pickTemplate(repo: RepoFiles, pkg: PackageFacts | null): Pick<StackSuggestion, 'template' | 'reason' | 'outputDir'> {
  const has = (name: string): boolean => repo.files.includes(name)
  if (has('artisan')) return { template: 'laravel', reason: 'It has an artisan file.', outputDir: null }
  const compose = COMPOSE_FILES.find(has)
  if (compose) return { template: 'compose', reason: `It has ${compose}.`, outputDir: null }
  const build = frontendBuild(pkg)
  if (build) return { template: 'static', reason: `It builds with ${build.dependency} and has no start script.`, outputDir: build.folder }
  if (hasScript(pkg, 'start')) return { template: 'node', reason: 'package.json has a start script.', outputDir: null }
  if (has('composer.json')) return { template: 'php', reason: 'It has composer.json.', outputDir: null }
  if (has('index.html')) return { template: 'static', reason: 'It has index.html.', outputDir: null }
  return { template: null, reason: 'None of the files Shellway looks for are there.', outputDir: null }
}

export function suggestStack(repo: RepoFiles): StackSuggestion {
  const pkg = packageFacts(repo.packageJson)
  return {
    ...pickTemplate(repo, pkg),
    phpMinimum: phpMinimum(repo.composerJson),
    buildScript: hasScript(pkg, 'build'),
    envExample: repo.envExample
  }
}

const atLeast = (version: string, minimum: string): boolean => compareVersions(version, minimum) >= 0

export function phpVersionFor(php: PhpTools, minimum: string | null): string | null {
  if (minimum === null) return null
  return php.installed.find((version) => atLeast(version, minimum)) ?? php.installable.find((version) => atLeast(version, minimum)) ?? null
}
