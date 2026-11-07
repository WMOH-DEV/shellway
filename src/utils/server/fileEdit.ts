import type { ActionStep } from '@/types/server/core'

export interface FileEditSpec {
  id: string
  label: string
  path: string
  content: string
  originalSha256: string | null
  mode?: string
  owner?: string
  test?: string
  reload?: string
  verify?: string
  timeoutSeconds?: number
  diff?: string
}

export const EXIT_FILE_CHANGED = 74
export const EXIT_EDIT_REJECTED = 75
export const EXIT_EDIT_RESTORED = 76
export const BACKUP_ROOT = '/var/backups/shellway'

const SAFE_PATH = /^(\/[A-Za-z0-9._@+=,:~-]+)+$/
const SHA256 = /^[0-9a-f]{64}$/
const MODE = /^[0-7]{3,4}$/
const OWNER = /^[a-z_][a-z0-9_-]{0,31}(:[a-z_][a-z0-9_-]{0,31})?$/
const B64_TOKEN = 'SHELLWAY_B64_END'

const q = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

function assertSpec(spec: FileEditSpec): void {
  const segments = spec.path.split('/')
  if (!SAFE_PATH.test(spec.path) || segments.includes('.') || segments.includes('..')) throw new Error(`Invalid file path: ${spec.path}`)
  if (spec.originalSha256 !== null && !SHA256.test(spec.originalSha256)) throw new Error('Invalid checksum')
  if (spec.mode !== undefined && !MODE.test(spec.mode)) throw new Error(`Invalid file mode: ${spec.mode}`)
  if (spec.owner !== undefined && !OWNER.test(spec.owner)) throw new Error(`Invalid file owner: ${spec.owner}`)
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

const wrapped = (base64: string): string => (base64.match(/.{1,76}/g) ?? []).join('\n')

function header(spec: FileEditSpec): string[] {
  const dir = spec.path.slice(0, spec.path.lastIndexOf('/')) || '/'
  return ['exec 2>&1', 'umask 077', `path=${q(spec.path)}`, `dir=${q(dir)}`]
}

const RESTORE_FUNCTION = [
  'restore() {',
  '  if [ "$existed" = 1 ]; then',
  '    rtmp=$(mktemp "$dir/.shellway-edit.XXXXXX") && cp -p "$backup" "$rtmp" && mv -f "$rtmp" "$path"',
  '  else',
  '    rm -f "$path"',
  '  fi',
  '}'
]

const say = (message: string): string => `echo ${q(message)}`

function compareAndSwap(spec: FileEditSpec): string[] {
  return [
    `if [ -L "$path" ]; then ${say(`${spec.path} is a link. Nothing was written. Edit the file it points to instead.`)}; exit ${EXIT_EDIT_REJECTED}; fi`,
    'current=""',
    'if [ -e "$path" ]; then current=$(sha256sum "$path" | cut -d" " -f1) || exit 1; fi',
    `if [ "$current" != ${q(spec.originalSha256 ?? '')} ]; then`,
    `  ${say(`${spec.path} changed after you reviewed it. Nothing was written. Review it again.`)}`,
    `  exit ${EXIT_FILE_CHANGED}`,
    'fi'
  ]
}

function backup(backupRoot: string, spec: FileEditSpec): string[] {
  return [
    `backup=${q(backupRoot)}/"\${SHELLWAY_RUN_ID:?}"${q(spec.path)}`,
    'existed=0',
    'if [ -e "$path" ]; then',
    '  existed=1',
    `  mkdir -p "$(dirname "$backup")" && cp -p "$path" "$backup" || { ${say(`Could not back up ${spec.path}. Nothing was written.`)}; exit 1; }`,
    '  echo "SHELLWAY_STATE backup=$backup"',
    'else',
    '  echo "SHELLWAY_STATE created=1"',
    'fi'
  ]
}

function writeNewContent(spec: FileEditSpec): string[] {
  const failed = `{ rm -f "$tmp"; ${say(`Could not write ${spec.path}. Nothing was changed.`)}; exit 1; }`
  return [
    '[ -d "$dir" ] || (umask 022 && mkdir -p "$dir") || exit 1',
    `tmp=$(mktemp "$dir/.shellway-edit.XXXXXX") || { ${say(`Could not create a temporary file next to ${spec.path}.`)}; exit 1; }`,
    `if [ "$existed" = 1 ]; then cp -p "$path" "$tmp" || ${failed}; else chmod 644 "$tmp" || ${failed}; fi`,
    `base64 -d > "$tmp" <<'${B64_TOKEN}' || ${failed}`,
    wrapped(toBase64(spec.content)),
    B64_TOKEN,
    ...(spec.mode ? [`chmod ${spec.mode} "$tmp" || ${failed}`] : []),
    ...(spec.owner ? [`chown ${spec.owner} "$tmp" || ${failed}`] : []),
    `mv -f "$tmp" "$path" || ${failed}`,
    STOP_TRAP
  ]
}

const STOP_TRAP = `trap 'recover "Stopped before finishing."' TERM HUP INT`

function testNewContent(spec: FileEditSpec): string[] {
  if (!spec.test) return []
  return [
    `if ! { ${spec.test}; }; then`,
    `  restore || { ${say('The test failed and the original file could not be put back. The backup is at:')}; echo "$backup"; exit 1; }`,
    `  ${say('The test failed, so nothing was changed. The original file is back in place.')}`,
    `  exit ${EXIT_EDIT_REJECTED}`,
    'fi'
  ]
}

function recoverFunction(spec: FileEditSpec): string[] {
  return [
    'recover() {',
    `  restore || { ${say('The original file could not be put back. The backup is at:')}; echo "$backup"; exit 1; }`,
    ...(spec.test ? [`  { ${spec.test}; } || { ${say('The original file is back, but its test failed too. Check the server.')}; exit 1; }`] : []),
    ...(spec.reload ? [`  { ${spec.reload}; } || { ${say('The original file is back, but the reload failed. Check the server.')}; exit 1; }`] : []),
    '  echo "$1 The original file is back in place."',
    `  exit ${EXIT_EDIT_RESTORED}`,
    '}'
  ]
}

function reloadAndVerify(spec: FileEditSpec): string[] {
  return [
    ...(spec.reload ? [`{ ${spec.reload}; } || recover 'The reload failed.'`] : []),
    ...(spec.verify ? [`{ ${spec.verify}; } || recover 'The check after the change failed.'`] : [])
  ]
}

export function fileEditScript(spec: FileEditSpec, backupRoot = BACKUP_ROOT): string {
  assertSpec(spec)
  return [
    ...header(spec),
    ...RESTORE_FUNCTION,
    ...recoverFunction(spec),
    ...compareAndSwap(spec),
    ...backup(backupRoot, spec),
    ...writeNewContent(spec),
    ...testNewContent(spec),
    ...reloadAndVerify(spec),
    ''
  ].join('\n')
}

export function fileEditRollback(spec: FileEditSpec): string {
  assertSpec(spec)
  return [
    ...header(spec),
    'if [ -n "${backup:-}" ] && [ -f "$backup" ]; then',
    `  rtmp=$(mktemp "$dir/.shellway-edit.XXXXXX") && cp -p "$backup" "$rtmp" && mv -f "$rtmp" "$path" || { ${say(`Could not put back ${spec.path}.`)}; exit 1; }`,
    'elif [ "${created:-}" = 1 ]; then',
    '  rm -f "$path" || exit 1',
    'else',
    `  ${say('No backup was recorded, so nothing was undone.')}`,
    '  exit 1',
    'fi',
    ...(spec.test ? [`{ ${spec.test}; } || { ${say('The file is back, but its test failed. Check the server.')}; exit 1; }`] : []),
    ...(spec.reload ? [`{ ${spec.reload}; } || { ${say('The file is back, but the reload failed. Check the server.')}; exit 1; }`] : []),
    ''
  ].join('\n')
}

function display(spec: FileEditSpec): string {
  const backupPath = `${BACKUP_ROOT}/$SHELLWAY_RUN_ID${spec.path}`
  const save = spec.originalSha256 === null ? [] : [`cp -p ${q(spec.path)} "${backupPath}"`]
  return [...save, `write ${q(spec.path)}`, spec.test, spec.reload, spec.verify].filter(Boolean).join('\n')
}

export function fileEditStep(spec: FileEditSpec): ActionStep {
  return {
    id: spec.id,
    label: spec.label,
    kind: 'file-edit',
    root: true,
    script: fileEditScript(spec),
    display: display(spec),
    diff: spec.diff,
    timeoutSeconds: spec.timeoutSeconds ?? 60,
    rollback: fileEditRollback(spec),
    cleanExits: [EXIT_FILE_CHANGED, EXIT_EDIT_REJECTED, EXIT_EDIT_RESTORED]
  }
}
