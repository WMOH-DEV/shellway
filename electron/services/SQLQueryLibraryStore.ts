import Store from 'electron-store'
import { randomUUID } from 'crypto'

export interface SavedQuery {
  id: string
  name: string
  sql: string
  groupId: string | null
  createdAt: number
  updatedAt: number
}

export interface QueryGroup {
  id: string
  name: string
  createdAt: number
}

interface StoreSchema {
  queries: Record<string, SavedQuery[]>
  groups: Record<string, QueryGroup[]>
}

export class SQLQueryLibraryStore {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'sql-query-library',
      defaults: { queries: {}, groups: {} }
    })
  }

  listQueries(scopeId: string): SavedQuery[] {
    const all = this.store.get('queries', {})
    return [...(all[scopeId] ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  }

  saveQuery(
    scopeId: string,
    input: { id?: string; name: string; sql: string; groupId: string | null }
  ): SavedQuery {
    const all = this.store.get('queries', {})
    const list = all[scopeId] ?? []
    const now = Date.now()

    const existingIndex = input.id
      ? list.findIndex((query) => query.id === input.id)
      : -1

    const record: SavedQuery =
      existingIndex >= 0
        ? {
            ...list[existingIndex],
            name: input.name,
            sql: input.sql,
            groupId: input.groupId,
            updatedAt: now
          }
        : {
            id: input.id ?? randomUUID(),
            name: input.name,
            sql: input.sql,
            groupId: input.groupId,
            createdAt: now,
            updatedAt: now
          }

    if (existingIndex >= 0) list[existingIndex] = record
    else list.push(record)

    all[scopeId] = list
    this.store.set('queries', all)
    return record
  }

  deleteQuery(scopeId: string, id: string): boolean {
    const all = this.store.get('queries', {})
    const list = all[scopeId]
    if (!list) return false
    all[scopeId] = list.filter((query) => query.id !== id)
    this.store.set('queries', all)
    return true
  }

  listGroups(scopeId: string): QueryGroup[] {
    const all = this.store.get('groups', {})
    return [...(all[scopeId] ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  }

  createGroup(scopeId: string, name: string): QueryGroup {
    const all = this.store.get('groups', {})
    const list = all[scopeId] ?? []
    const group: QueryGroup = {
      id: randomUUID(),
      name,
      createdAt: Date.now()
    }
    list.push(group)
    all[scopeId] = list
    this.store.set('groups', all)
    return group
  }

  renameGroup(scopeId: string, id: string, name: string): boolean {
    const all = this.store.get('groups', {})
    const list = all[scopeId]
    if (!list) return false
    const group = list.find((item) => item.id === id)
    if (!group) return false
    group.name = name
    this.store.set('groups', all)
    return true
  }

  /** Deleting a group keeps its queries — they fall back to Ungrouped. */
  deleteGroup(scopeId: string, id: string): boolean {
    const groups = this.store.get('groups', {})
    const list = groups[scopeId]
    if (!list) return false
    groups[scopeId] = list.filter((group) => group.id !== id)
    this.store.set('groups', groups)

    const queries = this.store.get('queries', {})
    const scoped = queries[scopeId]
    if (scoped) {
      queries[scopeId] = scoped.map((query) =>
        query.groupId === id ? { ...query, groupId: null } : query
      )
      this.store.set('queries', queries)
    }
    return true
  }

  dropScope(scopeId: string): void {
    const queries = this.store.get('queries', {})
    const groups = this.store.get('groups', {})
    delete queries[scopeId]
    delete groups[scopeId]
    this.store.set('queries', queries)
    this.store.set('groups', groups)
  }
}
