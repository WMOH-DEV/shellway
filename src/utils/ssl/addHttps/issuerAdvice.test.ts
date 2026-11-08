import { describe, expect, it } from 'vitest'
import { edgeOf, makeHost, unknownEdge } from '../testReport'
import { certbotLikelyFails } from './issuerAdvice'
import { failCheck, okCheck, readinessRow } from './testFixtures'

const closed = (name: string) => readinessRow(name, { port80: failCheck('no answer on port 80 within 5 seconds') })
const open = (name: string) => readinessRow(name, { port80: okCheck('answers on port 80') })
const unsure = (name: string) => readinessRow(name, { port80: { state: 'unknown', detail: 'port 80 answered with status 503' } })
const proxied = (name: string) => makeHost({ name })
const direct = (name: string) => makeHost({ name, edge: edgeOf({ state: 'dns-only' }) })
const unseen = (name: string) => makeHost({ name, edge: unknownEdge })

describe('certbotLikelyFails', () => {
  const A = 'app.example.com'
  const B = 'www.example.com'

  it.each([
    { label: 'no names', names: [], readiness: [], hosts: [], expected: false },
    { label: 'port 80 closed and proxied', names: [A], readiness: [closed(A)], hosts: [proxied(A)], expected: true },
    { label: 'port 80 open and proxied', names: [A], readiness: [open(A)], hosts: [proxied(A)], expected: false },
    { label: 'port 80 closed but not proxied', names: [A], readiness: [closed(A)], hosts: [direct(A)], expected: false },
    { label: 'port 80 closed but edge unknown', names: [A], readiness: [closed(A)], hosts: [unseen(A)], expected: false },
    { label: 'port 80 closed but name missing from the report', names: [A], readiness: [closed(A)], hosts: [], expected: false },
    { label: 'port 80 not checked yet', names: [A], readiness: [], hosts: [proxied(A)], expected: false },
    { label: 'port 80 unsure', names: [A], readiness: [unsure(A)], hosts: [proxied(A)], expected: false },
    { label: 'every name closed and proxied', names: [A, B], readiness: [closed(A), closed(B)], hosts: [proxied(A), proxied(B)], expected: true },
    { label: 'one name still open', names: [A, B], readiness: [closed(A), open(B)], hosts: [proxied(A), proxied(B)], expected: false },
    { label: 'one name not proxied', names: [A, B], readiness: [closed(A), closed(B)], hosts: [proxied(A), direct(B)], expected: false }
  ])('$label -> $expected', ({ names, readiness, hosts, expected }) => {
    expect(certbotLikelyFails(names, readiness, hosts)).toBe(expected)
  })
})
