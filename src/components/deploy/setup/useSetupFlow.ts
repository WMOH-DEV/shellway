import { useState } from 'react'
import type { SiteConfig } from '@/types/deploy'
import { presetById } from '@/utils/deploy/presets'
import { SETUP_STEPS, needsSave, stepDetail, stepError, type SetupStep } from '@/utils/deploy/setupFlow'
import { deployApi } from '../useDeploySites'
import { useReadyCheck, type ReadyCheckModel } from './useReadyCheck'
import { useSiteDraft, type SiteDraft } from './useSiteDraft'

interface SetupFlowOptions {
  connectionId: string
  existingNames: string[]
  onCancel: () => void
  onSiteSaved: (site: SiteConfig) => void
  onFinished: (site: SiteConfig) => void
}

export interface SetupFlow {
  draft: SiteDraft
  step: SetupStep
  ready: ReadyCheckModel
  busy: boolean
  error: string | null
  details: Record<SetupStep, string>
  next: () => Promise<void>
  back: () => void
  goTo: (step: SetupStep) => void
  deploy: () => Promise<void>
}

export function useSetupFlow({ connectionId, existingNames, onCancel, onSiteSaved, onFinished }: SetupFlowOptions): SetupFlow {
  const draft = useSiteDraft(connectionId, null)
  const { site } = draft
  const [step, setStep] = useState<SetupStep>('where')
  const [saved, setSaved] = useState<SiteConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = useReadyCheck(connectionId, site, step === 'ready')
  const index = SETUP_STEPS.indexOf(step)

  const goTo = (target: SetupStep) => {
    setError(null)
    setStep(target)
  }

  const saveIfChanged = async (): Promise<boolean> => {
    if (!needsSave(saved, site)) return true
    setBusy(true)
    const result = await deployApi().save(connectionId, site)
    setBusy(false)
    if (!result.success) {
      setError(result.error ?? 'Could not save')
      return false
    }
    setSaved(site)
    draft.lockName()
    onSiteSaved(site)
    return true
  }

  const next = async () => {
    const invalid = stepError(step, site, { existingNames, nameLocked: draft.nameLocked })
    if (invalid) {
      setError(invalid)
      return
    }
    if (step === 'commands' && !(await saveIfChanged())) return
    goTo(SETUP_STEPS[index + 1])
  }

  const back = () => (index === 0 ? onCancel() : goTo(SETUP_STEPS[index - 1]))

  const deploy = async () => {
    setBusy(true)
    setError(null)
    const result = await deployApi().deploy(connectionId, site.name)
    setBusy(false)
    if (!result.success) {
      setError(result.error ?? 'Could not start the deploy')
      return
    }
    onFinished(site)
  }

  const requiredLeft = ready.summary?.requiredLeft ?? null
  const presetLabel = presetById(draft.preset).label
  const details = Object.fromEntries(SETUP_STEPS.map((s) => [s, stepDetail(s, site, presetLabel, requiredLeft)])) as Record<SetupStep, string>

  return { draft, step, ready, busy, error, details, next, back, goTo, deploy }
}
