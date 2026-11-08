import { useState } from 'react'
import type { SiteConfig } from '@/types/deploy'
import { PRESETS, applyPreset, newSite, presetById, siteNameFromPath, suggestPreset, type PresetId } from '@/utils/deploy/presets'
import { deployApi } from '../useDeploySites'

export interface SiteDraft {
  site: SiteConfig
  isNew: boolean
  nameLocked: boolean
  preset: PresetId
  detecting: boolean
  detectNote: string | null
  sharedPathsText: string
  patch: (changes: Partial<SiteConfig>) => void
  choosePreset: (id: PresetId) => void
  detect: () => Promise<void>
  changePath: (path: string) => void
  changeName: (name: string) => void
  changeSharedPaths: (text: string) => void
  lockName: () => void
}

export function useSiteDraft(connectionId: string, initial: SiteConfig | null): SiteDraft {
  const isNew = initial === null
  const [site, setSite] = useState<SiteConfig>(() => initial ?? applyPreset(newSite(), 'laravel', { buildScript: false }))
  const [preset, setPreset] = useState<PresetId>('laravel')
  const [buildScript, setBuildScript] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectNote, setDetectNote] = useState<string | null>(null)
  const [sharedPathsText, setSharedPathsText] = useState(() => site.sharedPaths.join(' '))
  const [nameEdited, setNameEdited] = useState(false)
  const [nameLocked, setNameLocked] = useState(!isNew)

  const patch = (changes: Partial<SiteConfig>) => setSite((current) => ({ ...current, ...changes }))

  const choosePreset = (id: PresetId) => {
    setPreset(id)
    const next = applyPreset(site, id, { buildScript })
    setSharedPathsText(next.sharedPaths.join(' '))
    setSite(next)
  }

  const detect = async () => {
    setDetecting(true)
    setDetectNote(null)
    const result = await deployApi().detect(connectionId, site.path)
    setDetecting(false)
    if (!result.success || !result.data) {
      setDetectNote(result.error ?? 'Could not inspect the folder')
      return
    }
    const found = result.data
    if (!found.exists) {
      setDetectNote('This folder does not exist yet. It will be created on the first deploy.')
      return
    }
    if (!isNew) {
      patch({ repoUrl: found.repoUrl || site.repoUrl, branch: found.branch || site.branch })
      setDetectNote(found.repoUrl ? `Found ${found.repoUrl} on ${found.branch || 'unknown branch'}` : 'No git repository here')
      return
    }
    const suggested = suggestPreset(found.files)
    setBuildScript(found.buildScript)
    setPreset(suggested)
    setSharedPathsText(presetById(suggested).sharedPaths.join(' '))
    setSite((current) => ({
      ...applyPreset(current, suggested, { buildScript: found.buildScript }),
      name: current.name || siteNameFromPath(current.path),
      repoUrl: found.repoUrl || current.repoUrl,
      branch: found.branch || current.branch
    }))
    const presetLabel = PRESETS.find((p) => p.id === suggested)?.label
    setDetectNote(found.repoUrl ? `Found ${found.repoUrl} on ${found.branch || 'unknown branch'} · ${presetLabel}` : `No git repository here · ${presetLabel}`)
  }

  const changePath = (path: string) => patch({ path, ...(!nameLocked && !nameEdited && { name: siteNameFromPath(path) }) })

  const changeName = (name: string) => {
    setNameEdited(true)
    patch({ name })
  }

  const lockName = () => setNameLocked(true)

  const changeSharedPaths = (text: string) => {
    setSharedPathsText(text)
    patch({ sharedPaths: text.split(/\s+/).filter(Boolean) })
  }

  return { site, isNew, nameLocked, preset, detecting, detectNote, sharedPathsText, patch, choosePreset, detect, changePath, changeName, changeSharedPaths, lockName }
}
