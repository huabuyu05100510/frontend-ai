import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.SUB_APPS_PORT || 7182

app.use('/vue2-list', express.static(path.join(__dirname, 'vue2-list')))
app.use('/jquery-form', express.static(path.join(__dirname, 'jquery-form')))
app.use('/react-detail', express.static(path.join(__dirname, 'react-detail')))
app.use('/image-edit', express.static(path.join(__dirname, 'image-edit')))
app.use('/text-gen', express.static(path.join(__dirname, 'text-gen')))

// broken 子应用：故意 404 触发沙箱 ErrorBoundary
app.use('/broken', (req, res) => {
  res.status(404).send('Not Found (intentional for ErrorBoundary demo)')
})

// 内部 SDK mock（被 SdkInjector 注入到子应用）
app.get('/mock-internal-sdk/aplus.js', (req, res) => {
  res.type('js').send('// mock A+ SDK\nwindow.__APLUS__ = { ready: true };')
})

app.listen(PORT, () => {
  console.log(`[sub-apps] http://localhost:${PORT}`)
})
