import type { WebServerDriver } from '../driver'
import { apacheSiteIdentity, swapApacheCertLines } from './swapCertLines'

export type ApacheLayout = 'debian' | 'rhel'

const COMMANDS: Record<ApacheLayout, Pick<WebServerDriver, 'testCommand' | 'reloadCommand'>> = {
  debian: { testCommand: 'apache2ctl configtest', reloadCommand: 'systemctl reload apache2' },
  rhel: { testCommand: 'apachectl configtest', reloadCommand: 'systemctl reload httpd' }
}

export const apacheDriver = (layout: ApacheLayout): WebServerDriver => ({
  kind: 'apache',
  label: 'Apache',
  ...COMMANDS[layout],
  swapCertLines: swapApacheCertLines,
  siteIdentity: apacheSiteIdentity
})
