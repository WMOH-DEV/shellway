export interface HintContext {
  action: 'renewal' | 'issue'
  webServer: 'nginx' | 'apache'
}

interface HintRule {
  matches: RegExp
  hint: (found: RegExpExecArray, context: HintContext) => string
}

const DEFAULT_CONTEXT: HintContext = { action: 'renewal', webServer: 'nginx' }

const nextStep = ({ action }: HintContext): string => (action === 'issue' ? 'then issue again' : 'then run Test renewal')

const serverName = ({ webServer }: HintContext): string => (webServer === 'apache' ? 'Apache' : 'nginx')

const serverBlock = ({ webServer }: HintContext): string => (webServer === 'apache' ? 'an Apache .htaccess/deny rule' : 'an nginx deny')

function challengeHint(found: RegExpExecArray, context: HintContext): string {
  const status = found[1] ?? found[2]
  return `Let's Encrypt could not reach the challenge file (${status}). A Cloudflare rule or ${serverBlock(context)} often blocks /.well-known/. Fix that, ${nextStep(context)}.`
}

const RULES: HintRule[] = [
  {
    matches: /\b(403|404)\b[^\n]*(?:acme-challenge|\.well-known)|(?:acme-challenge|\.well-known)[^\n]*\b(403|404)\b/i,
    hint: challengeHint
  },
  {
    matches: /DNS problem|NXDOMAIN|no valid A records|SERVFAIL|Could not resolve host/i,
    hint: (_found, context) => `The name does not point to this server. Check its DNS record, ${nextStep(context)}.`
  },
  {
    matches: /too many (certificates|failed authorizations|requests)|rate ?limit/i,
    hint: () => "This is a Let's Encrypt rate limit. Wait before retrying."
  },
  {
    matches: /Timeout during connect|Connection refused|Connection timed out/i,
    hint: (_found, context) => `Let's Encrypt could not connect to this server on port 80. Check the firewall and that ${serverName(context)} is listening.`
  }
]

export function renewalHint(output: string, context: HintContext = DEFAULT_CONTEXT): string | null {
  for (const rule of RULES) {
    const found = rule.matches.exec(output)
    if (found) return rule.hint(found, context)
  }
  return null
}
