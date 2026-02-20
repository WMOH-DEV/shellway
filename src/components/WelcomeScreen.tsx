import { Wifi, Plus, Zap, Shield, FolderTree, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useUIStore } from '@/stores/uiStore'

/**
 * Welcome/onboarding screen shown when no connections are active.
 * Displayed in the main content area.
 */
export function WelcomeScreen() {
  const { requestSessionForm, requestQuickConnectFocus, sidebarOpen, toggleSidebar } = useUIStore()

  const handleCreateSession = () => {
    // Ensure sidebar is open so the form can be seen
    if (!sidebarOpen) toggleSidebar()
    requestSessionForm()
  }

  const handleQuickConnect = () => {
    // Ensure sidebar is open and focus the quick connect input
    if (!sidebarOpen) toggleSidebar()
    requestQuickConnectFocus()
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 animate-fade-in">
      {/* Logo */}
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-6 shadow-lg shadow-blue-500/20">
        <Wifi size={28} className="text-white" />
      </div>

      {/* Title */}
      <h1 className="text-2xl font-bold text-nd-text-primary mb-2">
        Welcome to Shellway
      </h1>
      <p className="text-sm text-nd-text-secondary mb-8 text-center max-w-md">
        Your gateway to secure server management. Connect via SSH, transfer files with SFTP,
        and forward ports — all from one beautiful interface.
      </p>

      {/* Quick actions */}
      <div className="flex items-center gap-3 mb-12">
        <Button variant="primary" size="lg" onClick={handleCreateSession}>
          <Plus size={16} />
          Create Session
        </Button>
        <Button variant="secondary" size="lg" onClick={handleQuickConnect}>
          <Zap size={16} />
          Quick Connect
        </Button>
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-3 gap-6 max-w-2xl">
        <FeatureCard
          icon={<Terminal size={20} />}
          title="SSH Terminal"
          description="Full-featured terminal with tabs, split panes, and command snippets"
        />
        <FeatureCard
          icon={<FolderTree size={20} />}
          title="SFTP Manager"
          description="Dual-pane file manager with drag-and-drop, previews, and sync"
        />
        <FeatureCard
          icon={<Shield size={20} />}
          title="Secure by Design"
          description="Encrypted credentials, host key verification, and context isolation"
        />
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center text-center p-4 rounded-lg bg-nd-bg-secondary border border-nd-border">
      <div className="w-10 h-10 rounded-lg bg-nd-surface flex items-center justify-center text-nd-accent mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-medium text-nd-text-primary mb-1">{title}</h3>
      <p className="text-2xs text-nd-text-muted leading-relaxed">{description}</p>
    </div>
  )
}
