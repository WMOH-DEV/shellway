import { createReadStream } from 'fs'
import { rm } from 'fs/promises'
import type { SiteConfig, SiteState } from '../../../src/types/deploy'
import type { DeployService } from './DeployService'
import type { LocalGit } from './LocalGit'

async function upload(service: DeployService, site: string, file: string): Promise<void> {
  const stream = createReadStream(file)
  try {
    await service.uploadBundle(site, stream)
  } finally {
    stream.destroy()
    await rm(file, { force: true })
  }
}

async function sendMissingCommits(service: DeployService, git: LocalGit, site: SiteConfig, serverHead: string): Promise<void> {
  const bundle = await git.createBundle(site.repoUrl, site.branch, serverHead)
  await upload(service, site.name, bundle.file)
  if (bundle.full || (await service.bundleFits(site.name))) return
  const full = await git.createBundle(site.repoUrl, site.branch, '')
  await upload(service, site.name, full.file)
}

export async function deployFromPc(
  service: DeployService,
  git: LocalGit,
  site: SiteConfig,
  state: Pick<SiteState, 'mirrorHead'>,
  id: string,
  trigger: 'manual' | 'pc'
): Promise<string> {
  const head = await git.fetch(site.repoUrl, site.branch)
  const needsCode = !(await git.isAncestor(site.repoUrl, head, state.mirrorHead))
  if (needsCode) await sendMissingCommits(service, git, site, state.mirrorHead)
  const source = needsCode ? ['--uploaded-bundle'] : ['--commit', head]
  await service.startDeploy(site.name, id, [...source, '--trigger', trigger])
  return head
}
