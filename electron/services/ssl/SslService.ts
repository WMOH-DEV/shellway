import type { RemoteExec } from '../deploy/DeployService'
import type { ActionResult, CertbotAction, ServerScan } from '../../../src/types/ssl'

export type OutputSink = (chunk: string) => void

export class SslService {
  constructor(private readonly exec: RemoteExec) {}

  async scan(): Promise<ServerScan> {
    void this.exec
    throw new Error('Server scan is not implemented yet')
  }

  async runCertbot(lineage: string, action: CertbotAction, onOutput: OutputSink): Promise<ActionResult> {
    void lineage
    void action
    void onOutput
    throw new Error('certbot actions are not implemented yet')
  }
}
