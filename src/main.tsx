import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { adoptWindowHandoff } from './utils/windowHandoff'
import './index.css'

function render(): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

adoptWindowHandoff()
  .catch((err) => console.warn('Failed to adopt window handoff:', err))
  .finally(render)
