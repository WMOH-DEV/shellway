import { toast } from '@/components/ui/Toast'

export async function copyText(text: string, message = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast.error('Could not copy to the clipboard')
  }
}
