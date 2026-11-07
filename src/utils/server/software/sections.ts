export interface OutputSection {
  name: string
  arg: string
  lines: string[]
}

const HEADER = /^@@(\S+)(?: (.*))?$/

export function splitSections(stdout: string): OutputSection[] {
  const sections: OutputSection[] = []
  for (const line of stdout.split('\n')) {
    const header = HEADER.exec(line)
    if (header) sections.push({ name: header[1], arg: header[2]?.trim() ?? '', lines: [] })
    else if (sections.length > 0 && line.trim() !== '') sections[sections.length - 1].lines.push(line)
  }
  return sections
}

export const sectionLines = (sections: OutputSection[], name: string, arg = ''): string[] =>
  sections.find((section) => section.name === name && section.arg === arg)?.lines ?? []

export const hasSection = (sections: OutputSection[], name: string): boolean => sections.some((section) => section.name === name)

export function keyValues(lines: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of lines) {
    const at = line.indexOf('=')
    if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return values
}

export function upstreamVersion(debianVersion: string): string {
  const withoutEpoch = debianVersion.replace(/^\d+:/, '')
  const dash = withoutEpoch.lastIndexOf('-')
  return (dash > 0 ? withoutEpoch.slice(0, dash) : withoutEpoch).replace(/[+~].*$/, '')
}

export const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`
