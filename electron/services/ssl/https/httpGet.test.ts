import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { errorCode, httpGet, TIMEOUT_CODE } from './httpGet'

let server: http.Server | null = null

function listen(handler: http.RequestListener): Promise<number> {
  server = http.createServer(handler)
  return new Promise((resolve) => server!.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port)))
}

afterEach(() => new Promise<void>((resolve) => {
  if (!server) return resolve()
  server.closeAllConnections()
  server.close(() => resolve())
  server = null
}))

describe('httpGet', () => {
  it('returns the status without following a redirect', async () => {
    const port = await listen((_req, res) => res.writeHead(301, { location: 'https://example.com/' }).end())
    expect(await httpGet(`http://127.0.0.1:${port}/x`, 2000)).toEqual({ status: 301 })
  })

  it('fails with the timeout code when the server does not answer', async () => {
    const port = await listen(() => {})
    const failure = await httpGet(`http://127.0.0.1:${port}/`, 100).catch((err) => err)
    expect(errorCode(failure)).toBe(TIMEOUT_CODE)
  })

  it('fails with the refused code when nothing listens', async () => {
    const port = await listen((_req, res) => res.end())
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    const failure = await httpGet(`http://127.0.0.1:${port}/`, 2000).catch((err) => err)
    expect(errorCode(failure)).toBe('ECONNREFUSED')
  })
})
