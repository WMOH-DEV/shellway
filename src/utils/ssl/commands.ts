import type { CertbotAction } from '../../types/ssl'

export const LINEAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/

const ACTION_FLAGS: Record<CertbotAction, string> = {
  test: ' --dry-run',
  renew: '',
  force: ' --force-renewal'
}

export function certbotCommand(lineage: string, action: CertbotAction): string {
  if (!LINEAGE_NAME.test(lineage)) throw new Error('Invalid certificate name')
  return `sudo -n certbot renew${ACTION_FLAGS[action]} --cert-name ${lineage}`
}
