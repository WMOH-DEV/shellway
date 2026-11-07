import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Notice } from '@/components/server/kit'
import { DialogFooter, Field, SecretField } from './DialogParts'

export function SecretOnceDialog({ title, account, password, onClose }: { title: string; account: string; password: string; onClose(): void }) {
  return (
    <Modal open onClose={onClose} title={title} closeOnBackdrop={false}>
      <div className="flex flex-col gap-4">
        <Field label={`Password for ${account}`}>
          <SecretField value={password} />
        </Field>
        <Notice tone="warning" title="Copy it now">Shellway does not keep this password. After you close this window it cannot be shown again.</Notice>
      </div>
      <DialogFooter>
        <Button variant="primary" onClick={onClose}>I saved it</Button>
      </DialogFooter>
    </Modal>
  )
}
