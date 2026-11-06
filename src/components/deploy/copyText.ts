import { toast } from '@/components/ui/Toast'

export function copyText(text: string, what: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error(`Could not copy the ${what.toLowerCase()}`)
  )
}
