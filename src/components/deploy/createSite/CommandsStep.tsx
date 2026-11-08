import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StepHeading } from '@/components/ssl/https/StepHeading'
import type { ServerTools, SiteServer } from '@/types/createSite'
import type { DeployCommands } from '@/utils/createSite/deploySite'
import { TEMPLATES } from '@/utils/createSite/templates'
import { commandsOf, defaultCommandsOf } from '@/utils/createSite/wizard'
import { StepsEditor } from '../StepsEditor'
import { ACTIVATE_HINT, BUILD_HINT, Section } from '../setup/SiteSections'
import { DatabaseSection, EnvironmentSection } from './EnvironmentSections'
import { JobsSection } from './JobsSection'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

interface CommandsStepProps {
  model: CreateSiteDraftModel
  connectionId: string
  server: SiteServer
  tools: ServerTools
}

const sameCommands = (a: DeployCommands, b: DeployCommands): boolean => JSON.stringify(a) === JSON.stringify(b)

export function CommandsStep({ model, connectionId, server, tools }: CommandsStepProps) {
  const { draft, patch } = model
  const label = TEMPLATES[draft.template].label
  const commands = commandsOf(draft, server)
  const edited = draft.commands !== null && !sameCommands(draft.commands, defaultCommandsOf(draft, server))
  const change = (changes: Partial<DeployCommands>) => patch({ commands: { ...commands, ...changes } })
  if (draft.codeSource === 'none') {
    return (
      <div className="flex flex-col gap-5">
        <StepHeading title="Commands and environment" subtitle="A site without code has no deploys, so there is nothing to set here." />
        <p className="text-xs text-nd-text-muted">Pick Use my git repository or Start a new project in the first step to add deploy commands, a database and an env file.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Commands and environment" subtitle={`What runs on every deploy, the database and the env file. Filled in for ${label}; change anything.`} />
      <Section title="Commands">
        <StepsEditor connectionId={connectionId} title="Build" hint={BUILD_HINT} steps={commands.buildSteps} onChange={(buildSteps) => change({ buildSteps })} />
        <div className="border-t border-nd-border" />
        <StepsEditor connectionId={connectionId} title="After going live" hint={ACTIVATE_HINT} steps={commands.activateSteps} onChange={(activateSteps) => change({ activateSteps })} />
        {edited && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-nd-text-muted">These differ from the {label} defaults.</span>
            <Button size="sm" variant="ghost" onClick={() => patch({ commands: null })}><RotateCcw size={12} /> Reset to the defaults</Button>
          </div>
        )}
      </Section>
      <JobsSection model={model} tools={tools} />
      <DatabaseSection model={model} tools={tools} />
      <EnvironmentSection model={model} />
    </div>
  )
}
