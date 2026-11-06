import { posix } from 'path'
import type { OriginKeyType } from '../../../types/ssl'
import { isIssuableName } from '../https/issueCommands'
import { heredoc } from './heredoc'

export const EXIT_REFUSED = 3
export const EXIT_NGINX_TEST = 4
export const EXIT_RELOAD = 5
export const EXIT_RESTORED = 6

const SHA256 = /^[0-9a-f]{64}$/
const CERTIFICATE_PEM = /^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/

const KEY_OPTIONS: Record<OriginKeyType, string> = {
  ecc: '-newkey ec -pkeyopt ec_paramgen_curve:prime256v1',
  rsa: '-newkey rsa:2048'
}

const q = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export function csrScript(names: string[], keyType: OriginKeyType, keyPath: string): string {
  const bad = names.find((name) => !isIssuableName(name))
  if (names.length === 0 || bad !== undefined) throw new Error(`${bad ?? 'An empty name'} cannot get a certificate this way`)
  return [
    'set -e',
    'umask 077',
    `mkdir -p -m 700 ${q(posix.dirname(keyPath))}`,
    `openssl req -new ${KEY_OPTIONS[keyType]} -nodes -keyout ${q(keyPath)} -subj ${q(`/CN=${names[0]}`)}`,
    ''
  ].join('\n')
}

export function certWriteScript(pem: string, certPath: string): string {
  if (!CERTIFICATE_PEM.test(pem)) throw new Error('Cloudflare did not return a certificate')
  return ['set -e', 'umask 022', `cat > ${q(certPath)} ${heredoc(pem)}chmod 644 ${q(certPath)}`, ''].join('\n')
}

export interface SwitchScriptInput {
  file: string
  expectedSha256: string
  backupPath: string
  newText: string
}

function revertThenExit(backupPath: string, file: string, message: string, code: number): string {
  return `  cat ${q(backupPath)} > ${q(file)}\n  echo ${q(message)} >&2\n  exit ${code}`
}

export function switchScript({ file, expectedSha256, backupPath, newText }: SwitchScriptInput): string {
  if (!SHA256.test(expectedSha256)) throw new Error('Invalid checksum')
  const trimNewline = newText.endsWith('\n') ? [] : [`truncate -s -1 ${q(file)}`]
  return [
    'set -e',
    `if [ "$(sha256sum ${q(file)} | cut -d' ' -f1)" != ${q(expectedSha256)} ]; then`,
    "  echo 'The site file changed after you reviewed it. Nothing was written. Review it again.' >&2",
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `mkdir -p -m 700 ${q(posix.dirname(backupPath))}`,
    `cp -p ${q(file)} ${q(backupPath)}`,
    `cat > ${q(file)} ${heredoc(newText).trimEnd()}`,
    ...trimNewline,
    'if ! nginx -t; then',
    revertThenExit(backupPath, file, 'nginx rejected the new configuration. The original file was put back.', EXIT_NGINX_TEST),
    'fi',
    'if ! nginx -s reload; then',
    revertThenExit(backupPath, file, 'nginx could not reload. The original file was put back.', EXIT_RELOAD),
    'fi',
    ''
  ].join('\n')
}

export function restoreScript({ file, backupPath }: Pick<SwitchScriptInput, 'file' | 'backupPath'>): string {
  return ['set -e', `cat ${q(backupPath)} > ${q(file)}`, 'nginx -t', 'nginx -s reload', ''].join('\n')
}

export function restoreIfChangedScript({ file, backupPath }: Pick<SwitchScriptInput, 'file' | 'backupPath'>): string {
  return [
    'set -e',
    `if [ ! -f ${q(backupPath)} ] || cmp -s ${q(backupPath)} ${q(file)}; then exit 0; fi`,
    `cat ${q(backupPath)} > ${q(file)}`,
    'nginx -t',
    'nginx -s reload',
    `exit ${EXIT_RESTORED}`,
    ''
  ].join('\n')
}

export interface UndoScriptInput {
  file: string
  backupPath: string
  savePath: string
}

export function undoScript({ file, backupPath, savePath }: UndoScriptInput): string {
  return [
    'set -e',
    `if [ ! -f ${q(backupPath)} ]; then`,
    "  echo 'The backup file is gone, so there is nothing to restore.' >&2",
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `mkdir -p -m 700 ${q(posix.dirname(savePath))}`,
    `cp -p ${q(file)} ${q(savePath)}`,
    `cat ${q(backupPath)} > ${q(file)}`,
    'if ! nginx -t; then',
    revertThenExit(savePath, file, 'nginx rejected the restored file. The current file was put back.', EXIT_NGINX_TEST),
    'fi',
    'if ! nginx -s reload; then',
    revertThenExit(savePath, file, 'nginx could not reload. The current file was put back.', EXIT_RELOAD),
    'fi',
    ''
  ].join('\n')
}

export const removeFilesCommand = (...paths: string[]): string => `sudo -n rm -f ${paths.map(q).join(' ')}`
