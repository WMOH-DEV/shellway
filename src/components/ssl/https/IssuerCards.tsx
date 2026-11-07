import { CardLabel } from '../Card'

interface IssuerCardsProps {
  setupNote: string | null
  certbotLikelyFails: boolean
}

export function IssuerCards({ setupNote, certbotLikelyFails }: IssuerCardsProps) {
  return (
    <section aria-label="Who issues the certificate" className="flex flex-col gap-2">
      <CardLabel>Who issues the certificate</CardLabel>
      <div role="group" aria-label="Certificate issuer" className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-2">
        <button
          type="button"
          aria-pressed
          className="flex items-start gap-3 rounded-[10px] border border-nd-accent/70 bg-nd-accent/[.07] p-3.5 text-left"
        >
          <span aria-hidden className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-nd-accent">
            <span className="h-2 w-2 rounded-full bg-nd-accent" />
          </span>
          <span className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-nd-text-primary">Let's Encrypt with certbot</span>
              {!certbotLikelyFails && <span className="rounded bg-nd-success/12 px-1.5 py-px text-[11px] font-medium text-nd-success-fg">Recommended</span>}
            </span>
            <span className="text-[12.5px] text-nd-text-secondary">Free. Renews by itself every ~60 days. Works with or without Cloudflare.</span>
            {setupNote && <span className="text-xs text-nd-warning-fg">{setupNote}</span>}
            {certbotLikelyFails && (
              <span className="text-xs text-nd-warning-fg">
                Port 80 is not reachable for these names, so Let's Encrypt will likely fail. Use the Origin CA switch after adding a certificate, or open port 80.
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={false}
          disabled
          className="flex items-start gap-3 rounded-[10px] border border-nd-border bg-nd-surface p-3.5 text-left opacity-60"
        >
          <span aria-hidden className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px] border-nd-text-muted" />
          <span className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-nd-text-primary">Cloudflare Origin CA</span>
            <span className="text-[12.5px] text-nd-text-secondary">Valid up to 15 years, no renewals. Only works while every name stays proxied.</span>
            <span className="text-xs text-nd-text-muted">Available with the Origin CA switch</span>
          </span>
        </button>
      </div>
    </section>
  )
}
