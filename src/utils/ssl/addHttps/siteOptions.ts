import type { ServerBlock } from '../../../types/ssl'
import { blockForSite, type SiteRef } from '../https/siteMatch'

export interface DeploySiteRef extends SiteRef {
  name: string
}

export interface SiteOption {
  id: string
  kind: 'deploy' | 'nginx'
  title: string
  detail: string
  block: ServerBlock
}

export const fileName =(path: string): string => path.split('/').pop() || path

function deployOptions(sites: DeploySiteRef[], blocks: ServerBlock[]): SiteOption[] {
  const seen = new Set<string>()
  return sites.flatMap((site) => {
    const block = blockForSite(site, blocks)
    if (!block || seen.has(block.id)) return []
    seen.add(block.id)
    return [{ id: block.id, kind: 'deploy' as const, title: site.name, detail: `${site.path} · ${fileName(block.file)}`, block }]
  })
}

function coveredByTls(block: ServerBlock, blocks: ServerBlock[]): boolean {
  const secured = new Set(blocks.filter((other) => other.tls).flatMap((other) => other.names))
  return block.names.length > 0 && block.names.every((name) => secured.has(name))
}

function nginxOption(block: ServerBlock): SiteOption {
  const detail = block.tls ? fileName(block.file) : `${fileName(block.file)} · no certificate`
  return { id: block.id, kind: 'nginx', title: block.names[0] ?? fileName(block.file), detail, block }
}

export function siteOptions(sites: DeploySiteRef[], blocks: ServerBlock[], keepBlockId: string | null): SiteOption[] {
  const deploy = deployOptions(sites, blocks)
  const taken = new Set(deploy.map((option) => option.id))
  const nginx = blocks
    .filter((block) => !taken.has(block.id) && (block.id === keepBlockId || (!block.tls && !coveredByTls(block, blocks))))
    .map(nginxOption)
  return [...deploy, ...nginx]
}
