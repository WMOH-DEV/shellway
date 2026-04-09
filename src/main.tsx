import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StandaloneDatabaseApp } from './StandaloneDatabaseApp'
import { StandaloneMonitorApp } from './StandaloneMonitorApp'
import { StandaloneSFTPApp } from './StandaloneSFTPApp'
import { StandaloneTerminalApp } from './StandaloneTerminalApp'
import { getStandaloneConfig } from './standalone'
import type { StandaloneConfig } from './standalone'
import './index.css'

function renderRoot(config: StandaloneConfig | null) {
  if (!config) return <App />
  if (config.mode === 'monitor') return <StandaloneMonitorApp config={config} />
  if (config.mode === 'sftp') return <StandaloneSFTPApp config={config} />
  if (config.mode === 'terminal') return <StandaloneTerminalApp config={config} />
  return <StandaloneDatabaseApp config={config} />
}

const standaloneConfig = getStandaloneConfig()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {renderRoot(standaloneConfig)}
  </React.StrictMode>
)
