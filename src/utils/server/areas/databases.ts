import type { ActionDefinition, AreaModule, ProbeDefinition } from '@/types/server/core'
import { backupNowAction, scheduleBackupsAction } from '../databases/actions/backup'
import { createDatabaseAction, createUserAction } from '../databases/actions/create'
import { dropDatabaseAction } from '../databases/actions/drop'
import { restoreAction } from '../databases/actions/restore'
import { changePasswordAction, dropUserAction } from '../databases/actions/users'
import { databasesAttention } from '../databases/attention'
import { backupsProbe } from '../databases/backups'
import { mysqlProbe } from '../databases/mysql'
import { postgresProbe } from '../databases/postgres'
import { redisProbe } from '../databases/redis'
import { siteEnvProbe } from '../databases/siteEnv'

export const databasesArea: AreaModule = {
  id: 'databases',
  probes: [mysqlProbe, postgresProbe, redisProbe, backupsProbe, siteEnvProbe] as ProbeDefinition[],
  actions: [
    createDatabaseAction,
    createUserAction,
    changePasswordAction,
    dropUserAction,
    dropDatabaseAction,
    backupNowAction,
    scheduleBackupsAction,
    restoreAction
  ] as ActionDefinition[],
  attention: databasesAttention
}
