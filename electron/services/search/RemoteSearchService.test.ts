import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileNameSearchRequest, RemoteSearchEvent, TextSearchRequest } from '../../../src/types/search'
import { ExecAbortedError } from '../../utils/sshExec'
import type { ExecOptions, ExecResult } from '../../utils/sshExec'
import { RemoteSearchService } from './RemoteSearchService'

interface FakeRun {
  command: string
  options: ExecOptions
  out(chunk: string): void
  close(result?: Partial<ExecResult>): void
  fail(error: Error): void
}

function setup(connected = true) {
  const runs: FakeRun[] = []
  const events: RemoteSearchEvent[] = []
  let nextId = 0
  const service = new RemoteSearchService({
    execFor: () =>
      connected
        ? (command, options = {}) =>
            new Promise<ExecResult>((resolve, reject) => {
              options.signal?.addEventListener('abort', () => reject(new ExecAbortedError('aborted')))
              runs.push({
                command,
                options,
                out: (chunk) => options.onOutput?.(chunk),
                close: (result = {}) => resolve({ stdout: '', stdoutBytes: 0, stderr: '', code: 0, ...result }),
                fail: reject
              })
            })
        : null,
    send: (event) => events.push(event),
    newId: () => `s${++nextId}`,
    batchMs: 100
  })
  return { service, runs, events }
}

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

const rgMatch = (n: number) =>
  `${JSON.stringify({
    type: 'match',
    data: {
      path: { text: `./f${n}.php` },
      lines: { text: 'OrderRefunded\n' },
      line_number: n,
      submatches: [{ start: 0, end: 13 }]
    }
  })}\n`

const kinds = (events: RemoteSearchEvent[]) => events.map((e) => e.kind)

