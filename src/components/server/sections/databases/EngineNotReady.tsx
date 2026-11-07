import { Button } from '@/components/ui/Button'
import type { ComponentId } from '@/utils/server/install/types'
import { Notice } from '@/components/server/kit'

export type EngineTab = 'mysql' | 'postgresql' | 'redis'

const INSTALL_OPTIONS: Record<EngineTab, { component: ComponentId; label: string }[]> = {
  mysql: [
    { component: 'mysql', label: 'Install MySQL' },
    { component: 'mariadb', label: 'Install MariaDB' }
  ],
  postgresql: [{ component: 'postgresql', label: 'Install PostgreSQL' }],
  redis: [{ component: 'redis', label: 'Install Redis' }]
}

const NAMES: Record<EngineTab, string> = { mysql: 'MySQL or MariaDB', postgresql: 'PostgreSQL', redis: 'Redis' }

export function EngineNotInstalled({ engine, onInstall }: { engine: EngineTab; onInstall(component: ComponentId): void }) {
  return (
    <Notice
      tone="info"
      title={`${NAMES[engine]} is not installed`}
      action={
        <span className="flex gap-2">
          {INSTALL_OPTIONS[engine].map((option) => (
            <Button key={option.component} size="sm" variant="primary" onClick={() => onInstall(option.component)}>{option.label}</Button>
          ))}
        </span>
      }
    >
      {engine === 'mysql' ? 'Ubuntu ships MySQL, Debian ships MariaDB. Both work with the same apps.' : 'You review every command before anything is installed.'}
    </Notice>
  )
}
