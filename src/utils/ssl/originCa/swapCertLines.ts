import type { DiffLine } from '../../../types/ssl'
import { changedLines } from './diff'

const CERT = 'ssl_certificate'
const KEY = 'ssl_certificate_key'
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/
const CERTBOT_MARK = /^[ \t]*# managed by Certbot[ \t]*(?=\r?\n|$)/

type TokenKind = 'word' | ';' | '{' | '}'

interface Token {
  kind: TokenKind
  value: string
  start: number
  end: number
  line: number
}

interface Edit {
  name: string
  start: number
  end: number
}

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n'
const isDelimiter = (ch: string) => isSpace(ch) || ch === ';' || ch === '{' || ch === '}'

function quotedEnd(text: string, start: number): { end: number; lines: number } {
  let lines = 0
  let i = start + 1
  for (; i < text.length && text[i] !== text[start]; i++) {
    if (text[i] === '\\' && i + 1 < text.length) i++
    if (text[i] === '\n') lines++
  }
  return { end: i + 1, lines }
}

function wordEnd(text: string, start: number): number {
  let i = start
  while (i < text.length && !isDelimiter(text[i])) i++
  return i
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let line = 1
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') {
      line++
      i++
    } else if (isSpace(ch)) i++
    else if (ch === '#') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (ch === ';' || ch === '{' || ch === '}') {
      tokens.push({ kind: ch, value: ch, start: i, end: i + 1, line })
      i++
    } else if (ch === '"' || ch === "'") {
      const quoted = quotedEnd(text, i)
      tokens.push({ kind: 'word', value: text.slice(i + 1, quoted.end - 1), start: i, end: quoted.end, line })
      line += quoted.lines
      i = quoted.end
    } else {
      const end = wordEnd(text, i)
      tokens.push({ kind: 'word', value: text.slice(i, end), start: i, end, line })
      i = end
    }
  }
  return tokens
}

function openingBrace(tokens: Token[], blockLine: number): number {
  const at = tokens.findIndex((token, i) =>
    token.kind === 'word' && token.value === 'server' && token.line === blockLine && tokens[i + 1]?.kind === '{' && tokens[i - 1]?.kind !== 'word')
  if (at < 0) throw new Error(`The site at line ${blockLine} was not found in this file. Check again.`)
  return at + 1
}

interface Directive {
  words: Token[]
  end: number
}

function topDirectives(tokens: Token[], open: number): Directive[] {
  const found: Directive[] = []
  let depth = 1
  let words: Token[] = []
  for (let i = open + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.kind === 'word') words.push(token)
    else if (token.kind === ';') {
      if (depth === 1 && words.length > 0) found.push({ words, end: token.end })
      words = []
    } else {
      depth += token.kind === '{' ? 1 : -1
      words = []
      if (depth === 0) return found
    }
  }
  throw new Error('The site block is not closed in this file.')
}

function certificateEdits(directives: Directive[]): Edit[] {
  return directives
    .filter(({ words }) => words[0].value === CERT || words[0].value === KEY)
    .map(({ words, end }) => ({ name: words[0].value, start: words[0].start, end }))
}

function onlyEdit(edits: Edit[], name: string): Edit {
  const found = edits.filter((edit) => edit.name === name)
  if (found.length === 0) throw new Error(`This site has no ${name} line to replace.`)
  if (found.length > 1) throw new Error(`This site has more than one ${name} line, so Shellway cannot tell which to replace.`)
  return found[0]
}

export function assertSafe(path: string): void {
  if (!SAFE_PATH.test(path)) throw new Error('The certificate path contains characters that are not allowed.')
}

function replaced(text: string, edit: Edit, path: string): string {
  const mark = CERTBOT_MARK.exec(text.slice(edit.end))
  return `${text.slice(0, edit.start)}${edit.name} ${path};${text.slice(edit.end + (mark?.[0].length ?? 0))}`
}

export function swapCertLines(fileText: string, blockLine: number, certPath: string, keyPath: string): { text: string; diff: DiffLine[] } {
  assertSafe(certPath)
  assertSafe(keyPath)
  const tokens = tokenize(fileText)
  const edits = certificateEdits(topDirectives(tokens, openingBrace(tokens, blockLine)))
  const targets = [{ edit: onlyEdit(edits, CERT), path: certPath }, { edit: onlyEdit(edits, KEY), path: keyPath }]
  const text = targets.sort((a, b) => b.edit.start - a.edit.start).reduce((current, { edit, path }) => replaced(current, edit, path), fileText)
  return { text, diff: changedLines(fileText, text) }
}

export interface BlockIdentity {
  names: string[]
  certPath: string
  keyPath: string
}

export function blockIdentity(fileText: string, blockLine: number): BlockIdentity {
  const tokens = tokenize(fileText)
  const directives = topDirectives(tokens, openingBrace(tokens, blockLine))
  const argsOf = (name: string) => directives.filter(({ words }) => words[0].value === name).map(({ words }) => words.slice(1).map((word) => word.value))
  return {
    names: [...new Set(argsOf('server_name').flat().filter(Boolean).map((name) => name.toLowerCase()))],
    certPath: argsOf(CERT)[0]?.[0] ?? '',
    keyPath: argsOf(KEY)[0]?.[0] ?? ''
  }
}
