import { create } from 'zustand'
import type { Snippet } from '@/types/snippet'

interface SnippetState {
  snippets: Snippet[]
  categories: string[]
  searchQuery: string
  selectedCategory: string | null

  loadSnippets: () => Promise<void>
  addSnippet: (snippet: Snippet) => Promise<void>
  updateSnippet: (id: string, updates: Partial<Snippet>) => Promise<void>
  removeSnippet: (id: string) => Promise<void>
  setSearchQuery: (query: string) => void
  setSelectedCategory: (category: string | null) => void
}

export const useSnippetStore = create<SnippetState>((set) => ({
  snippets: [],
  categories: [],
  searchQuery: '',
  selectedCategory: null,

  loadSnippets: async () => {
    const [snippets, categories] = await Promise.all([
      window.novadeck.snippets.getAll() as Promise<Snippet[]>,
      window.novadeck.snippets.getCategories() as Promise<string[]>
    ])
    set({ snippets, categories })
  },

  addSnippet: async (snippet) => {
    await window.novadeck.snippets.create(snippet)
    const [snippets, categories] = await Promise.all([
      window.novadeck.snippets.getAll() as Promise<Snippet[]>,
      window.novadeck.snippets.getCategories() as Promise<string[]>
    ])
    set({ snippets, categories })
  },

  updateSnippet: async (id, updates) => {
    await window.novadeck.snippets.update(id, updates)
    const [snippets, categories] = await Promise.all([
      window.novadeck.snippets.getAll() as Promise<Snippet[]>,
      window.novadeck.snippets.getCategories() as Promise<string[]>
    ])
    set({ snippets, categories })
  },

  removeSnippet: async (id) => {
    await window.novadeck.snippets.delete(id)
    const snippets = await window.novadeck.snippets.getAll() as Snippet[]
    set({ snippets })
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (category) => set({ selectedCategory: category })
}))
