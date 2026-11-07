import type { EditableWebServer, ServerFacts } from '../../types/ssl'
import type { WebServerDriver } from './driver'
import { nginxDriver } from './nginx'

const DRIVERS: Record<EditableWebServer, WebServerDriver> = {
  nginx: nginxDriver
}

export const webServerDriver = (kind: EditableWebServer): WebServerDriver => DRIVERS[kind]

export type { WebServerDriver } from './driver'

export const servingDriver = (_facts: ServerFacts): WebServerDriver => nginxDriver
