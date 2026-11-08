import type { ApacheLayout } from '../../types/ssl'
import type { DirectoryRule } from '../webServer/apache/sites'
import { isInside, trimSlash, type WebServerCheck, type WebServerSite } from '../webServer/siteFolder'
import type { SiteConfig } from '../../types/deploy'
import type { ReadyItem } from './readyCheck'

type LinkState = 'follow' | 'owner-match' | 'off' | 'unset'
type OverrideState = 'allowed' | 'denied' | 'unset'


function coveringRules(directories: DirectoryRule[], documentRoot: string): DirectoryRule[] {
  return directories.filter((rule) => isInside(documentRoot, rule.path)).sort((a, b) => trimSlash(a.path).length - trimSlash(b.path).length)
}

function applyOptions(state: Map<string, boolean>, options: string[]): void {
  const words = options.map((option) => option.toLowerCase())
  if (words.some((word) => !word.startsWith('+') && !word.startsWith('-'))) {
    const all = words.includes('all')
    state.set('followsymlinks', all || words.includes('followsymlinks'))
    state.set('symlinksifownermatch', all || words.includes('symlinksifownermatch'))
    return
  }
  for (const word of words) state.set(word.slice(1), word.startsWith('+'))
}

export function linkState(directories: DirectoryRule[], documentRoot: string): LinkState {
  const state = new Map<string, boolean>()
  for (const rule of coveringRules(directories, documentRoot)) if (rule.options.length > 0) applyOptions(state, rule.options)
  const follow = state.get('followsymlinks')
  if (follow === true) return 'follow'
  if (follow === undefined) return 'unset'
  return state.get('symlinksifownermatch') ? 'owner-match' : 'off'
}

export function overrideState(directories: DirectoryRule[], documentRoot: string): OverrideState {
  const last = coveringRules(directories, documentRoot).filter((rule) => rule.allowOverride.length > 0).pop()
  if (!last) return 'unset'
  const words = last.allowOverride.map((word) => word.toLowerCase())
  return words.includes('all') || words.some((word) => word.startsWith('fileinfo')) ? 'allowed' : 'denied'
}

const pass = (id: ReadyItem['id'], title: string, detail: string): ReadyItem => ({ id, title, detail, required: false, status: 'pass', code: null, actions: [] })

const warn = (id: ReadyItem['id'], title: string, detail: string, code: string | null = null): ReadyItem =>
  ({ id, title, detail, required: false, status: 'fail', code, actions: code ? ['copy'] : [] })

function siteItem(sitePath: string, check: WebServerCheck): ReadyItem {
  const [first] = check.sites
  if (first) return pass('web-site', `Apache serves ${first.names[0] ?? first.file} from ${first.detail.documentRoot}`, first.file)
  const unread = check.read === 'full' ? '' : ' Shellway could not read every Apache file, so it may be in one it could not read.'
  return warn('web-site', `No Apache site serves ${sitePath}`, `Point a site's DocumentRoot at ${sitePath} or a folder inside it, such as ${trimSlash(sitePath)}/public.${unread}`)
}

const directoryBlock = (path: string, line: string): string => `<Directory ${path}>\n    ${line}\n</Directory>`

function symlinkItem(site: WebServerSite, sitePath: string): ReadyItem {
  const root = site.detail.documentRoot ?? sitePath
  const state = linkState(site.detail.directories, root)
  const fix = directoryBlock(trimSlash(sitePath), 'Options FollowSymLinks')
  if (state === 'follow') return pass('web-symlinks', 'Apache follows the link to the current release', site.file)
  if (state === 'unset') return pass('web-symlinks', 'Links are not turned off in this site', `${site.file} does not change Options. Apache follows links unless its main configuration turns that off.`)
  if (state === 'owner-match') {
    return warn('web-symlinks', 'Apache follows links only when the owners match', `${sitePath} links to a release that can have a different owner, so Apache may refuse it. Add this to ${site.file}:`, fix)
  }
  return warn('web-symlinks', 'Apache will not follow the link to the current release', `${sitePath} is a link to the current release. Add this to ${site.file}:`, fix)
}

const enableRewrite = (layout: ApacheLayout | null): string | null => (layout === 'rhel' ? null : 'sudo a2enmod rewrite && sudo systemctl reload apache2')

function rewriteItem(site: WebServerSite, check: WebServerCheck): ReadyItem {
  if (check.rewriteModule === false) {
    return warn('web-rewrite', 'mod_rewrite is not enabled', 'Rewrite rules in the site file or in .htaccess do nothing without it.', enableRewrite(check.layout))
  }
  const root = site.detail.documentRoot ?? ''
  if (site.detail.rewriteEngine) return pass('web-rewrite', 'Rewrite rules are set in the site file', site.file)
  const state = overrideState(site.detail.directories, root)
  if (state === 'allowed') return pass('web-rewrite', 'Rewrite rules in .htaccess work', `AllowOverride lets ${root}/.htaccess set them`)
  const fix = directoryBlock(root, 'AllowOverride All')
  if (state === 'denied') {
    return warn('web-rewrite', `Apache ignores .htaccess in ${root}`, `Rewrite rules in .htaccess, such as Laravel's public/.htaccess, do nothing. If the app needs them, add this to ${site.file}:`, fix)
  }
  return warn('web-rewrite', `AllowOverride is not set for ${root}`, `Apache ignores .htaccess by default unless its main configuration allows it there. If the app needs .htaccess rewrites, add this to ${site.file}:`, fix)
}

export function webServerItems(sitePath: string, layout: SiteConfig['layout'], check: WebServerCheck): ReadyItem[] {
  if (check.server !== 'apache') return []
  const items = [siteItem(sitePath, check)]
  const [site] = check.sites
  if (!site) return items
  if (layout === 'releases') items.push(symlinkItem(site, sitePath))
  items.push(rewriteItem(site, check))
  return items
}
