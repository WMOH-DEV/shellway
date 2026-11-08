import type { ApacheLayout } from '../../../types/ssl'
import type { WebServerDriver } from '../driver'
import { apacheSiteIdentity, swapApacheCertLines } from './swapCertLines'

const COMMANDS: Record<ApacheLayout, Pick<WebServerDriver, 'testCommand' | 'reloadCommand' | 'certbotSiteDirs'>> = {
  debian: { testCommand: 'apache2ctl configtest', reloadCommand: 'systemctl reload apache2', certbotSiteDirs: ['/etc/apache2/sites-available', '/etc/apache2/sites-enabled'] },
  rhel: { testCommand: 'apachectl configtest', reloadCommand: 'systemctl reload httpd', certbotSiteDirs: ['/etc/httpd/conf.d'] }
}

export const apacheDriver = (layout: ApacheLayout): WebServerDriver => ({
  kind: 'apache',
  label: 'Apache',
  ...COMMANDS[layout],
  swapCertLines: swapApacheCertLines,
  siteIdentity: apacheSiteIdentity
})
