import type { DiffLine, EditableWebServer } from '../../types/ssl'

export interface CertSwap {
  text: string
  diff: DiffLine[]
}

export interface SiteIdentity {
  names: string[]
  certPath: string
  keyPath: string
}

export interface WebServerDriver {
  readonly kind: EditableWebServer
  readonly label: string
  readonly testCommand: string
  readonly reloadCommand: string
  readonly certbotSiteDirs: readonly string[]
  swapCertLines(fileText: string, blockLine: number, certPath: string, keyPath: string): CertSwap
  siteIdentity(fileText: string, blockLine: number): SiteIdentity
}
