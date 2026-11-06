import type { OutputSink } from '../SslService'

export interface OutputLog {
  write: OutputSink
  text: () => string
}

export function teeOutput(sink: OutputSink): OutputLog {
  const chunks: string[] = []
  return {
    write: (chunk) => {
      chunks.push(chunk)
      sink(chunk)
    },
    text: () => chunks.join('')
  }
}
