const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function formatDay(epochSeconds: number, withYear = false): string {
  const date = new Date(epochSeconds * 1000)
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`
  return withYear ? `${day}, ${date.getFullYear()}` : day
}

export function formatDateTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${formatDay(epochSeconds)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
