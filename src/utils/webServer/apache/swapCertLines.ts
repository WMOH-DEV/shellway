import { changedLines } from '../../ssl/originCa/diff'
import { assertSafe } from '../../ssl/originCa/swapCertLines'
import type { CertSwap, SiteIdentity } from '../driver'
import { type ApacheDirective, findVirtualHost, firstArg, vhostNames, within } from './config'

const CERT = 'SSLCertificateFile'
const KEY = 'SSLCertificateKeyFile'
const DIRECTIVE_START = /^([ \t]*)(\S+)/

interface Edit {
  directive: ApacheDirective
  path: string
}

function onlyDirective(vhost: ApacheDirective, name: string): ApacheDirective {
  const found = within(vhost, name.toLowerCase())
  if (found.length === 0) throw new Error(`This site has no ${name} line to replace.`)
  if (found.length > 1) throw new Error(`This site has more than one ${name} line, so Shellway cannot tell which to replace.`)
  return found[0]
}

function rewrittenLine(raw: string, path: string): string {
  const [, indent, name] = DIRECTIVE_START.exec(raw)!
  return `${indent}${name} ${path}${raw.endsWith('\r') ? '\r' : ''}`
}

function applyEdit(lines: string[], { directive, path }: Edit): string[] {
  const start = directive.line - 1
  return [...lines.slice(0, start), rewrittenLine(lines[start], path), ...lines.slice(directive.lastLine)]
}

export function swapApacheCertLines(fileText: string, blockLine: number, certPath: string, keyPath: string): CertSwap {
  assertSafe(certPath)
  assertSafe(keyPath)
  const vhost = findVirtualHost(fileText, blockLine)
  const edits: Edit[] = [
    { directive: onlyDirective(vhost, CERT), path: certPath },
    { directive: onlyDirective(vhost, KEY), path: keyPath }
  ]
  const lines = edits.sort((a, b) => b.directive.line - a.directive.line).reduce(applyEdit, fileText.split('\n'))
  const text = lines.join('\n')
  return { text, diff: changedLines(fileText, text) }
}

export function apacheSiteIdentity(fileText: string, blockLine: number): SiteIdentity {
  const vhost = findVirtualHost(fileText, blockLine)
  return {
    names: [...new Set(vhostNames(vhost).map((name) => name.toLowerCase()))],
    certPath: firstArg(vhost, CERT.toLowerCase()) ?? '',
    keyPath: firstArg(vhost, KEY.toLowerCase()) ?? ''
  }
}
