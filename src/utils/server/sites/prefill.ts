import type { TemplateId } from '@/types/createSite'
import { TEMPLATE_IDS } from '@/utils/createSite/wizard'
import { isIssuableName } from '@/utils/ssl/https/issueCommands'

export interface CreatePrefill {
  template?: TemplateId
  appPort?: number
  domain?: string
}

const MAX_PORT = 65535

export function createPrefill(params: Record<string, string> | undefined): CreatePrefill {
  const prefill: CreatePrefill = {}
  const template = TEMPLATE_IDS.find((id) => id === params?.template)
  const port = Number(params?.port)
  const domain = params?.domain?.trim().toLowerCase()
  if (template) prefill.template = template
  if (Number.isInteger(port) && port > 0 && port <= MAX_PORT) prefill.appPort = port
  if (domain && isIssuableName(domain)) prefill.domain = domain
  return prefill
}
