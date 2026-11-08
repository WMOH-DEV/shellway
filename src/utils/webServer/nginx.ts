import { blockIdentity, swapCertLines } from '../ssl/originCa/swapCertLines'
import type { WebServerDriver } from './driver'

export const nginxDriver: WebServerDriver = {
  kind: 'nginx',
  label: 'nginx',
  testCommand: 'nginx -t',
  reloadCommand: 'nginx -s reload',
  certbotSiteDirs: [],
  swapCertLines,
  siteIdentity: blockIdentity
}
