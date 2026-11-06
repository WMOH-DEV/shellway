import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { backupGlob, newestBackup, originPaths, undonePath } from './originPaths'
import { certWriteScript, csrScript, restoreIfChangedScript, restoreScript, switchScript, undoScript } from './scripts'
import { heredoc } from './heredoc'

const KEY = '/etc/ssl/shellway/app.example.com-1800000000.key'
const CERT = '/etc/ssl/shellway/app.example.com-1800000000.pem'
const BACKUP = '/etc/ssl/shellway/backups/app.example.com-1800000000.conf'
const FILE = '/etc/nginx/sites-enabled/app.conf'
const SHA = 'a'.repeat(64)
const PEM = '-----BEGIN CERTIFICATE-----\nMIIBsample+base64/data==\n-----END CERTIFICATE-----\n'

const syntaxOk = (script: string) => expect(() => execFileSync('sh', ['-n'], { input: script })).not.toThrow()

describe('csrScript', () => {
  it('makes an ECC key with a restrictive umask and prints only the request', () => {
    expect(csrScript(['app.example.com', 'www.example.com'], 'ecc', KEY)).toBe([
      'set -e',
      'umask 077',
      "mkdir -p -m 700 '/etc/ssl/shellway'",
      "openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout '/etc/ssl/shellway/app.example.com-1800000000.key' -subj '/CN=app.example.com'",
      ''
    ].join('\n'))
  })

  it('makes a 2048-bit RSA key on request', () => {
    expect(csrScript(['app.example.com'], 'rsa', KEY)).toContain('-newkey rsa:2048 -nodes')
  })

  it('never prints the key and is valid shell', () => {
    const script = csrScript(['app.example.com'], 'ecc', KEY)
    expect(script).not.toMatch(/cat |echo /)
    syntaxOk(script)
  })

  it('refuses names that are not plain hostnames', () => {
    expect(() => csrScript(['app.example.com; rm -rf /'], 'ecc', KEY)).toThrow('cannot get a certificate')
    expect(() => csrScript(['*.example.com'], 'ecc', KEY)).toThrow('cannot get a certificate')
    expect(() => csrScript([], 'ecc', KEY)).toThrow('cannot get a certificate')
  })

  it('quotes a path with odd characters', () => {
    expect(csrScript(['app.example.com'], 'ecc', "/tmp/it's.key")).toContain("-keyout '/tmp/it'\\''s.key'")
  })
})

describe('certWriteScript', () => {
  it('writes the certificate from a quoted heredoc and makes it world-readable', () => {
    const script = certWriteScript(PEM, CERT)
    const token = /<<'(SHELLWAY_[0-9a-f]{32})'/.exec(script)?.[1] ?? ''
    expect(script).toBe(`set -e\numask 022\ncat > '${CERT}' <<'${token}'\n${PEM}${token}\nchmod 644 '${CERT}'\n`)
    syntaxOk(script)
  })

  it('refuses anything that is not a certificate', () => {
    expect(() => certWriteScript('hello', CERT)).toThrow('did not return a certificate')
    expect(() => certWriteScript(`${PEM}; rm -rf /`, CERT)).toThrow('did not return a certificate')
  })
})

describe('heredoc', () => {
  it('picks another terminator when the text contains the first one', () => {
    const tokens = ['CLASH', 'FRESH']
    expect(heredoc('a CLASH b', () => tokens.shift() ?? 'X')).toBe("<<'FRESH'\na CLASH b\nFRESH\n")
  })

  it('uses a different terminator every time', () => {
    expect(heredoc('x')).not.toBe(heredoc('x'))
  })
})

