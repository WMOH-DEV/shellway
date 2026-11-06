export function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-[17px] font-semibold text-nd-text-primary">{title}</h2>
      <p className="text-[13px] text-nd-text-muted">{subtitle}</p>
    </div>
  )
}
