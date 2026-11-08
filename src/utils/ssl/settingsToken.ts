export const CLOUDFLARE_TOKEN_DOCS_URL = 'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/'

const TOKEN_NAME = 'Shellway SSL monitoring'

const MONITORING_PERMISSIONS = [
  { key: 'zone', type: 'read' },
  { key: 'dns', type: 'read' },
  { key: 'zone_settings', type: 'read' }
]

export function cloudflareTokenUrl(): string {
  const permissions = encodeURIComponent(JSON.stringify(MONITORING_PERMISSIONS))
  return `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${permissions}&accountId=*&zoneId=all&name=${encodeURIComponent(TOKEN_NAME)}`
}
