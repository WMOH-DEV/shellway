import { createContext, useContext } from 'react'
import type { AttentionItem } from '@/types/server/core'

export const ServerAttentionContext = createContext<readonly AttentionItem[]>([])

export const useAttentionItems = (): readonly AttentionItem[] => useContext(ServerAttentionContext)
