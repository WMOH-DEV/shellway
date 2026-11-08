import type { AttentionItem, ServerFacts } from '@/types/server/core'
import { backupFacts, engineFacts, userDatabases } from './facts'
import type { BackupFacts, EngineFacts } from './types'

const PUBLIC_ADDRESS = /^(0\.0\.0\.0|\*|\[::\]|::):\d+$/

export const publicAddresses = (data: EngineFacts | null): string[] => (data?.status === 'ok' ? data.listen.filter((address) => PUBLIC_ADDRESS.test(address)) : [])

function failedBackup(backups: BackupFacts | null): AttentionItem[] {
  if (!backups?.last || backups.last.ok) return []
  const detail = backups.last.note ? `Failed: ${backups.last.note.replace(/ /g, ', ')}.` : `${backups.last.failed} database backups failed.`
  return [
    {
      id: 'databases.backup-failed',
      area: 'databases',
      level: 'error',
      rank: 130,
      title: 'Last database backup failed',
      detail,
      actionLabel: 'Open backups',
      route: { section: 'databases', sub: 'backups' }
    }
  ]
}

function unscheduled(backups: BackupFacts | null, databaseCount: number): AttentionItem[] {
  if (!backups || backups.schedule || databaseCount === 0) return []
  return [
    {
      id: 'databases.no-backups',
      area: 'databases',
      level: 'info',
      rank: 15,
      title: 'Databases are not backed up',
      detail: `${databaseCount} ${databaseCount === 1 ? 'database has' : 'databases have'} no nightly backup.`,
      actionLabel: 'Schedule backups',
      route: { section: 'databases', sub: 'backups' }
    }
  ]
}

function exposedMysql(mysql: EngineFacts | null): AttentionItem[] {
  const addresses = publicAddresses(mysql)
  if (addresses.length === 0) return []
  return [
    {
      id: 'databases.mysql-public',
      area: 'databases',
      level: 'warning',
      rank: 75,
      title: 'MySQL listens on every network address',
      detail: `${addresses.join(', ')}. Anyone who can reach this server can try to sign in, unless a firewall blocks the port.`,
      actionLabel: 'Review MySQL',
      route: { section: 'databases', params: { engine: 'mysql' } }
    }
  ]
}

export function databasesAttention(facts: ServerFacts): AttentionItem[] {
  const mysql = engineFacts(facts, 'mysql')
  const backups = backupFacts(facts)
  const databaseCount = userDatabases(mysql).length + userDatabases(engineFacts(facts, 'postgresql')).length
  return [...failedBackup(backups), ...exposedMysql(mysql), ...unscheduled(backups, databaseCount)]
}
