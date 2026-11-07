import type { AreaModule, ProbeDefinition } from '@/types/server/core'
import { securityAttention } from '../security/attention'
import { fail2banProbe } from '../security/fail2ban'
import { fail2banActions } from '../security/fail2banActions'
import { hardeningProbe, timezonesProbe } from '../security/hardening'
import { hardeningActions } from '../security/hardeningActions'
import { keyActions } from '../security/keyActions'
import { keysProbe } from '../security/keys'
import { sshProbe } from '../security/ssh'
import { ufwProbe } from '../security/ufw'

export const securityArea: AreaModule = {
  id: 'security',
  probes: [ufwProbe, sshProbe, keysProbe, fail2banProbe, hardeningProbe, timezonesProbe] as ProbeDefinition[],
  actions: [...fail2banActions, ...keyActions, ...hardeningActions],
  attention: securityAttention
}
