import { spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { FileNameSearchRequest, TextSearchRequest } from '../../../src/types/search'
import { FILE_LIMITS, TEXT_LIMITS, buildFileNameCommand, buildTextCommand } from './remoteCommands'
import { createLineSplitter, makeMatcher, parseEngineMarker, parseFileLines, parseGrepLine, parseRgJsonLine } from './rgJsonParser'

const fileReq = (overrides: Partial<FileNameSearchRequest> = {}): FileNameSearchRequest => ({
  connectionId: 'c1',
  root: '/var/www/shop',
  text: 'Order',
  excludes: [],
  ...overrides
})

const textReq = (overrides: Partial<TextSearchRequest> = {}): TextSearchRequest => ({
  connectionId: 'c1',
  root: '/var/www/shop',
  text: 'OrderRefunded',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  includes: [],
  excludes: [],
  ...overrides
})

describe('buildFileNameCommand', () => {
  it('limits depth, time and result count', () => {
    const { script } = buildFileNameCommand(fileReq())
    expect(script.startsWith("cd '/var/www/shop' && exec timeout -k 2 8 sh -c ")).toBe(true)
    expect(script).toContain(`--max-depth ${FILE_LIMITS.maxDepth}`)
    expect(script).toContain(`-maxdepth ${FILE_LIMITS.maxDepth}`)
    expect(script).toContain(`head -n ${FILE_LIMITS.maxResults}`)
  })

  it('offers fd, fdfind and a find fallback', () => {
    const { script } = buildFileNameCommand(fileReq())
    expect(script).toContain('command -v fd ')
    expect(script).toContain('command -v fdfind ')
    expect(script).toContain('find . ')
  })

  it('turns excludes into fd excludes and find prunes', () => {
    const { script } = buildFileNameCommand(fileReq({ excludes: ['vendor', 'node_modules'] }))
    expect(script).toContain("--exclude '\\''vendor'\\''")
    expect(script).toContain("-name '\\''vendor'\\'' -o -name '\\''node_modules'\\''")
    expect(script).toContain('-prune -o -type f')
  })

  it('escapes glob metacharacters in the text', () => {
    const { script } = buildFileNameCommand(fileReq({ text: 'a*b?[c]{d}\\e' }))
    expect(script).toContain('*a\\*b\\?\\[c\\]\\{d\\}\\\\e*')
  })

  it('describes the command for the footer', () => {
    expect(buildFileNameCommand(fileReq()).display).toBe("fd -i -g '*Order*' in /var/www/shop")
  })

  it('searches the home folder with full paths when no root is given', () => {
    const { script, display } = buildFileNameCommand(fileReq({ root: undefined }))
    expect(script.startsWith('exec timeout -k 2 8 sh -c ')).toBe(true)
    expect(script).not.toContain('cd ')
    expect(script).toContain('find "$HOME" ')
    expect(script).toContain(`--max-depth ${FILE_LIMITS.maxDepth}`)
    expect(script).toMatch(/--glob '\\''\*Order\*'\\'' "\$HOME"/)
    expect(display).toBe("fd -i -g '*Order*' in ~")
  })

  it.each([
    ['relative root', { root: 'var/www' }],
    ['empty root', { root: '' }],
    ['root with a newline', { root: '/var/www\n/x' }],
    ['root with a NUL', { root: '/var/www\0' }],
    ['overlong root', { root: `/${'a'.repeat(1024)}` }],
    ['empty text', { text: '' }],
    ['overlong text', { text: 'a'.repeat(501) }],
    ['text with a newline', { text: 'a\nb' }],
    ['text with a NUL', { text: 'a\0b' }],
    ['glob with a quote', { excludes: ["a'b"] }],
    ['glob with a newline', { excludes: ['a\nb'] }],
    ['overlong glob', { excludes: ['a'.repeat(201)] }],
    ['too many globs', { excludes: Array.from({ length: 51 }, (_, i) => `g${i}`) }]
  ])('rejects %s', (_label, overrides) => {
    expect(() => buildFileNameCommand(fileReq(overrides))).toThrow(/^Invalid /)
  })
})

describe('buildTextCommand', () => {
  it('prefers rg with JSON output and falls back to grep', () => {
    const { script, engine } = buildTextCommand(textReq())
    expect(engine).toBe('rg')
    expect(script.startsWith("cd '/var/www/shop' && exec timeout -k 2 20 sh -c ")).toBe(true)
    expect(script).toContain('@@engine rg')
    expect(script).toContain('@@engine grep')
    expect(script).toContain(`--json --no-messages --max-columns ${TEXT_LIMITS.maxColumns}`)
    expect(script).toContain('grep -rnIs')
  })

  it('maps the options onto both engines', () => {
    const insensitive = buildTextCommand(textReq()).script
    expect(insensitive).toContain(' -i ')
    expect(insensitive).toContain(' -F ')

    const strict = buildTextCommand(textReq({ caseSensitive: true, wholeWord: true, regex: true })).script
    expect(strict).toContain(' -s ')
    expect(strict).toContain(' -w ')
    expect(strict).toContain(' -E ')
    expect(strict).not.toContain(' -F ')
    expect(strict).not.toContain(' -i ')
  })

  it('turns includes and excludes into rg globs and grep flags', () => {
    const { script } = buildTextCommand(textReq({ includes: ['*.php'], excludes: ['vendor'] }))
    expect(script).toContain("--glob '\\''*.php'\\''")
    expect(script).toContain("--glob '\\''!vendor'\\''")
    expect(script).toContain("--include='\\''*.php'\\''")
    expect(script).toContain("--exclude-dir='\\''vendor'\\''")
  })

  it('describes the command for the footer', () => {
    expect(buildTextCommand(textReq()).display).toBe("rg --json -i -F 'OrderRefunded' /var/www/shop")
  })

  it.each([
    ['relative root', { root: 'www' }],
    ['empty text', { text: '' }],
    ['text with a newline', { text: 'a\nb' }],
    ['include with a quote', { includes: ["*.php'"] }],
    ['too many excludes', { excludes: Array.from({ length: 51 }, (_, i) => `g${i}`) }]
  ])('rejects %s', (_label, overrides) => {
    expect(() => buildTextCommand(textReq(overrides))).toThrow(/^Invalid /)
  })
})

describe('commands run in a real shell', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'shellway-search-'))
  const shim = join(sandbox, 'bin')
  const root = join(sandbox, 'shop')
  mkdirSync(shim)
  mkdirSync(join(root, 'app'), { recursive: true })
  mkdirSync(join(root, 'vendor'))
  writeFileSync(join(shim, 'timeout'), '#!/bin/sh\nshift 3\nexec "$@"\n')
  chmodSync(join(shim, 'timeout'), 0o755)
  writeFileSync(join(root, 'app', 'Orders.php'), '<?php\nclass OrderRefunded {}\n')
  writeFileSync(join(root, 'vendor', 'Orders.php'), 'class OrderRefunded {}\n')

  const run = (script: string) =>
    spawnSync('sh', ['-c', script], { encoding: 'utf8', env: { PATH: `${shim}:/usr/bin:/bin` } })

  const rootFor = (overrides: object) => ({ root, ...overrides })

  it('finds files by name and honours excludes', () => {
    const { script } = buildFileNameCommand(fileReq(rootFor({ text: 'orders', excludes: ['vendor'] })))
    const out = run(script).stdout.split('\n')
    expect(parseFileLines(out, root)).toEqual([join(root, 'app', 'Orders.php')])
  })

  it('finds text and reports the engine on the first line', () => {
    const { script } = buildTextCommand(textReq(rootFor({ excludes: ['vendor'] })))
    const lines = createLineSplitter().push(run(script).stdout)
    const engine = parseEngineMarker(lines[0])
    const matcher = makeMatcher('OrderRefunded', { caseSensitive: false, wholeWord: false, regex: false })
    const matches = lines
      .slice(1)
      .map((line) => (engine === 'rg' ? parseRgJsonLine(line, root) : parseGrepLine(line, root, matcher)))
      .filter((match) => match !== null)
    expect(matches).toEqual([
      expect.objectContaining({ path: join(root, 'app', 'Orders.php'), line: 2, text: 'class OrderRefunded {}' })
    ])
  })

  it('never executes shell syntax hidden in the search text', () => {
    const hostile = `'; touch ${join(sandbox, 'PWNED')} #`
    run(buildFileNameCommand(fileReq(rootFor({ text: hostile }))).script)
    run(buildTextCommand(textReq(rootFor({ text: hostile, regex: true }))).script)
    const substitution = `$(touch ${join(sandbox, 'PWNED')}) \`touch ${join(sandbox, 'PWNED')}\``
    run(buildTextCommand(textReq(rootFor({ text: 'x', includes: [substitution], excludes: [substitution] }))).script)
    run(buildFileNameCommand(fileReq(rootFor({ excludes: [substitution] }))).script)
    expect(existsSync(join(sandbox, 'PWNED'))).toBe(false)
  })

  it('reports a missing root on stderr with no output', () => {
    const result = run(buildFileNameCommand(fileReq({ root: join(sandbox, 'missing') })).script)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
  })
})
