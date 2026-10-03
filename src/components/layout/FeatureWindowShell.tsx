import { useEffect } from 'react'
import { TitleBar } from './TitleBar'
import { StatusBar } from './StatusBar'
import { useSession } from '@/hooks/useSession'

export function FeatureWindowShell({ title, children }: { title: string; children: React.ReactNode }) {
  useSession()

  useEffect(() => {
    document.title = title
  }, [title])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-nd-bg-primary">
      <TitleBar title={title} />
      <main className="flex-1 overflow-hidden">{children}</main>
      <StatusBar />
    </div>
  )
}
