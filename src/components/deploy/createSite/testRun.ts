import { vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import type { CreateSiteContext, CreateSiteOutput, CreatedResources, NameCheck, RunRecord, RunStep } from '@/types/createSite'
import { allTools, baseInput } from '@/utils/createSite/testFixtures'

export const NO_RESOURCES: CreatedResources = { folder: null, siteFile: null, phpPool: null, database: null, envFile: null, jobs: null, modulesEnabled: [], dnsRecords: [], httpsSiteFile: null, certificate: null, deploySite: null }

export const runStep = (id: RunStep['id'], status: RunStep['status'], startedAt: number | null = null, finishedAt: number | null = null): RunStep => ({ id, status, startedAt, finishedAt })

export const SITE_SHA = 'a'.repeat(64)

export const makeRun = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: 'run-1',
  sessionId: 'session-1',
  domain: 'shop.example.com',
  createdAt: 1_800_000_000_000,
  server: { kind: 'nginx' },
  input: baseInput(),
  steps: [
    runStep('folder', 'done', 1_800_000_000_000, 1_800_000_001_000),
    runStep('site', 'failed', 1_800_000_001_000, 1_800_000_004_000),
    runStep('dns', 'pending'),
    runStep('https', 'pending'),
    runStep('deploys', 'pending'),
    runStep('first-deploy', 'pending')
  ],
  created: NO_RESOURCES,
  phase: 'failed',
  current: 'site',
  error: 'nginx -t failed: unknown directive',
  deployKey: null,
  ...overrides
})

export const makeContext = (overrides: Partial<CreateSiteContext> = {}): CreateSiteContext => ({
  server: { kind: 'nginx' },
  tools: allTools(),
  serverIp: '203.0.113.10',
  owner: 'deploy',
  fullSudo: true,
  zones: [{ id: 'zone-1', name: 'example.com' }],
  dnsEdit: true,
  deploySiteNames: [],
  ...overrides
})

export const FREE_NAME: NameCheck = { zone: { id: 'zone-1', name: 'example.com' }, records: [], servedBy: null }

export interface FakeBackend {
  api: Record<string, ReturnType<typeof vi.fn>>
  emitUpdate: (record: RunRecord) => void
  emitOutput: (output: CreateSiteOutput) => void
}

export function fakeBackend(overrides: Record<string, unknown> = {}): FakeBackend {
  let onUpdate: (record: RunRecord) => void = () => undefined
  let onOutput: (output: CreateSiteOutput) => void = () => undefined
  const api = {
    'createSite.context': vi.fn().mockResolvedValue({ success: true, data: makeContext() }),
    'createSite.checkName': vi.fn().mockResolvedValue({ success: true, data: FREE_NAME }),
    'createSite.start': vi.fn().mockResolvedValue({ success: true, data: makeRun({ phase: 'running', steps: [runStep('folder', 'pending', 1_800_000_000_000)], current: 'folder', error: null }) }),
    'createSite.resume': vi.fn().mockResolvedValue({ success: true, data: makeRun({ phase: 'running', error: null }) }),
    'createSite.stop': vi.fn().mockResolvedValue({ success: true }),
    'createSite.remove': vi.fn().mockResolvedValue({ success: true, data: makeRun({ phase: 'removing', error: null }) }),
    'createSite.onUpdate': vi.fn((callback: (record: RunRecord) => void) => {
      onUpdate = callback
      return vi.fn()
    }),
    'createSite.onOutput': vi.fn((callback: (output: CreateSiteOutput) => void) => {
      onOutput = callback
      return vi.fn()
    }),
    'ssl.httpsEmail': vi.fn().mockResolvedValue({ success: true, data: 'admin@example.com' }),
    ...overrides
  } as Record<string, ReturnType<typeof vi.fn>>
  mockNovadeck(api)
  return { api, emitUpdate: (record) => onUpdate(record), emitOutput: (output) => onOutput(output) }
}
