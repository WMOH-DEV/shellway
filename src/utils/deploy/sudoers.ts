const SUDOERS_SPECIAL = /[\\,:=]/g

export function sudoersLine(user: string, commands: string[]): string {
  const escaped = commands.map((c) => c.replace(SUDOERS_SPECIAL, (ch) => `\\${ch}`))
  return `${user} ALL=(root) NOPASSWD: ${escaped.join(', ')}`
}
