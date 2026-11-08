import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ProjectCheckRequest } from '../../../src/types/createSite'
import type { ProjectPort } from './ports'
import { checkNewProject } from './projectPort'

let parent: string

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'sw-project-'))
})

afterEach(() => rmSync(parent, { recursive: true, force: true }))

const port = (exists = false, heads: string[] = []): ProjectPort => ({
  githubRepoExists: vi.fn(async () => exists),
  remoteHeads: vi.fn(async () => heads)
}) as unknown as ProjectPort

const github = (changes: Partial<ProjectCheckRequest> = {}): ProjectCheckRequest => ({
  repo: { kind: 'github', owner: 'acme', name: 'shop', private: true },
  repoUrl: 'git@github.com:acme/shop.git',
  localParent: parent,
  siteName: 'shop',
  ...changes
})

describe('checkNewProject', () => {
  it('passes a free folder and a repository name that is not taken', async () => {
    expect(await checkNewProject(port(), github())).toBeNull()
  })

  it('refuses a folder that is not there, not a full path, or already holds the project', async () => {
    expect(await checkNewProject(port(), github({ localParent: 'Projects' }))).toMatch(/full path/)
    expect(await checkNewProject(port(), github({ localParent: join(parent, 'missing') }))).toMatch(/is not a folder on this PC/)
    writeFileSync(join(parent, 'file'), '')
    expect(await checkNewProject(port(), github({ localParent: join(parent, 'file') }))).toMatch(/is not a folder on this PC/)
    mkdirSync(join(parent, 'shop'))
    expect(await checkNewProject(port(), github())).toMatch(/shop already exists on this PC/)
  })

  it('refuses a GitHub name that is taken and an empty repository that has commits', async () => {
    expect(await checkNewProject(port(true), github())).toBe('github.com/acme/shop already exists. Pick another name.')
    expect(await checkNewProject(port(false, ['main']), github({ repo: { kind: 'empty' }, repoUrl: 'git@example.com:me/shop.git' }))).toMatch(/already has commits/)
  })

  it('reports a failed lookup as the problem instead of throwing', async () => {
    const failing = { githubRepoExists: vi.fn(async () => { throw new Error('GitHub did not answer') }) } as unknown as ProjectPort
    expect(await checkNewProject(failing, github())).toBe('GitHub did not answer')
  })
})
