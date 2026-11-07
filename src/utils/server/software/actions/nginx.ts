import type { ActionDefinition, ActionPlan, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE } from '@/types/server/identity'
import { fileEditStep } from '../../fileEdit'
import { NGINX_CONF_PATH, setNginxDirectives, type NginxKey } from '../nginx'
import { blockedPlan, changedLines, okData, rootCommand, softwarePlan, unsupportedOsMessage } from '../planKit'
import { NGINX_PROBE, type NginxFacts } from '../types'
import { asRecord, nginxSettings } from '../validate'

type NginxLookup = NginxFacts | ActionPlan

const UNREADABLE = '\uFFFD'

function nginxOrBlock(title: string, facts: ServerFacts): NginxLookup {
  const os = unsupportedOsMessage(facts)
  if (os) return blockedPlan(title, 'unsupported', os)
  const nginx = okData<NginxFacts>(facts, NGINX_PROBE)
  if (!nginx) return blockedPlan(title, 'precondition', 'nginx has not been checked yet. Refresh and try again.')
  if (!nginx.installed) return blockedPlan(title, 'precondition', 'nginx is not installed.')
  return nginx
}

const isPlan = (value: NginxLookup): value is ActionPlan => 'steps' in value

export const nginxTestAction: ActionDefinition<Record<string, never>> = {
  type: 'software.nginx-test',
  area: 'software',
  needs: [IDENTITY_PROBE, NGINX_PROBE],
  validate: () => ({}),
  plan(_params, facts) {
    const title = 'Test the nginx config'
    const lookup = nginxOrBlock(title, facts)
    if (isPlan(lookup)) return lookup
    return softwarePlan(title, 'Check the nginx config for errors. Nothing is changed.', [rootCommand('test', title, 'nginx -t 2>&1\n')])
  }
}

export interface NginxSettingsParams {
  values: Partial<Record<NginxKey, string>>
}

export const nginxSettingsAction: ActionDefinition<NginxSettingsParams> = {
  type: 'software.nginx-settings',
  area: 'software',
  needs: [IDENTITY_PROBE, NGINX_PROBE],
  validate: (raw) => ({ values: nginxSettings(asRecord(raw).values) }),
  plan(params, facts) {
    const title = 'Change nginx settings'
    const lookup = nginxOrBlock(title, facts)
    if (isPlan(lookup)) return lookup
    const { conf, elsewhere } = lookup
    if (!conf.sha256) return blockedPlan(title, 'precondition', `${NGINX_CONF_PATH} was not found.`)
    const included = Object.keys(params.values).find((key) => elsewhere[key])
    if (included) return blockedPlan(title, 'precondition', `${included} is set in ${elsewhere[included].path}. Change it there.`)
    if (conf.content.includes(UNREADABLE)) return blockedPlan(title, 'precondition', `${NGINX_CONF_PATH} has characters Shellway cannot read safely. Edit it by hand.`)
    const content = setNginxDirectives(conf.content, params.values)
    if (content === null) return blockedPlan(title, 'precondition', `${NGINX_CONF_PATH} has no http block to put these settings in.`)
    const diff = changedLines(conf.content, content)
    if (diff === '') return blockedPlan(title, 'precondition', 'These values are already set.')
    const step = fileEditStep({
      id: 'conf',
      label: `Write ${NGINX_CONF_PATH}`,
      path: NGINX_CONF_PATH,
      content,
      originalSha256: conf.sha256,
      mode: '0644',
      owner: 'root:root',
      test: 'nginx -t',
      reload: 'systemctl reload nginx',
      diff
    })
    return softwarePlan(title, 'Only the changed lines in the http block are rewritten. A backup is kept and restored if the test fails.', [step])
  }
}
