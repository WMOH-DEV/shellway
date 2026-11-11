export interface TabActions {
  activate(id: string): void
  close(id: string): void
  closeMany(ids: string[]): void
  promote(id: string): void
  pin(id: string, pinned: boolean): void
  duplicate(id: string): void
  move(id: string, toIndex: number): void
  reopenClosed(closedIndex?: number): void
  sortByName(): void
  revealInSidebar(id: string): void
  copyName(id: string): void
}
