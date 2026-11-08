import type { CreateSiteInput } from '@/types/createSite'
import type { DeployStep } from '@/types/deploy'
import { assertFolder, assertOwner, assertPort, assertSiteName } from './validate'

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export const pm2ServiceName = (owner: string): string => `pm2-${assertOwner(owner)}`

export function pm2SetupScript(owner: string, install: boolean): string {
  const user = assertOwner(owner)
  return [
    'set -e',
    ...(install
      ? [
          'if ! command -v npm >/dev/null 2>&1; then',
          "  echo 'npm is not on the PATH for root (node may be installed with nvm). Run npm install -g pm2 yourself, then Retry.' >&2",
          '  exit 1',
          'fi',
          'npm install -g pm2'
        ]
      : [
          'if ! command -v pm2 >/dev/null 2>&1; then',
          "  echo 'pm2 is not on the PATH for root (it may be installed with nvm). Run pm2 startup yourself, then Continue from here.' >&2",
          '  exit 1',
          'fi'
        ]),
    `home=$(getent passwd ${quote(user)} | cut -d: -f6)`,
    `if [ -z "$home" ]; then echo ${quote(`Could not find the home folder of ${user}.`)} >&2; exit 1; fi`,
    'if command -v systemctl >/dev/null 2>&1; then',
    `  pm2 startup systemd -u ${quote(user)} --hp "$home"`,
    'fi',
    ''
  ].join('\n')
}

const step = (command: string): DeployStep => ({ command, optional: false, timeoutSeconds: null })

export function pm2ActivateSteps(siteName: string, sitePath: string, port: number): DeployStep[] {
  const name = quote(assertSiteName(siteName))
  const env = `PORT=${assertPort(port)}`
  return [
    step(`if pm2 describe ${name} >/dev/null 2>&1; then ${env} pm2 restart ${name} --update-env; else ${env} pm2 start npm --name ${name} --cwd ${quote(assertFolder(sitePath))} -- start; fi`),
    step('pm2 save')
  ]
}

const RUNNER_PATH = 'PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"'

function stopPm2Script(siteName: string): string {
  const name = quote(assertSiteName(siteName))
  return [
    'set -e',
    RUNNER_PATH,
    "if ! command -v pm2 >/dev/null 2>&1; then echo 'pm2 is not installed, so nothing runs under it.'; exit 0; fi",
    `if pm2 describe ${name} >/dev/null 2>&1; then`,
    `  pm2 delete ${name}`,
    '  pm2 save --force',
    'fi',
    ''
  ].join('\n')
}

function stopComposeScript(siteName: string): string {
  return [
    'set -e',
    RUNNER_PATH,
    "if ! command -v docker >/dev/null 2>&1; then echo 'Docker is not installed, so nothing runs under it.'; exit 0; fi",
    `docker compose -p ${quote(assertSiteName(siteName))} down`,
    ''
  ].join('\n')
}

export function stopAppScript({ template, codeSource, siteName }: Pick<CreateSiteInput, 'template' | 'codeSource' | 'siteName'>): string | null {
  if (codeSource === 'none') return null
  if (template === 'node') return stopPm2Script(siteName)
  return template === 'compose' ? stopComposeScript(siteName) : null
}
