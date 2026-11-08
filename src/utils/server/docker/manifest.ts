export interface ManifestCheck {
  found: boolean
  size: number | null
  platforms: number
  message: string
}

const NOT_FOUND = /no such manifest|manifest unknown|not found|does not exist/i

const sumSizes = (items: unknown): number =>
  Array.isArray(items) ? items.reduce<number>((total, item) => total + (typeof item?.size === 'number' ? item.size : 0), 0) : 0

const realPlatforms = (manifests: unknown[]): number =>
  manifests.filter((entry) => (entry as { platform?: { os?: string } })?.platform?.os !== 'unknown').length

export function parseManifest(stdout: string, stderr: string, code: number): ManifestCheck {
  if (code !== 0) {
    const message = stderr.trim().split('\n')[0] ?? ''
    if (NOT_FOUND.test(stderr)) return { found: false, size: null, platforms: 0, message: 'Tag not found' }
    throw new Error(message || 'Could not check the image')
  }
  const manifest = JSON.parse(stdout) as { manifests?: unknown[]; layers?: unknown[] }
  if (Array.isArray(manifest.manifests)) return { found: true, size: null, platforms: realPlatforms(manifest.manifests), message: 'found' }
  return { found: true, size: sumSizes(manifest.layers), platforms: 1, message: 'found' }
}
