import { readFileSync } from 'fs'
import { join } from 'path'

const FIXTURES = join(__dirname, '../../../../electron/services/webServer/fixtures/apache')

export const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

export const configDump = (files: Record<string, string>): string =>
  Object.entries(files).map(([path, text]) => `# configuration file ${path}:\n${text}`).join('\n')
