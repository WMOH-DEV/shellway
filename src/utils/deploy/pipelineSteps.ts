import type { DeployStep } from '@/types/deploy'
import { PRESETS, presetById, type Preset, type PresetId } from './presets'

export type StepStage = 'buildSteps' | 'activateSteps'

export interface StepFlag {
  label: string
  tone: 'warning' | 'muted'
}

export interface SplitSteps {
  source: DeployStep[]
  target: DeployStep[]
}

const MAX_LIMIT_SECONDS = 86_400
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600 }
const SUDO_PREFIX = /^\s*sudo (.+)$/

export const blankStep = (command = ''): DeployStep => ({ command, optional: false, timeoutSeconds: null })

export function moveStep(steps: DeployStep[], from: number, to: number): DeployStep[] {
  if (from === to || to < 0 || to >= steps.length) return steps
  const next = [...steps]
  const [step] = next.splice(from, 1)
  next.splice(to, 0, step)
  return next
}

export const updateStep = (steps: DeployStep[], index: number, patch: Partial<DeployStep>): DeployStep[] =>
  steps.map((step, i) => (i === index ? { ...step, ...patch } : step))

export const removeStep = (steps: DeployStep[], index: number): DeployStep[] => steps.filter((_, i) => i !== index)

export const duplicateStep = (steps: DeployStep[], index: number): DeployStep[] => [
  ...steps.slice(0, index + 1),
  { ...steps[index] },
  ...steps.slice(index + 1)
]

export function appendNewSteps(steps: DeployStep[], extra: DeployStep[]): DeployStep[] {
  const known = new Set(steps.map((step) => step.command))
  return [...steps, ...extra.filter((step) => !known.has(step.command))]
}

export function moveToOtherStage(source: DeployStep[], target: DeployStep[], index: number): SplitSteps {
  return { source: removeStep(source, index), target: [...target, source[index]] }
}

export function presetStepsFor(stage: StepStage, id: PresetId): DeployStep[] {
  const preset = presetById(id)
  return stage === 'buildSteps' ? preset.buildSteps({ buildScript: false }) : preset.activateSteps.map((step) => ({ ...step }))
}

export const presetsWithSteps = (stage: StepStage): Preset[] =>
  PRESETS.filter((preset) => presetStepsFor(stage, preset.id).length > 0)

const baseName = (program: string): string => program.slice(program.lastIndexOf('/') + 1)

function splitProgram(line: string): { program: string; args: string } {
  const space = line.indexOf(' ')
  return space === -1 ? { program: line, args: '' } : { program: line.slice(0, space), args: line.slice(space + 1) }
}

function isSudoersMatch(command: string, need: string): boolean {
  const a = splitProgram(command)
  const b = splitProgram(need)
  return baseName(a.program) === baseName(b.program) && a.args === b.args
}

export function stepFlag(step: DeployStep, sudoNeeds: string[]): StepFlag | null {
  const rest = SUDO_PREFIX.exec(step.command)?.[1]
  if (rest === undefined) return null
  return sudoNeeds.some((need) => isSudoersMatch(rest, need))
    ? { label: 'needs sudoers line', tone: 'warning' }
    : { label: 'needs sudo', tone: 'muted' }
}

export function formatLimit(seconds: number | null): string {
  if (!seconds) return ''
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

export function parseLimit(text: string): number | null | undefined {
  const value = text.trim().toLowerCase()
  if (value === '') return null
  const match = /^(\d+)\s*([smh]?)$/.exec(value)
  if (!match) return undefined
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2] || 'm']
  return seconds >= 1 && seconds <= MAX_LIMIT_SECONDS ? seconds : undefined
}
