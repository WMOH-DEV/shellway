import { describe, expect, it } from 'vitest'
import { TailBuffer } from '../../utils/sshExec'
import { MAX_STEP_OUTPUT, redact, StepOutput } from './StepOutput'

function collect(secrets: string[]) {
  const chunks: string[] = []
  const output = new StepOutput(secrets, (chunk) => chunks.push(chunk), 0)
  return { output, chunks }
}

describe('StepOutput', () => {
  it('redacts secrets, even when split across chunks', () => {
    const { output, chunks } = collect(['hunter22'])
    output.push('password is hun')
    output.push('ter22 ok\n')
    output.flush()
    expect(chunks.join('')).toBe('password is •••• ok\n')
    expect(output.text).toBe('password is •••• ok\n')
  })

  it('redacts the longest secret first and ignores empty ones', () => {
    expect(redact('abc abcdef', ['abc', 'abcdef'].sort((a, b) => b.length - a.length))).toBe('•••• ••••')
    const { output } = collect(['', 'x1'])
    output.push('ax1b')
    output.flush()
    expect(output.text).toBe('a••••b')
  })

  it('captures SHELLWAY_STATE lines across chunks', () => {
    const { output } = collect([])
    output.push('noise\nSHELLWAY_STATE back')
    output.push('up=/var/backups/x\r\nSHELLWAY_STATE created=1')
    output.flush()
    expect(output.state).toEqual({ backup: '/var/backups/x', created: '1' })
  })

  it('hides SHELLWAY_STATE lines from the output, even when split across chunks', () => {
    const { output, chunks } = collect([])
    output.push('nginx: test is successful\nSHELLWAY_STA')
    output.push('TE backup=/var/backups/x\r\nreloaded\nSHELLWAY_STATE created=1')
    output.flush()
    expect(output.text).toBe('nginx: test is successful\nreloaded\n')
    expect(chunks.join('')).toBe(output.text)
    expect(output.state).toEqual({ backup: '/var/backups/x', created: '1' })
  })

  it('shows partial lines right away unless they could be a state line', () => {
    const { output, chunks } = collect([])
    output.push('progress 10%')
    expect(chunks).toEqual(['progress 10%'])
    output.push(' SHELLWAY_STATE x=1\nSHELL')
    expect(chunks.join('')).toBe('progress 10% SHELLWAY_STATE x=1\n')
    output.push('S is fine\n')
    output.flush()
    expect(output.text).toBe('progress 10% SHELLWAY_STATE x=1\nSHELLS is fine\n')
  })

  it('keeps only the last 64 KB', () => {
    const { output } = collect([])
    output.push('a'.repeat(MAX_STEP_OUTPUT))
    output.push('tail')
    output.flush()
    expect(output.text).toHaveLength(MAX_STEP_OUTPUT)
    expect(output.text.endsWith('tail')).toBe(true)
  })

  it('coalesces chunks within the throttle window', async () => {
    const chunks: string[] = []
    const output = new StepOutput([], (chunk) => chunks.push(chunk), 20)
    output.push('a')
    output.push('b')
    expect(chunks).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(chunks).toEqual(['ab'])
    output.push('c')
    output.flush()
    expect(chunks).toEqual(['ab', 'c'])
  })
})

describe('TailBuffer', () => {
  it('keeps the tail and counts every byte', () => {
    const buffer = new TailBuffer(5)
    buffer.push(Buffer.from('abc'))
    buffer.push(Buffer.from('defg'))
    expect(buffer.toBuffer().toString()).toBe('cdefg')
    expect(buffer.total).toBe(7)
  })
})
