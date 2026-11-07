import type { ApacheLayout, EditableWebServer, ServerFacts } from '../../types/ssl'
import { apacheDriver } from './apache'
import type { WebServerDriver } from './driver'
import { nginxDriver } from './nginx'
import { siteServer } from './siteServer'

export const webServerDriver = (kind: EditableWebServer, layout: ApacheLayout | null): WebServerDriver =>
  kind === 'apache' ? apacheDriver(layout ?? 'debian') : nginxDriver

export type { WebServerDriver } from './driver'

export const servingDriver = (facts: ServerFacts): WebServerDriver => webServerDriver(siteServer(facts) ?? 'nginx', facts.apache?.layout ?? null)
