import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { DatabaseEngine, ServerTools } from '@/types/createSite'
import { databaseChoices, databaseNames, engineLabel, needsDatabase, siteDatabase, sqlitePath, type DatabaseChoice } from '@/utils/createSite/database'
import { envPathOf, isSecretKey, managedEnv, stackUsesEnv } from '@/utils/createSite/env'
import { MASK } from '@/utils/server/databases/identifiers'
import { Choice, Section } from '../setup/SiteSections'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

interface SectionProps {
  model: CreateSiteDraftModel
  tools: ServerTools
}

function engineHint(engine: DatabaseEngine, model: CreateSiteDraftModel): string {
  const { draft } = model
  if (engine === 'sqlite') return `A file at ${sqlitePath(draft.folder)}, outside the releases, so it survives every deploy.`
  const { name, user } = databaseNames(draft.siteName)
  return `On this server. Shellway creates database ${name} and user ${user} with a new password.`
}

const NO_DATABASE = { value: 'none' as const, label: 'No database', hint: 'Shellway creates none. You can add one later from the Server tab.' }

function databaseOptions(engines: DatabaseEngine[], model: CreateSiteDraftModel): { value: DatabaseChoice; label: string; hint: string }[] {
  const options = engines.map((engine) => ({ value: engine as DatabaseChoice, label: engineLabel(engine), hint: engineHint(engine, model) }))
  return needsDatabase(model.draft.template) ? options : [...options, NO_DATABASE]
}

function SecretValue({ name, value }: { name: string; value: string }) {
  const [shown, setShown] = useState(false)
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono">{shown ? value : MASK}</span>
      <Button size="sm" variant="ghost" aria-label={`${shown ? 'Hide' : 'Show'} ${name}`} onClick={() => setShown(!shown)}>
        {shown ? <EyeOff size={12} /> : <Eye size={12} />}
      </Button>
    </span>
  )
}

export function DatabaseSection({ model, tools }: SectionProps) {
  const engines = databaseChoices(model.draft.template, tools)
  if (engines.length === 0 && model.draft.template !== 'node') return null
  const missingServer = !tools.databases.mysql && !tools.databases.postgresql
  return (
    <Section title="Database">
      <Choice value={model.draft.database} options={databaseOptions(engines, model)} onChange={(database) => model.patch({ database })} />
      {missingServer && <span className="text-2xs text-nd-text-muted">No MySQL or PostgreSQL on this server. Install one from the Server tab to use it here.</span>}
    </Section>
  )
}

export function EnvironmentSection({ model }: { model: CreateSiteDraftModel }) {
  const { draft, patch } = model
  if (!stackUsesEnv(draft.template)) return null
  const facts = { ...draft, database: siteDatabase(draft.database, draft) }
  const managed = managedEnv(facts, { appKey: draft.appKey, dbPassword: draft.dbPassword })
  return (
    <Section title="Environment (.env)">
      <span className="text-2xs text-nd-text-muted">
        Written to {envPathOf(draft.folder)} before the first deploy. Only the site user can read it, and every deploy uses it.
      </span>
      {managed.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-nd-text-primary">Set by Shellway</span>
          <dl aria-label="Set by Shellway" className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-md bg-nd-bg-sunken p-2.5 text-xs">
            {managed.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-mono text-nd-text-muted">{key}</dt>
                <dd className="min-w-0 text-nd-text-primary">{isSecretKey(key) ? <SecretValue name={key} value={value} /> : <span className="truncate font-mono">{value}</span>}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-nd-text-primary">Your settings</span>
        <span className="text-2xs text-nd-text-muted">Anything else the app needs, one KEY=value per line. The values set by Shellway win over the same keys here.</span>
        <textarea
          aria-label="Your settings"
          spellCheck={false}
          className="h-32 resize-y rounded-md border border-nd-border-hover bg-nd-bg-sunken p-2 font-mono text-xs text-nd-text-primary focus:border-nd-accent focus:outline-none"
          placeholder="MAIL_MAILER=smtp"
          value={draft.envText}
          onChange={(event) => patch({ envText: event.target.value })}
        />
      </label>
    </Section>
  )
}
