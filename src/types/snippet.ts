export interface Snippet {
  id: string
  name: string
  command: string
  category: string
  /** Short abbreviation that auto-expands in terminal (e.g. "rn" → "sudo systemctl restart nginx") */
  shortcut?: string
  description?: string
  createdAt: number
  updatedAt: number
}
