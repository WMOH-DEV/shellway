export interface TerminalShell {
  id: string
  name: string
}

const liveShells = new Map<string, TerminalShell[]>()
const adoptedShells = new Map<string, TerminalShell[]>()

export function recordLiveShells(connectionId: string, shells: TerminalShell[]): void {
  liveShells.set(connectionId, shells)
}

export function forgetLiveShells(connectionId: string): void {
  liveShells.delete(connectionId)
}

export function liveShellsFor(connectionId: string): TerminalShell[] {
  return liveShells.get(connectionId) ?? []
}

export function adoptShells(connectionId: string, shells: TerminalShell[]): void {
  adoptedShells.set(connectionId, shells)
}

export function adoptedShellsFor(connectionId: string): TerminalShell[] | undefined {
  return adoptedShells.get(connectionId)
}

export function clearAdoptedShells(connectionId: string): void {
  adoptedShells.delete(connectionId)
}