describe('switchScript', () => {
  const script = switchScript({ file: FILE, expectedSha256: SHA, backupPath: BACKUP, newText: 'server {\n}\n' })
  const token = /<<'(SHELLWAY_[0-9a-f]{32})'/.exec(script)?.[1] ?? ''

  it('refuses a changed file, backs up, writes in place, tests and reloads', () => {
    expect(script).toBe([
      'set -e',
      `if [ "$(sha256sum '${FILE}' | cut -d' ' -f1)" != '${SHA}' ]; then`,
      "  echo 'The site file changed after you reviewed it. Nothing was written. Review it again.' >&2",
      '  exit 3',
      'fi',
      "mkdir -p -m 700 '/etc/ssl/shellway/backups'",
      `cp -p '${FILE}' '${BACKUP}'`,
      `cat > '${FILE}' <<'${token}'`,
      'server {',
      '}',
      token,
      'if ! nginx -t; then',
      `  cat '${BACKUP}' > '${FILE}'`,
      "  echo 'nginx rejected the new configuration. The original file was put back.' >&2",
      '  exit 4',
      'fi',
      'if ! nginx -s reload; then',
      `  cat '${BACKUP}' > '${FILE}'`,
      "  echo 'nginx could not reload. The original file was put back.' >&2",
      '  exit 5',
      'fi',
      ''
    ].join('\n'))
    syntaxOk(script)
  })

  it('writes through the existing file so a symlink in sites-enabled keeps pointing at sites-available', () => {
    expect(script).toContain(`cat > '${FILE}'`)
    expect(script).not.toMatch(/\bmv\b/)
  })

  it('drops the extra newline when the file did not end with one', () => {
    const bare = switchScript({ file: FILE, expectedSha256: SHA, backupPath: BACKUP, newText: 'server {\n}' })
    expect(bare).toContain(`\n${/<<'(SHELLWAY_[0-9a-f]{32})'/.exec(bare)?.[1]}\ntruncate -s -1 '${FILE}'\n`)
    syntaxOk(bare)
  })

  it('refuses a malformed checksum', () => {
    expect(() => switchScript({ file: FILE, expectedSha256: "x'; rm -rf /", backupPath: BACKUP, newText: 'a\n' })).toThrow('Invalid checksum')
  })
})

describe('restore and undo scripts', () => {
  it('restores the backup, tests and reloads', () => {
    expect(restoreScript({ file: FILE, backupPath: BACKUP })).toBe(`set -e\ncat '${BACKUP}' > '${FILE}'\nnginx -t\nnginx -s reload\n`)
  })

  it('restores only when the file differs from an existing backup, and signals it with exit 6', () => {
    const script = restoreIfChangedScript({ file: FILE, backupPath: BACKUP })
    expect(script).toContain(`if [ ! -f '${BACKUP}' ] || cmp -s '${BACKUP}' '${FILE}'; then exit 0; fi`)
    expect(script).toContain('exit 6')
    syntaxOk(script)
  })

  it('saves the current file, restores the backup and puts the current file back when nginx objects', () => {
    const save = undonePath('app.example.com', 1800000500)
    const script = undoScript({ file: FILE, backupPath: BACKUP, savePath: save })
    expect(script).toContain(`cp -p '${FILE}' '${save}'`)
    expect(script).toContain(`cat '${BACKUP}' > '${FILE}'`)
    expect(script.match(new RegExp(`cat '${save}' > '${FILE}'`, 'g'))).toHaveLength(2)
    expect(script).toContain('exit 4')
    syntaxOk(script)
  })
})

describe('originPaths', () => {
  it('names the key, certificate and backup with the same timestamp', () => {
    expect(originPaths('app.example.com', 1800000000)).toEqual({ keyPath: KEY, certPath: CERT, backupPath: BACKUP })
    expect(undonePath('app.example.com', 1800000500)).toBe('/etc/ssl/shellway/backups/undone/app.example.com-1800000500.conf')
    expect(backupGlob('app.example.com')).toBe('/etc/ssl/shellway/backups/app.example.com-[0-9]*.conf')
  })

  it('picks the newest backup of exactly that name', () => {
    const listing = [
      '/etc/ssl/shellway/backups/app.example.com-1800000000.conf',
      '/etc/ssl/shellway/backups/app.example.com-1800009999.conf',
      '/etc/ssl/shellway/backups/app.example.com-1.example.net-1800099999.conf',
      '/etc/ssl/shellway/backups/appXexample.com-1800099999.conf',
      ''
    ].join('\n')
    expect(newestBackup(listing, 'app.example.com')).toBe('/etc/ssl/shellway/backups/app.example.com-1800009999.conf')
    expect(newestBackup('', 'app.example.com')).toBeNull()
  })
})
