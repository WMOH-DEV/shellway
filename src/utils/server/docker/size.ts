const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4
}

export function parseSize(text: string): number {
  const match = /^\s*([\d.]+)\s*([a-zA-Z]+)?/.exec(text)
  if (!match) return 0
  const factor = UNITS[(match[2] ?? 'b').toLowerCase()] ?? 0
  return Math.round(Number(match[1]) * factor)
}

const STEPS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatSize(bytes: number): string {
  let value = bytes
  let step = 0
  while (value >= 1000 && step < STEPS.length - 1) {
    value /= 1000
    step += 1
  }
  const digits = step === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${STEPS[step]}`
}
