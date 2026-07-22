import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface RevealInFolderButtonProps {
  filePath: string
  label?: string
}

export function RevealInFolderButton({ filePath, label = 'Open Folder' }: RevealInFolderButtonProps) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => window.novadeck.shell.showItemInFolder(filePath)}
    >
      <FolderOpen size={13} />
      {label}
    </Button>
  )
}

export default RevealInFolderButton
