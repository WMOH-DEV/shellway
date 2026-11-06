interface HintRule {
  matches: RegExp
  hint: (found: RegExpExecArray) => string
}

function challengeHint(found: RegExpExecArray): string {
  const status = found[1] ?? found[2]
  return `Let's Encrypt could not reach the challenge file (${status}). A Cloudflare rule or an nginx deny often blocks /.well-known/. Fix that, then run Test renewal.`
}

const RULES: HintRule[] = [
  {
    matches: /\b(403|404)\b[^\n]*(?:acme-challenge|\.well-known)|(?:acme-challenge|\.well-known)[^\n]*\b(403|404)\b/i,
    hint: challengeHint
  },
  {
    matches: /DNS problem|NXDOMAIN|no valid A records|SERVFAIL|Could not resolve host/i,
    hint: () => 'The name does not point to this server. Check its DNS record, then run Test renewal.'
  },
  {
    matches: /too many (certificates|failed authorizations|requests)|rate ?limit/i,
    hint: () => "This is a Let's Encrypt rate limit. Wait before retrying."
  },
  {
    matches: /Timeout during connect|Connection refused|Connection timed out/i,
    hint: () => "Let's Encrypt could not connect to this server on port 80. Check the firewall and that nginx is listening."
  }
]

export function renewalHint(output: string): string | null {
  for (const rule of RULES) {
    const found = rule.matches.exec(output)
    if (found) return rule.hint(found)
  }
  return null
}
