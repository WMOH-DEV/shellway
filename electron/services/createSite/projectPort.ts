import { existsSync } from 'fs'
import { mkdir, readFile, rm, stat } from 'fs/promises'
import { isAbsolute } from 'path'
import type { ProjectCheckRequest } from '../../../src/types/createSite'
import { localProjectPath } from '../../../src/utils/createSite/scaffold'
import { registerDeployKey } from '../deploy/githubDeployKey'
import { createGithubRepo, githubLogin, githubRepoExists } from '../deploy/githubRepos'
import type { LocalGit } from '../deploy/LocalGit'
import { projectFile, readArchive, writeArchive, writeFiles } from './projectArchive'
import type { ProjectPort } from './ports'

export interface ProjectPortDeps {
  git: LocalGit
  githubToken: () => string | null
}

function requireToken(deps: ProjectPortDeps): string {
  const token = deps.githubToken()
  if (!token) throw new Error('No GitHub token is saved. Add one in Settings, GitHub login.')
  return token
}

export function createProjectPort(deps: ProjectPortDeps): ProjectPort {
  return {
    githubLogin: async () => {
      const token = deps.githubToken()
      return token ? githubLogin(token) : null
    },
    githubRepoExists: (owner, name) => githubRepoExists(requireToken(deps), owner, name),
    createGithubRepo: (name, isPrivate) => createGithubRepo(requireToken(deps), name, isPrivate),
    registerDeployKey: async (owner, name, title, publicKey) => {
      await registerDeployKey(requireToken(deps), { owner, repo: name }, title, publicKey)
    },
    remoteHeads: (url) => deps.git.remoteHeads(url),
    makeFolder: async (path) => {
      if (!isAbsolute(path)) throw new Error(`${path} is not a full path`)
      await mkdir(path)
    },
    removeFolder: (path) => rm(path, { recursive: true, force: true }),
    writeFiles: (dir, files) => writeFiles(dir, files),
    extractArchive: (dir, base64) => writeArchive(dir, readArchive(Buffer.from(base64, 'base64'))),
    readFile: async (dir, path) => {
      const file = projectFile(dir, path)
      return existsSync(file) ? readFile(file, 'utf8') : null
    },
    commit: (dir, branch, message) => deps.git.commitProject(dir, branch, message),
    push: (dir, url, branch) => deps.git.pushProject(dir, url, branch)
  }
}

async function folderProblem(parent: string, siteName: string): Promise<string | null> {
  if (!isAbsolute(parent)) return 'Choose the folder on this PC as a full path'
  const isFolder = await stat(parent).then((info) => info.isDirectory(), () => false)
  if (!isFolder) return `${parent} is not a folder on this PC`
  const target = localProjectPath(parent, siteName)
  return existsSync(target) ? `${target} already exists on this PC. Pick another folder or site name.` : null
}

async function repoProblem(port: ProjectPort, request: ProjectCheckRequest): Promise<string | null> {
  if (request.repo.kind === 'github') {
    const { owner, name } = request.repo
    return (await port.githubRepoExists(owner, name)) ? `github.com/${owner}/${name} already exists. Pick another name.` : null
  }
  const heads = await port.remoteHeads(request.repoUrl)
  return heads.length > 0 ? 'That repository already has commits. Use an empty one, or pick Use my git repository.' : null
}

export async function checkNewProject(port: ProjectPort, request: ProjectCheckRequest): Promise<string | null> {
  try {
    return (await folderProblem(request.localParent, request.siteName)) ?? (await repoProblem(port, request))
  } catch (err) {
    return (err as Error).message
  }
}
