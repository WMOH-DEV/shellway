import { DOWN_MARKER, lines, listProbeScript, parseJsonLines, splitSections, str } from './shell'
import { parseSize } from './size'
import type { DockerImage } from './types'

export const IMAGE_LIMIT = 500

export const IMAGES_SCRIPT = listProbeScript([
  `out=$($D image ls --no-trunc --format '{{json .}}' 2>/dev/null) || { echo ${DOWN_MARKER}; exit 0; }`,
  `printf '%s\\n' "$out" | head -n ${IMAGE_LIMIT}`,
  'echo "@@section used"',
  `$D ps -aq --no-trunc 2>/dev/null | xargs -r $D inspect --format '{{.Image}}' 2>/dev/null`
].join('\n'))

const isNone = (value: string): boolean => value === '' || value === '<none>'

function usageCounts(section: string | undefined): Map<string, number> {
  const counts = new Map<string, number>()
  for (const id of lines(section ?? '')) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

export function parseImages(stdout: string): DockerImage[] {
  const sections = splitSections(stdout)
  const used = usageCounts(sections.used)
  return parseJsonLines(sections.main).map((raw) => {
    const id = str(raw.ID)
    const repository = str(raw.Repository)
    const tag = str(raw.Tag)
    return {
      id,
      repository: isNone(repository) ? '' : repository,
      tag: isNone(tag) ? '' : tag,
      createdSince: str(raw.CreatedSince),
      size: parseSize(str(raw.Size)),
      dangling: isNone(repository) && isNone(tag),
      usedBy: used.get(id) ?? 0
    }
  })
}

export const imageLabel = (image: Pick<DockerImage, 'repository' | 'tag' | 'id'>): string =>
  image.repository ? [image.repository, image.tag].filter(Boolean).join(':') : image.id.replace(/^sha256:/, '').slice(0, 12)
