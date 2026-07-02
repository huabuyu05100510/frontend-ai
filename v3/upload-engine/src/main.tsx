import React from 'react'
import ReactDOM from 'react-dom/client'
import { setupMockAPI } from './mock-api'
import { UploadDemo } from './components/UploadDemo'

// 开发模式注入 mock API
if (import.meta.env.DEV) {
  setupMockAPI()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UploadDemo />
  </React.StrictMode>,
)