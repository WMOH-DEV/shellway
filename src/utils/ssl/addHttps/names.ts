import type { NameReadiness, ServerBlock } from '../../../types/ssl'
import { isIssuableName } from '../https/issueCommands'

export interface NameChoice {
  name: string
  issuable: boolean
}

export const nameChoices = (block: ServerBlock): NameChoice[] => block.names.map((name) => ({ name, issuable: isIssuableName(name) }))

export const issuableNames = (choices: NameChoice[]): string[] => choices.filter((choice) => choice.issuable).map((choice) => choice.name)

export const readinessFor = (readiness: NameReadiness[], name: string): NameReadiness | undefined => readiness.find((row) => row.name === name)

export const isDnsBlocked = (readiness: NameReadiness[], name: string): boolean => readinessFor(readiness, name)?.dns.state === 'fail'

export function selectedNames(choices: NameChoice[], readiness: NameReadiness[], unticked: ReadonlySet<string>): string[] {
  return choices
    .filter((choice) => choice.issuable && !unticked.has(choice.name) && !isDnsBlocked(readiness, choice.name))
    .map((choice) => choice.name)
}

export function leftOutByDns(choices: NameChoice[], readiness: NameReadiness[]): NameReadiness[] {
  return readiness.filter((row) => row.dns.state === 'fail' && choices.some((choice) => choice.name === row.name))
}
