// 模型：claude-sonnet-4-6
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'
import './a11y/reducedMotion.css'
import './design/semantic.css'
import './design/dark.css'
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion'
import { useTheme } from './hooks/useTheme'

// Initialize guards before React renders
function Bootstrap() {
  usePrefersReducedMotion()
  useTheme()
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Bootstrap />
    </BrowserRouter>
  </React.StrictMode>
)
