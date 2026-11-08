import { describe, expect, it } from 'vitest'
import { blockIdentity, swapCertLines } from './swapCertLines'

const CERT = '/etc/ssl/shellway/app.example.com-1800000000.pem'
const KEY = '/etc/ssl/shellway/app.example.com-1800000000.key'

const CERTBOT_BLOCK = [
  'server {',
  '    server_name app.example.com www.example.com;',
  '    listen 443 ssl; # managed by Certbot',
  '    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem; # managed by Certbot',
  '    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem; # managed by Certbot',
  '    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot',
  '    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot',
  '}'
]

const lines = (...parts: string[]) => `${parts.join('\n')}\n`

describe('swapCertLines', () => {
  it('replaces only the two certificate lines and keeps the include and dhparam lines', () => {
    const { text, diff } = swapCertLines(lines(...CERTBOT_BLOCK), 1, CERT, KEY)

    expect(text).toBe(lines(
      'server {',
      '    server_name app.example.com www.example.com;',
      '    listen 443 ssl; # managed by Certbot',
      `    ssl_certificate ${CERT};`,
      `    ssl_certificate_key ${KEY};`,
      '    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot',
      '    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot',
      '}'
    ))
    expect(diff.filter((line) => line.kind !== 'same').map((line) => [line.kind, line.oldLine, line.newLine, line.text])).toEqual([
      ['remove', 4, null, '    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem; # managed by Certbot'],
      ['remove', 5, null, '    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem; # managed by Certbot'],
      ['add', null, 4, `    ssl_certificate ${CERT};`],
      ['add', null, 5, `    ssl_certificate_key ${KEY};`]
    ])
  })

  it('shows three lines of context on each side with old and new line numbers', () => {
    const file = lines('# head 1', '# head 2', '# head 3', '# head 4', ...CERTBOT_BLOCK, '# tail 1', '# tail 2', '# tail 3', '# tail 4')
    const { diff } = swapCertLines(file, 5, CERT, KEY)

    expect(diff[0]).toEqual({ kind: 'same', oldLine: 5, newLine: 5, text: 'server {' })
    expect(diff.at(-1)).toEqual({ kind: 'same', oldLine: 12, newLine: 12, text: '}' })
    expect(diff.map((line) => line.text)).not.toContain('# head 4')
    expect(diff.map((line) => line.text)).not.toContain('# tail 1')
  })

  it('swaps only the block that starts at the given line when a file has two blocks', () => {
    const second = CERTBOT_BLOCK.map((line) => line.replaceAll('app.example.com', 'api.example.com'))
    const file = lines(...CERTBOT_BLOCK, '', ...second)

    const { text } = swapCertLines(file, 10, CERT, KEY)
    const rows = text.split('\n')

    expect(rows[3]).toContain('/etc/letsencrypt/live/app.example.com/fullchain.pem')
    expect(rows[12]).toBe(`    ssl_certificate ${CERT};`)
    expect(rows[13]).toBe(`    ssl_certificate_key ${KEY};`)
    expect(swapCertLines(file, 1, CERT, KEY).text.split('\n')[12]).toContain('api.example.com')
  })

  it('accepts the key line before the certificate line without mixing them up', () => {
    const file = lines('server {', '  ssl_certificate_key /k.pem;', '  ssl_certificate /c.pem;', '}')
    expect(swapCertLines(file, 1, CERT, KEY).text).toBe(lines('server {', `  ssl_certificate_key ${KEY};`, `  ssl_certificate ${CERT};`, '}'))
  })

  it('keeps tabs, CRLF line endings and a missing final newline', () => {
    const crlf = ['server {', '\tssl_certificate /c.pem; # managed by Certbot', '\tssl_certificate_key /k.pem;', '}'].join('\r\n')

    const { text, diff } = swapCertLines(crlf, 1, CERT, KEY)

    expect(text).toBe(['server {', `\tssl_certificate ${CERT};`, `\tssl_certificate_key ${KEY};`, '}'].join('\r\n'))
    expect(text.endsWith('\n')).toBe(false)
    expect(diff.every((line) => !line.text.includes('\r'))).toBe(true)
    expect(swapCertLines(`${crlf}\r\n`, 1, CERT, KEY).text.endsWith('}\r\n')).toBe(true)
  })

  it('ignores braces inside comments and quoted strings when finding the end of the block', () => {
    const file = lines(
      'server {',
      '    # } closes nothing',
      '    add_header X-Note "}";',
      '    location / { return 200; }',
      '    ssl_certificate /c.pem;',
      '    ssl_certificate_key /k.pem;',
      '}',
      'server {',
      '    ssl_certificate /other.pem;',
      '    ssl_certificate_key /other.key;',
      '}'
    )
    const { text } = swapCertLines(file, 1, CERT, KEY)
    expect(text).toContain(`    ssl_certificate ${CERT};`)
    expect(text).toContain('ssl_certificate /other.pem;')
  })

  it('ignores commented-out directives and ones nested in other blocks', () => {
    const file = lines(
      'server {',
      '    # ssl_certificate /old.pem;',
      '    ssl_certificate /c.pem;',
      '    ssl_certificate_key /k.pem;',
      '    location /x {',
      '        ssl_certificate /nested.pem;',
      '    }',
      '}'
    )
    const { text } = swapCertLines(file, 1, CERT, KEY)
    expect(text).toContain('# ssl_certificate /old.pem;')
    expect(text).toContain('ssl_certificate /nested.pem;')
    expect(text).toContain(`ssl_certificate ${CERT};`)
  })

  it('refuses a block with a missing or repeated certificate directive', () => {
    expect(() => swapCertLines(lines('server {', '  ssl_certificate_key /k.pem;', '}'), 1, CERT, KEY)).toThrow('no ssl_certificate line')
    expect(() => swapCertLines(lines('server {', '  ssl_certificate /c.pem;', '}'), 1, CERT, KEY)).toThrow('no ssl_certificate_key line')
    expect(() => swapCertLines(lines('server {', '  ssl_certificate /a.pem;', '  ssl_certificate /b.pem;', '  ssl_certificate_key /k.pem;', '}'), 1, CERT, KEY))
      .toThrow('more than one ssl_certificate line')
    expect(() => swapCertLines(lines('server {', '  ssl_certificate /a.pem;', '  ssl_certificate_key /k.pem;', '  ssl_certificate_key /l.pem;', '}'), 1, CERT, KEY))
      .toThrow('more than one ssl_certificate_key line')
  })

  it('refuses when the line does not start a server block or the block never closes', () => {
    expect(() => swapCertLines(lines(...CERTBOT_BLOCK), 3, CERT, KEY)).toThrow('was not found')
    expect(() => swapCertLines('server {\n  ssl_certificate /c.pem;\n  ssl_certificate_key /k.pem;\n', 1, CERT, KEY)).toThrow('not closed')
  })

  it('refuses certificate paths that could change the directive', () => {
    expect(() => swapCertLines(lines(...CERTBOT_BLOCK), 1, '/etc/x.pem; evil', KEY)).toThrow('not allowed')
    expect(() => swapCertLines(lines(...CERTBOT_BLOCK), 1, CERT, '/etc/x key')).toThrow('not allowed')
  })
})

describe('blockIdentity', () => {
  it('reads the names and certificate paths of the block that starts on the line', () => {
    const text = lines('server {', '  listen 80;', '}', ...CERTBOT_BLOCK, 'server {', '  server_name other.example.com;', '}')
    expect(blockIdentity(text, 4)).toEqual({
      names: ['app.example.com', 'www.example.com'],
      certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem',
      keyPath: '/etc/letsencrypt/live/app.example.com/privkey.pem'
    })
    expect(blockIdentity(text, 12)).toEqual({ names: ['other.example.com'], certPath: '', keyPath: '' })
  })

  it('merges repeated server_name lines, lowercases, and ignores nested locations', () => {
    const text = lines('server {', '  server_name App.example.com;', '  server_name www.example.com app.example.com;', '  location / {', '    server_name nested.example.com;', '  }', '}')
    expect(blockIdentity(text, 1).names).toEqual(['app.example.com', 'www.example.com'])
  })

  it('throws when no site starts on the line', () => {
    expect(() => blockIdentity(lines(...CERTBOT_BLOCK), 3)).toThrow('was not found')
  })
})
