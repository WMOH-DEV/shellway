import type { NginxParse, ServerBlock } from '../../../src/types/ssl'
import type { RemoteExec } from '../deploy/DeployService'
import type { ParsedFacts } from '../ssl/parse'

export interface SiteRead {
  blocks: ServerBlock[]
  parse: NginxParse
}

export interface SiteReader {
  read(exec: RemoteExec, facts: ParsedFacts): Promise<SiteRead>
}
