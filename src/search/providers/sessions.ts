import { useSessionStore } from '@/stores/sessionStore'
import { useUIStore } from '@/stores/uiStore'
import type { Session } from '@/types/session'
import { showSubTab, tabForSession } from '../intentStore'
import { memoIndex, buildCollection, searchCollection } from '../miniIndex'
import { recencyFromTimestamp } from '../ranking'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { copyText, localSearch } from './shared'

const SUGGESTION_COUNT = 5
const INDEXED_FIELDS = ['name', 'host', 'username', 'group']

interface SessionEntry {
  id: string
  name: string
  host: string
  username: string
  group: string
  port: number
  lastConnected: number | undefined
}

function toEntry(session: Session): SessionEntry {
  return {
    id: session.id,
    name: session.name,
    host: session.host,
    username: session.username,
    group: session.group ?? '',
    port: session.port,
    lastConnected: session.lastConnected
  }
}

function hintFor(sessionId: string): string | undefined {
  const tab = tabForSession(sessionId)
  if (!tab) return undefined
  return tab.status === 'connected' ? 'connected' : 'tab open'
}

function toResult(entry: SessionEntry, now: number): SearchResult {
  const subtitle = `${entry.username}@${entry.host}:${entry.port}`
  return {
    id: `session:${entry.id}`,
    providerId: 'sessions',
    title: entry.name,
    subtitle: entry.group ? `${subtitle} · ${entry.group}` : subtitle,
    icon: 'server',
    hint: hintFor(entry.id),
    keywords: `${entry.host} ${entry.username} ${entry.group}`,
    scoreHints: { recency: recencyFromTimestamp(entry.lastConnected, now) },
    payload: { sessionId: entry.id, host: entry.host }
  }
}

function recentlyConnected(sessions: Session[]): Session[] {
  return sessions
    .filter((s) => s.lastConnected)
    .sort((a, b) => (b.lastConnected ?? 0) - (a.lastConnected ?? 0))
    .slice(0, SUGGESTION_COUNT)
}

function compute(query: SearchQuery): SearchResult[] {
  const sessions = useSessionStore.getState().sessions
  const now = Date.now()
  if (!query.text) return recentlyConnected(sessions).map((s) => toResult(toEntry(s), now))
  const collection = memoIndex('sessions', [sessions], () => buildCollection(sessions.map(toEntry), INDEXED_FIELDS))
  return searchCollection(collection, query.text, 50).map((entry) => toResult(entry, now))
}

function openSession(sessionId: string): void {
  const tab = tabForSession(sessionId)
  if (tab) showSubTab(tab.id, tab.activeSubTab)
  else useUIStore.getState().requestConnectSession(sessionId)
}

function openSessionSftp(sessionId: string): void {
  const tab = tabForSession(sessionId)
  if (tab?.status === 'connected') showSubTab(tab.id, 'sftp')
  else useUIStore.getState().requestConnectSession(sessionId)
}

export function createSessionsProvider(): SearchProvider {
  return {
    id: 'sessions',
    kind: 'local',
    scopes: ['servers'],
    search: localSearch(compute),
    actions(result): SearchAction[] {
      const { sessionId, host } = result.payload as { sessionId: string; host: string }
      return [
        { id: 'open', label: 'Open', role: 'primary', run: () => openSession(sessionId) },
        { id: 'open-sftp', label: 'Open SFTP', role: 'secondary', run: () => openSessionSftp(sessionId) },
        { id: 'copy-host', label: 'Copy host', role: 'copy', run: () => copyText(host) }
      ]
    }
  }
}
