import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EXIT_NGINX_TEST, EXIT_REFUSED, restoreScript, switchScript } from '../../../src/utils/ssl/originCa/scripts'
import { apacheDriver } from '../../../src/utils/webServer/apache'
import type { WebServerDriver } from '../../../src/utils/webServer/driver'
import { nginxDriver } from '../../../src/utils/webServer/nginx'

const DOCKER = process.env.SHELLWAY_DOCKER_BIN ?? 'docker'
const NGINX_BOX = process.env.SHELLWAY_IT_NGINX ?? 'shellway-step4-ssh'
const APACHE_BOX = process.env.SHELLWAY_IT_APACHE ?? 'shellway-step4-apache'
const ENABLED = process.env.SHELLWAY_DOCKER_IT === '1'

const CERT_DIR = '/etc/ssl/shellway-it'
const BACKUP = '/etc/ssl/shellway-it/backups/site.conf.1'
const HOST = 'it.example.com'

interface Run {
  code: number
  stdout: string
  stderr: string
}

function inBox(box: string, script: string): Run {
  const result = spawnSync(DOCKER, ['exec', '-i', '-u', 'root', box, 'sh', '-s'], { input: script, encoding: 'utf8' })
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

function mustRun(box: string, script: string): string {
  const result = inBox(box, script)
  if (result.code !== 0) throw new Error(`${box}: ${result.stderr}`)
  return result.stdout
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

const boxAddress = (box: string): string =>
  spawnSync(DOCKER, ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', box], { encoding: 'utf8' }).stdout.trim()

function makeCertificates(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const name of ['old', 'new']) {
    const pem = mustRun(APACHE_BOX, `openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=${name}.${HOST} -keyout /tmp/it.key -out /tmp/it.pem 2>/dev/null && cat /tmp/it.pem && echo @@ && cat /tmp/it.key && rm -f /tmp/it.key /tmp/it.pem`)
    const [cert, key] = pem.split('@@\n')
    files[`${name}.pem`] = cert
    files[`${name}.key`] = key
  }
  return files
}

function installCertificates(box: string, files: Record<string, string>): void {
  const writes = Object.entries(files).map(([name, text]) => `cat > ${CERT_DIR}/${name} <<'PEM'\n${text.trimEnd()}\nPEM`)
  mustRun(box, ['set -e', `mkdir -p ${CERT_DIR}`, ...writes, `chmod 600 ${CERT_DIR}/*.key`, ''].join('\n'))
}

function servedSubject(address: string, expected: string): string {
  const probe = `openssl s_client -connect ${address} -servername ${HOST} </dev/null 2>/dev/null | openssl x509 -noout -subject`
  const script = `for i in 1 2 3 4 5 6 7 8 9 10; do s=$(${probe}); case "$s" in *${expected}*) break;; esac; sleep 0.3; done; echo "$s"`
  return mustRun(APACHE_BOX, script).trim()
}

interface ServerCase {
  name: string
  box: string
  driver: WebServerDriver
  file: string
  site: string
  address: () => string
}

const NGINX_SITE = `server {
    listen 8443 ssl;
    server_name ${HOST};
    ssl_certificate ${CERT_DIR}/old.pem;
    ssl_certificate_key ${CERT_DIR}/old.key;
    root /var/www/html;
}
`

const APACHE_SITE = `<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName ${HOST}
    DocumentRoot /var/www/html
    SSLEngine on
    SSLCertificateFile ${CERT_DIR}/old.pem
    SSLCertificateKeyFile ${CERT_DIR}/old.key
</VirtualHost>
</IfModule>
`

const CASES: ServerCase[] = [
  { name: 'nginx', box: NGINX_BOX, driver: nginxDriver, file: '/etc/nginx/sites-enabled/shellway-it.conf', site: NGINX_SITE, address: () => `${boxAddress(NGINX_BOX)}:8443` },
  { name: 'Apache', box: APACHE_BOX, driver: apacheDriver('debian'), file: '/etc/apache2/sites-enabled/shellway-it.conf', site: APACHE_SITE, address: () => '127.0.0.1:443' }
]

const reloadAfter = (driver: WebServerDriver, lines: string[]): string => ['set -e', ...lines, driver.testCommand, driver.reloadCommand, ''].join('\n')

describe.skipIf(!ENABLED).each(CASES)('certificate swap against the real $name container', ({ box, driver, file, site, address }) => {
  const blockLine = site.split('\n').findIndex((line) => /^\s*(server \{|<VirtualHost)/.test(line)) + 1
  let certificates: Record<string, string>

  beforeAll(() => {
    certificates = makeCertificates()
    installCertificates(box, certificates)
    mustRun(box, reloadAfter(driver, [`cat > ${file} <<'SITE'\n${site.trimEnd()}\nSITE`]))
  }, 60_000)

  afterAll(() => {
    mustRun(box, reloadAfter(driver, [`rm -f ${file}`, `rm -rf ${CERT_DIR}`]))
  }, 60_000)

  const swapTo = (cert: string, key: string) => {
    const current = mustRun(box, `cat ${file}`)
    const swapped = driver.swapCertLines(current, blockLine, cert, key)
    return { current, script: switchScript({ driver, file, expectedSha256: sha256(current), backupPath: BACKUP, newText: swapped.text }) }
  }

  it('writes the new certificate lines, passes the test, reloads and serves the new certificate', () => {
    expect(servedSubject(address(), `old.${HOST}`)).toContain(`old.${HOST}`)
    const { current, script } = swapTo(`${CERT_DIR}/new.pem`, `${CERT_DIR}/new.key`)
    expect(inBox(box, script).code).toBe(0)
    expect(servedSubject(address(), `new.${HOST}`)).toContain(`new.${HOST}`)
    expect(mustRun(box, `cat ${BACKUP}`)).toBe(current)
  }, 60_000)

  it('puts the backup back, tests and reloads with the restore script', () => {
    expect(inBox(box, restoreScript({ driver, file, backupPath: BACKUP })).code).toBe(0)
    expect(servedSubject(address(), `old.${HOST}`)).toContain(`old.${HOST}`)
  }, 60_000)

  it('puts the original back when the server rejects the new file', () => {
    const { current, script } = swapTo(`${CERT_DIR}/missing.pem`, `${CERT_DIR}/missing.key`)
    const result = inBox(box, script)
    expect(result.code).toBe(EXIT_NGINX_TEST)
    expect(result.stderr).toContain(`${driver.label} rejected the new configuration`)
    expect(mustRun(box, `cat ${file}`)).toBe(current)
    expect(servedSubject(address(), `old.${HOST}`)).toContain(`old.${HOST}`)
  }, 60_000)

  it('refuses without writing when the file changed after review', () => {
    const { current, script } = swapTo(`${CERT_DIR}/new.pem`, `${CERT_DIR}/new.key`)
    mustRun(box, `printf '# edited\\n' >> ${file}`)
    expect(inBox(box, script).code).toBe(EXIT_REFUSED)
    expect(mustRun(box, `cat ${file}`)).toBe(`${current}# edited\n`)
    mustRun(box, reloadAfter(driver, [`cat > ${file} <<'SITE'\n${current.trimEnd()}\nSITE`]))
  }, 60_000)
})
