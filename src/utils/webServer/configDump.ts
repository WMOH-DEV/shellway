const FILE_MARKER = /^# configuration file (.+):$/

export interface ConfigFile {
  path: string
  content: string
}

export function splitConfigFiles(dump: string): ConfigFile[] {
  const files: { path: string; lines: string[] }[] = []
  for (const line of dump.split('\n')) {
    const marker = FILE_MARKER.exec(line.replace(/\r$/, ''))
    if (marker) files.push({ path: marker[1], lines: [] })
    else if (files.length > 0) files[files.length - 1].lines.push(line)
  }
  return files.map((f) => ({ path: f.path, content: f.lines.join('\n') }))
}
