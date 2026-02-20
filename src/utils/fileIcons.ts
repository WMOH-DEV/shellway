/**
 * Map file extensions to Lucide icon names and colors.
 * Inspired by VS Code file icon themes.
 */

interface FileIconDef {
  color: string
}

const EXT_MAP: Record<string, FileIconDef> = {
  // JavaScript / TypeScript
  js: { color: '#f7df1e' },
  jsx: { color: '#61dafb' },
  ts: { color: '#3178c6' },
  tsx: { color: '#3178c6' },
  mjs: { color: '#f7df1e' },
  cjs: { color: '#f7df1e' },

  // Web
  html: { color: '#e34f26' },
  htm: { color: '#e34f26' },
  css: { color: '#1572b6' },
  scss: { color: '#cc6699' },
  less: { color: '#1d365d' },
  svg: { color: '#ffb13b' },

  // Data
  json: { color: '#cbcb41' },
  xml: { color: '#e37933' },
  yaml: { color: '#cb171e' },
  yml: { color: '#cb171e' },
  toml: { color: '#9c4121' },
  csv: { color: '#22c55e' },

  // Languages
  py: { color: '#3776ab' },
  rb: { color: '#cc342d' },
  php: { color: '#777bb4' },
  java: { color: '#ed8b00' },
  go: { color: '#00add8' },
  rs: { color: '#ce412b' },
  c: { color: '#555555' },
  cpp: { color: '#00599c' },
  h: { color: '#a074c4' },
  cs: { color: '#239120' },
  swift: { color: '#f05138' },
  kt: { color: '#a97bff' },

  // Config
  env: { color: '#ecd53f' },
  gitignore: { color: '#f34f29' },
  dockerignore: { color: '#2496ed' },
  editorconfig: { color: '#fff2' },

  // Shell
  sh: { color: '#89e051' },
  bash: { color: '#89e051' },
  zsh: { color: '#89e051' },
  ps1: { color: '#012456' },
  bat: { color: '#c1f12e' },

  // Docs
  md: { color: '#083fa1' },
  txt: { color: '#a1a1aa' },
  log: { color: '#71717a' },
  pdf: { color: '#ff0000' },
  doc: { color: '#185abd' },
  docx: { color: '#185abd' },

  // Images
  png: { color: '#a074c4' },
  jpg: { color: '#a074c4' },
  jpeg: { color: '#a074c4' },
  gif: { color: '#a074c4' },
  webp: { color: '#a074c4' },
  ico: { color: '#a074c4' },
  bmp: { color: '#a074c4' },

  // Archives
  zip: { color: '#e3a21a' },
  tar: { color: '#e3a21a' },
  gz: { color: '#e3a21a' },
  rar: { color: '#e3a21a' },
  '7z': { color: '#e3a21a' },
  bz2: { color: '#e3a21a' },

  // Database
  sql: { color: '#e38c00' },
  db: { color: '#e38c00' },
  sqlite: { color: '#003b57' },

  // Keys/Certs
  pem: { color: '#cb3837' },
  key: { color: '#cb3837' },
  crt: { color: '#cb3837' },
  cer: { color: '#cb3837' },

  // Binary / executables
  exe: { color: '#71717a' },
  dll: { color: '#71717a' },
  so: { color: '#71717a' },
  dmg: { color: '#71717a' },
  deb: { color: '#71717a' },
  rpm: { color: '#71717a' }
}

/** Get the color for a file based on its extension */
export function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return EXT_MAP[ext]?.color || '#a1a1aa'
}

/** Check if a file is likely a text file (for preview) */
export function isTextFile(filename: string): boolean {
  const textExts = new Set([
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
    'html', 'htm', 'css', 'scss', 'less', 'svg',
    'json', 'xml', 'yaml', 'yml', 'toml', 'csv',
    'py', 'rb', 'php', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'cs', 'swift', 'kt',
    'sh', 'bash', 'zsh', 'ps1', 'bat',
    'md', 'txt', 'log', 'env', 'gitignore', 'editorconfig',
    'sql', 'conf', 'cfg', 'ini', 'makefile', 'dockerfile'
  ])
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return textExts.has(ext) || filename.toLowerCase() === 'makefile' || filename.toLowerCase() === 'dockerfile'
}

/** Check if a file is an image (for preview) */
export function isImageFile(filename: string): boolean {
  const imgExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return imgExts.has(ext)
}
