import type { ReactNode } from 'react'

export function DrawerBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-5">{children}</div>
}

export function DrawerFooter({ children }: { children: ReactNode }) {
  return <footer className="flex flex-wrap items-center gap-2.5 border-t border-nd-border px-6 py-3">{children}</footer>
}

export function Spacer() {
  return <div className="flex-1" />
}
