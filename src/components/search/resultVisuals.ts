import {
  AlignLeft,
  Braces,
  ChevronRight,
  Cog,
  Columns,
  Database,
  File,
  Folder,
  Globe,
  History,
  Server,
  Settings,
  Table2,
  type LucideIcon
} from 'lucide-react'
import type { ResultIcon } from '@/search/types'

interface Visual {
  Icon: LucideIcon
  tone: string
}

export const RESULT_VISUALS: Record<ResultIcon, Visual> = {
  table: { Icon: Table2, tone: 'text-nd-chart-blue' },
  column: { Icon: Columns, tone: 'text-nd-chart-blue' },
  database: { Icon: Database, tone: 'text-nd-chart-blue' },
  query: { Icon: AlignLeft, tone: 'text-nd-chart-purple' },
  file: { Icon: File, tone: 'text-nd-text-secondary' },
  folder: { Icon: Folder, tone: 'text-nd-text-secondary' },
  command: { Icon: ChevronRight, tone: 'text-nd-success-fg' },
  history: { Icon: History, tone: 'text-nd-text-muted' },
  server: { Icon: Server, tone: 'text-nd-chart-cyan' },
  site: { Icon: Globe, tone: 'text-nd-chart-emerald' },
  service: { Icon: Cog, tone: 'text-nd-chart-orange' },
  snippet: { Icon: Braces, tone: 'text-nd-chart-yellow' },
  setting: { Icon: Settings, tone: 'text-nd-text-secondary' }
}
