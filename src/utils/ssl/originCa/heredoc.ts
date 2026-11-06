export const randomToken = (): string => `SHELLWAY_${globalThis.crypto.randomUUID().replace(/-/g, '')}`

export function heredoc(body: string, newToken: () => string = randomToken): string {
  let token = newToken()
  while (body.includes(token)) token = newToken()
  const text = body.endsWith('\n') ? body : `${body}\n`
  return `<<'${token}'\n${text}${token}\n`
}
