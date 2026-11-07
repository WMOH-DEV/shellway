export interface OutputSection {
  name: string
  arg: string
  lines: string[]
}

const MARKER = /^@@(\S+)(?: (.*))?$/

export function splitSections(stdout: string): OutputSection[] {
  const sections: OutputSection[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const marker = MARKER.exec(line)
    if (marker) sections.push({ name: marker[1], arg: marker[2] ?? '', lines: [] })
    else if (sections.length > 0 && line !== '') sections[sections.length - 1].lines.push(line)
  }
  return sections
}

export function sectionLines(sections: OutputSection[], name: string): string[] {
  return sections.find((section) => section.name === name)?.lines ?? []
}

export function hasSection(sections: OutputSection[], name: string): boolean {
  return sections.some((section) => section.name === name)
}

export function tabFields(line: string): string[] {
  return line.split('\t')
}

export function toInt(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : 0
}
