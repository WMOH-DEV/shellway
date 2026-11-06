import http from 'node:http'
import https from 'node:https'

export interface HttpAnswer {
  status: number
}

export type HttpGet = (url: string, timeoutMs: number) => Promise<HttpAnswer>

export const TIMEOUT_CODE = 'ETIMEDOUT'

export function errorCode(err: unknown): string {
  return (err as NodeJS.ErrnoException).code ?? ''
}

export const httpGet: HttpGet = (url, timeoutMs) =>
  new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const request = client.get(url, (response) => {
      clearTimeout(timer)
      response.destroy()
      resolve({ status: response.statusCode ?? 0 })
    })
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('timed out'), { code: TIMEOUT_CODE })), timeoutMs)
    request.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
