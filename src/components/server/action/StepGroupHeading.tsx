interface GroupedStep {
  group?: string
}

const startsGroup = (steps: readonly GroupedStep[], index: number): boolean =>
  Boolean(steps[index].group) && steps[index].group !== steps[index - 1]?.group

export function StepGroupHeading({ steps, index }: { steps: readonly GroupedStep[]; index: number }) {
  if (!startsGroup(steps, index)) return null
  return <h3 className="px-1 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-nd-text-dim">{steps[index].group}</h3>
}
