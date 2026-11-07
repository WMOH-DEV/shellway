export const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export interface Block {
  tag: string
  args: string
  lines: string[]
}

const MARKER = /^@@([a-z0-9-]+)(?: (.*))?$/

export function splitBlocks(stdout: string): Block[] {
  const blocks: Block[] = []
  for (const line of stdout.replace(/\r/g, '').split('\n')) {
    const marker = MARKER.exec(line)
    if (marker) blocks.push({ tag: marker[1], args: marker[2] ?? '', lines: [] })
    else blocks.at(-1)?.lines.push(line)
  }
  return blocks
}

export const blockText = (block: Block): string => block.lines.join('\n')

export const blocksTagged = (blocks: Block[], tag: string): Block[] => blocks.filter((block) => block.tag === tag)

export const hasTag = (blocks: Block[], tag: string): boolean => blocks.some((block) => block.tag === tag)

export const firstArgs = (blocks: Block[], tag: string): string => blocks.find((block) => block.tag === tag)?.args ?? ''
