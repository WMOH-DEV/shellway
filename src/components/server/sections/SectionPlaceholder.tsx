export function SectionPlaceholder({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col gap-2 px-7 py-6">
      <h1 className="text-lg font-semibold text-nd-text-primary">{title}</h1>
      <p className="text-sm text-nd-text-muted">This section is being built.</p>
    </div>
  )
}
