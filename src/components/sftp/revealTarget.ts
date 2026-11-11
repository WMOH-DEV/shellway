export interface RevealTarget {
  directory: string
  file: string | null
}

export function splitRevealTarget(path: string): RevealTarget {
  if (path.length > 1 && path.endsWith('/')) return { directory: path.slice(0, -1), file: null }
  const slash = path.lastIndexOf('/')
  if (slash <= 0) return { directory: '/', file: path }
  return { directory: path.slice(0, slash), file: path }
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
