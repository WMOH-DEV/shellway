import type { CloudflareStatus, CloudflareZone, EdgeInfo } from '../../../src/types/ssl'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type TokenCheck = Pick<CloudflareStatus, 'error' | 'permissions' | 'zones'>

export class CloudflareClient {
  constructor(private readonly token: string, private readonly fetchImpl: FetchLike = fetch) {}

  async check(): Promise<TokenCheck> {
    void this.token
    void this.fetchImpl
    throw new Error('Cloudflare check is not implemented yet')
  }

  async edges(hosts: string[], serverAddresses: string[], zones: CloudflareZone[]): Promise<Record<string, EdgeInfo>> {
    void hosts
    void serverAddresses
    void zones
    throw new Error('Cloudflare edges are not implemented yet')
  }
}
