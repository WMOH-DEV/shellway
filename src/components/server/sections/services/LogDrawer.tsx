import { Modal } from '@/components/ui/Modal'
import type { ServiceItem } from '@/utils/server/services/list'
import { serviceLogSource } from '@/utils/server/services/logSources'
import type { ServerSectionContext } from '../types'
import { LogPanel } from './LogPanel'

export function LogDrawer({ ctx, item, onClose }: { ctx: ServerSectionContext; item: ServiceItem | null; onClose(): void }) {
  return (
    <Modal open={item !== null} onClose={onClose} title={item ? `Logs: ${item.name}` : undefined} maxWidth="max-w-5xl">
      {item && (
        <div className="h-[65vh]">
          <LogPanel ctx={ctx} source={serviceLogSource(item)} />
        </div>
      )}
    </Modal>
  )
}
