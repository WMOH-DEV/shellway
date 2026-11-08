import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions, leading }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      {leading}
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-nd-text-primary">{title}</h1>
        {subtitle && <p className="text-[13px] text-nd-text-muted">{subtitle}</p>}
      </div>
      <div className="flex-1" />
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function SectionPage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-col gap-4 px-7 pb-7 pt-[22px]">{children}</div>
}
