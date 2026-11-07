import type { RedisFacts } from '@/utils/server/databases/types'
import { Label, Notice, SectionCard, SummaryStrip } from '@/components/server/kit'

const DAY = 86_400
const HOUR = 3_600

function uptime(seconds: number): string {
  if (seconds >= DAY) return `${Math.floor(seconds / DAY)} d`
  if (seconds >= HOUR) return `${Math.floor(seconds / HOUR)} h`
  return `${Math.floor(seconds / 60)} min`
}

export function RedisPanel({ redis }: { redis: RedisFacts }) {
  if (redis.status === 'needs-password') return <Notice tone="neutral" title="Redis requires a password">Shellway does not ask for it, so it cannot show the details. Redis is running.</Notice>
  if (redis.status !== 'ok') return <Notice tone="warning" title="Redis is not answering">{redis.reason}</Notice>
  const totalKeys = redis.keyspace.reduce((sum, db) => sum + db.keys, 0)
  return (
    <div className="flex flex-col gap-4">
      <SummaryStrip
        cells={[
          { label: 'Version', value: redis.version, meta: redis.port ? `port ${redis.port}` : undefined },
          { label: 'Up for', value: uptime(redis.uptimeSeconds) },
          { label: 'Memory', value: redis.usedMemory, meta: redis.maxMemory && redis.maxMemory !== '0B' ? `limit ${redis.maxMemory}` : 'no limit' },
          { label: 'Clients', value: redis.clients },
          { label: 'Keys', value: totalKeys }
        ]}
      />
      <SectionCard title="Keyspace" count={redis.keyspace.length}>
        {redis.keyspace.length === 0 && <p className="text-[13px] text-nd-text-muted">Redis holds no keys.</p>}
        {redis.keyspace.map((db) => (
          <div key={db.db} className="grid grid-cols-[80px_1fr_1fr] items-center gap-3 text-[13px]">
            <span className="font-mono text-nd-text-primary">{db.db}</span>
            <span className="text-nd-text-secondary"><Label>Keys</Label> {db.keys}</span>
            <span className="text-nd-text-secondary"><Label>Expiring</Label> {db.expires}</span>
          </div>
        ))}
      </SectionCard>
    </div>
  )
}
