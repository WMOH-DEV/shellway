import { create } from 'zustand'

export type SidebarChoice = 'collapsed' | 'expanded'

const STORAGE_KEY = 'shellway.server.sidebar'

interface ServerSidebarState {
  choice: SidebarChoice | null
  setChoice(choice: SidebarChoice): void
}

function readChoice(): SidebarChoice | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'collapsed' || value === 'expanded' ? value : null
  } catch {
    return null
  }
}

function saveChoice(choice: SidebarChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    return
  }
}

export const useServerSidebarStore = create<ServerSidebarState>((set) => ({
  choice: readChoice(),
  setChoice: (choice) => {
    saveChoice(choice)
    set({ choice })
  }
}))

export const isSidebarCollapsed = (choice: SidebarChoice | null, narrow: boolean): boolean => (choice === null ? narrow : choice === 'collapsed')
