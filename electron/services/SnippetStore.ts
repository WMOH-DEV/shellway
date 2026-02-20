import Store from 'electron-store'

export interface StoredSnippet {
  id: string
  name: string
  command: string
  category: string
  description?: string
  createdAt: number
  updatedAt: number
}

interface StoreSchema {
  snippets: StoredSnippet[]
  categories: string[]
}

/**
 * SnippetStore — manages persistence of command snippets.
 */
export class SnippetStore {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'shellway-snippets',
      defaults: {
        snippets: [],
        categories: []
      }
    })
  }

  /** Get all snippets */
  getAll(): StoredSnippet[] {
    return this.store.get('snippets', [])
  }

  /** Create a new snippet */
  create(snippet: StoredSnippet): StoredSnippet {
    const snippets = this.store.get('snippets', [])
    snippets.push(snippet)
    this.store.set('snippets', snippets)

    // Auto-add category if new
    if (snippet.category) {
      const categories = this.store.get('categories', [])
      if (!categories.includes(snippet.category)) {
        categories.push(snippet.category)
        this.store.set('categories', categories)
      }
    }

    return snippet
  }

  /** Update an existing snippet */
  update(id: string, updates: Partial<StoredSnippet>): StoredSnippet | undefined {
    const snippets = this.store.get('snippets', [])
    const idx = snippets.findIndex((s) => s.id === id)
    if (idx === -1) return undefined

    const updated = { ...snippets[idx], ...updates, updatedAt: Date.now() }
    snippets[idx] = updated
    this.store.set('snippets', snippets)

    // Auto-add category if new
    if (updates.category) {
      const categories = this.store.get('categories', [])
      if (!categories.includes(updates.category)) {
        categories.push(updates.category)
        this.store.set('categories', categories)
      }
    }

    return updated
  }

  /** Delete a snippet by ID */
  delete(id: string): boolean {
    const snippets = this.store.get('snippets', [])
    const filtered = snippets.filter((s) => s.id !== id)
    if (filtered.length === snippets.length) return false
    this.store.set('snippets', filtered)
    return true
  }

  /** Get all category names */
  getCategories(): string[] {
    return this.store.get('categories', [])
  }
}