describe('RemoteSearchService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('throws when the connection is not active and starts nothing', () => {
    const { service, events } = setup(false)
    expect(() => service.findFiles(fileReq())).toThrow('Not connected')
    expect(() => service.findText(textReq())).toThrow('Not connected')
    expect(events).toEqual([])
  })

  it('validates the request before touching the connection', () => {
    const { service, runs } = setup()
    expect(() => service.findFiles(fileReq({ root: 'relative' }))).toThrow('Invalid root')
    expect(runs).toHaveLength(0)
  })

  it('returns the search id and a readable command', () => {
    const { service } = setup()
    expect(service.findFiles(fileReq())).toEqual({ searchId: 's1', command: "fd -i -g '*Order*' in /var/www/shop" })
  })

  it('batches streamed file paths and finishes with one done event', async () => {
    const { service, runs, events } = setup()
    service.findFiles(fileReq())
    runs[0].out('./a/One.php\n./a/Tw')
    runs[0].out('o.php\n')
    expect(events).toEqual([])

    vi.advanceTimersByTime(100)
    expect(events).toEqual([{ searchId: 's1', kind: 'files', paths: ['/var/www/shop/a/One.php', '/var/www/shop/a/Two.php'] }])

    runs[0].out('./Three.php\n')
    runs[0].close()
    await vi.advanceTimersByTimeAsync(0)
    expect(events.slice(1)).toEqual([
      { searchId: 's1', kind: 'files', paths: ['/var/www/shop/Three.php'] },
      { searchId: 's1', kind: 'done', truncated: false, timedOut: false }
    ])
  })

  it('flushes a last line that has no trailing newline', async () => {
    const { service, runs, events } = setup()
    service.findFiles(fileReq())
    runs[0].out('./Last.php')
    runs[0].close()
    await vi.advanceTimersByTimeAsync(0)
    expect(events[0]).toEqual({ searchId: 's1', kind: 'files', paths: ['/var/www/shop/Last.php'] })
  })

  it('stops file searches at the result cap', async () => {
    const { service, runs, events } = setup()
    service.findFiles(fileReq())
    runs[0].out(Array.from({ length: 250 }, (_, i) => `./f${i}.php\n`).join(''))
    await vi.advanceTimersByTimeAsync(0)
    const paths = events.flatMap((e) => (e.kind === 'files' ? e.paths : []))
    expect(paths).toHaveLength(200)
    expect(events[events.length - 1]).toEqual({ searchId: 's1', kind: 'done', truncated: true, timedOut: false })
    expect(runs[0].options.signal?.aborted).toBe(true)
  })

  it('streams text matches from rg JSON once the engine marker arrives', async () => {
    const { service, runs, events } = setup()
    service.findText(textReq())
    runs[0].out(`@@engine rg\n${JSON.stringify({ type: 'begin', data: {} })}\n${rgMatch(1)}`)
    runs[0].out(`${JSON.stringify({ type: 'summary', data: {} })}\n`)
    runs[0].close()
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual([
      {
        searchId: 's1',
        kind: 'text',
        matches: [{ path: '/var/www/shop/f1.php', line: 1, text: 'OrderRefunded', ranges: [[0, 13]] }]
      },
      { searchId: 's1', kind: 'done', truncated: false, timedOut: false }
    ])
  })

  it('parses grep output when the server has no rg', async () => {
    const { service, runs, events } = setup()
    service.findText(textReq())
    runs[0].out('@@engine grep\n./app/Orders.php:7:class OrderRefunded {}\n')
    runs[0].close()
    await vi.advanceTimersByTimeAsync(0)
    expect(events[0]).toEqual({
      searchId: 's1',
      kind: 'text',
      matches: [{ path: '/var/www/shop/app/Orders.php', line: 7, text: 'class OrderRefunded {}', ranges: [[6, 19]] }]
    })
  })

  it('stops at the match cap and reports truncated', async () => {
    const { service, runs, events } = setup()
    service.findText(textReq())
    runs[0].out(`@@engine rg\n${Array.from({ length: 2100 }, (_, i) => rgMatch(i + 1)).join('')}`)
    await vi.advanceTimersByTimeAsync(0)
    const matches = events.flatMap((e) => (e.kind === 'text' ? e.matches : []))
    expect(matches).toHaveLength(2000)
    expect(events.filter((e) => e.kind === 'done')).toEqual([
      { searchId: 's1', kind: 'done', truncated: true, timedOut: false }
    ])
    expect(runs[0].options.signal?.aborted).toBe(true)
  })

  it('reports exit 124 as a timeout and keeps what was found', async () => {
    const { service, runs, events } = setup()
    service.findText(textReq())
    runs[0].out(`@@engine rg\n${rgMatch(1)}`)
    runs[0].close({ code: 124 })
    await vi.advanceTimersByTimeAsync(0)
    expect(kinds(events)).toEqual(['text', 'done'])
    expect(events[1]).toMatchObject({ truncated: false, timedOut: true })
    expect(events[1]).not.toHaveProperty('error')
  })

  it('treats exit 1 with no output as no matches, not an error', async () => {
    const { service, runs, events } = setup()
    service.findText(textReq())
    runs[0].out('@@engine rg\n')
    runs[0].close({ code: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual([{ searchId: 's1', kind: 'done', truncated: false, timedOut: false }])
  })

  it('uses the first stderr line as the error when nothing was found', async () => {
    const { service, runs, events } = setup()
    service.findText(textReq({ regex: true, text: '(' }))
    runs[0].out('@@engine rg\n')
    runs[0].close({ code: 2, stderr: 'regex parse error:\n  (\nunclosed group\n' })
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual([
      { searchId: 's1', kind: 'done', truncated: false, timedOut: false, error: 'regex parse error:' }
    ])
  })

  it('reports an unreadable root through stderr', async () => {
    const { service, runs, events } = setup()
    service.findFiles(fileReq())
    runs[0].close({ code: 1, stderr: "sh: 1: cd: can't cd to /var/www/shop\n" })
    await vi.advanceTimersByTimeAsync(0)
    expect(events[0]).toMatchObject({ kind: 'done', error: "sh: 1: cd: can't cd to /var/www/shop" })
  })

  it('reports a failed exec as an error', async () => {
    const { service, runs, events } = setup()
    service.findFiles(fileReq())
    runs[0].fail(new Error('SSH connection is not active'))
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual([
      { searchId: 's1', kind: 'done', truncated: false, timedOut: false, error: 'SSH connection is not active' }
    ])
  })

  it('aborts the running search on the same connection when a new one starts', async () => {
    const { service, runs, events } = setup()
    service.findFiles(fileReq())
    runs[0].out('./Old.php\n')
    service.findFiles(fileReq({ text: 'Invoice' }))
    await vi.advanceTimersByTimeAsync(0)

    expect(runs[0].options.signal?.aborted).toBe(true)
    expect(runs[1].options.signal?.aborted).toBe(false)
    expect(events).toEqual([{ searchId: 's1', kind: 'done', truncated: false, timedOut: false }])

    runs[1].out('./Invoice.php\n')
    runs[1].close()
    await vi.advanceTimersByTimeAsync(0)
    expect(events.filter((e) => e.searchId === 's2').map((e) => e.kind)).toEqual(['files', 'done'])
  })

  it('does not abort searches on other connections', () => {
    const { service, runs } = setup()
    service.findFiles(fileReq({ connectionId: 'c1' }))
    service.findFiles(fileReq({ connectionId: 'c2' }))
    expect(runs[0].options.signal?.aborted).toBe(false)
  })

  it('cancel sends exactly one done event and no later batches', async () => {
    const { service, runs, events } = setup()
    const { searchId } = service.findFiles(fileReq())
    runs[0].out('./Pending.php\n')
    service.cancel(searchId)
    runs[0].out('./Late.php\n')
    vi.advanceTimersByTime(500)
    await vi.advanceTimersByTimeAsync(0)
    runs[0].close()
    await vi.advanceTimersByTimeAsync(0)

    expect(events).toEqual([{ searchId: 's1', kind: 'done', truncated: false, timedOut: false }])
    expect(runs[0].options.signal?.aborted).toBe(true)
  })

  it('ignores cancel for unknown or finished searches', async () => {
    const { service, runs, events } = setup()
    service.cancel('nope')
    const { searchId } = service.findFiles(fileReq())
    runs[0].close()
    await vi.advanceTimersByTimeAsync(0)
    service.cancel(searchId)
    expect(events).toHaveLength(1)
  })

  it('wraps every search in a timeout with a larger transport deadline', () => {
    const { service, runs } = setup()
    service.findText(textReq())
    expect(runs[0].command).toContain('timeout -k 2 20 ')
    expect(runs[0].options.timeoutMs).toBeGreaterThan(20_000)
  })

  describe('preview', () => {
    const previewRun = (stdout: string, stderr = '') => {
      const exec = vi.fn(async (_command: string) => ({ stdout, stdoutBytes: stdout.length, stderr, code: 0 }))
      const service = new RemoteSearchService({
        execFor: () => exec,
        send: () => undefined,
        newId: () => 'x'
      })
      return { service, exec }
    }

    it('numbers the returned lines from the first requested line', async () => {
      const { service, exec } = previewRun('a\nb\r\nc\n')
      const lines = await service.preview('c1', '/var/www/shop/app/Orders.php', 12, 2)
      expect(lines).toEqual([
        { line: 10, text: 'a' },
        { line: 11, text: 'b' },
        { line: 12, text: 'c' }
      ])
      expect(exec.mock.calls[0][0]).toBe("timeout 5 sed -n '10,14p;14q' -- '/var/www/shop/app/Orders.php' | cut -c1-400")
    })

    it('never asks for lines before 1', async () => {
      const { service, exec } = previewRun('x\n')
      await service.preview('c1', '/a.php', 2, 5)
      expect(exec.mock.calls[0][0]).toContain("sed -n '1,7p;7q'")
    })

    it('escapes the path', async () => {
      const { service, exec } = previewRun('x\n')
      await service.preview('c1', "/tmp/it's.php", 1, 0)
      expect(exec.mock.calls[0][0]).toContain("-- '/tmp/it'\\''s.php'")
    })

    it('throws the stderr line when nothing came back', async () => {
      const { service } = previewRun('', 'sed: cannot read: No such file\n')
      await expect(service.preview('c1', '/a.php', 1, 0)).rejects.toThrow('sed: cannot read: No such file')
    })

    it.each([
      ['relative path', 'a.php', 1, 1],
      ['path with a newline', '/a\n.php', 1, 1],
      ['line 0', '/a.php', 0, 1],
      ['fractional line', '/a.php', 1.5, 1],
      ['negative context', '/a.php', 1, -1],
      ['context over 20', '/a.php', 1, 21]
    ])('rejects %s', async (_label, path, line, context) => {
      const { service, exec } = previewRun('x\n')
      await expect(service.preview('c1', path, line, context)).rejects.toThrow(/^Invalid /)
      expect(exec).not.toHaveBeenCalled()
    })

    it('throws when the connection is not active', async () => {
      const { service } = setup(false)
      await expect(service.preview('c1', '/a.php', 1, 1)).rejects.toThrow('Not connected')
    })
  })
})
