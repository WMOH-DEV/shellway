export interface OutputSection {
  marker: string
  arg: string
  lines: string[]
}

const MARKER = /^@@([a-z0-9-]+)(?: (.*))?$/

export function splitSections(stdout: string): OutputSection[] {
  const sections: OutputSection[] = []
  for (const line of stdout.split('\n')) {
    const match = MARKER.exec(line.trimEnd())
    if (match) sections.push({ marker: match[1], arg: match[2] ?? '', lines: [] })
    else if (sections.length > 0) sections[sections.length - 1].lines.push(line.replace(/\r$/, ''))
  }
  return sections
}

export function sectionLines(sections: OutputSection[], marker: string): string[] {
  return sections.filter((section) => section.marker === marker).flatMap((section) => section.lines).filter((line) => line.trim() !== '')
}

export const hasMarker = (sections: OutputSection[], marker: string): boolean => sections.some((section) => section.marker === marker)

export const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`
