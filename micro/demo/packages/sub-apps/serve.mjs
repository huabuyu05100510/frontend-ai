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
app.use('/waterfall', express.static(path.join(__dirname, 'waterfall')))
app.use('/footer', express.static(path.join(__dirname, 'footer')))

// ─── 跨域第三方应用反代（让跨域 Gradio 变同源 → SdkInjector 可注入 + ResizeObserver 可测高）───
// 上游映射：/proxy/<alias>/* → upstream/*
// HTML 响应注入 <base href="/proxy/<alias>/"> 让相对资源（/static/xxx）解析到反代路径
// 同源后 shell 的 attachAutoHeight 直接读 iframe.contentDocument.body.scrollHeight → 内容驱动
const PROXY_UPSTREAMS = {
  flux: 'https://black-forest-labs-flux-1-schnell.hf.space',
  qwen3: 'https://qwen-qwen3-demo.hf.space',
  boogu: 'https://boogu-boogu-image-edit-gradio.ms.show',
}

app.use('/proxy/:alias', async (req, res) => {
  const alias = req.params.alias
  const upstream = PROXY_UPSTREAMS[alias]
  if (!upstream) return res.status(404).send(`unknown proxy alias: ${alias}`)

  // 去掉 /proxy/<alias> 前缀，保留 query
  const subPath = req.originalUrl.slice(`/proxy/${alias}`.length)
  const url = upstream + subPath

  const upstreamHost = new URL(upstream).host
  try {
    const resp = await fetch(url, {
      headers: {
        ...req.headers,
        host: upstreamHost,
        referer: upstream + '/',
        'user-agent': req.headers['user-agent'] || 'micro-sandbox-proxy',
      },
      // 不带 cookie（避免透传灰度 cookie 给上游）
    })
    if (!resp.ok) return res.status(resp.status).send(`upstream ${resp.status}`)

    const ct = resp.headers.get('content-type') || ''
    // 转发大部分响应头（保留 content-type / content-length 等），剔除可能引发 CORS 问题的字段
    for (const k of ['content-type', 'cache-control', 'etag', 'last-modified']) {
      const v = resp.headers.get(k)
      if (v) res.setHeader(k, v)
    }

    // HTML：注入 <base> 让相对 URL 解析到反代路径 + 强制 body 流式 + ModelScope 风格高度上报 SDK
    if (ct.includes('text/html')) {
      let html = await resp.text()
      const injectBlock = `
<base href="/proxy/${alias}/">
<style data-proxy-inject>html{height:auto !important;min-height:0 !important;display:block !important}body{height:auto !important;min-height:0 !important;overflow:visible !important;display:block !important}</style>
<script>(function(){
  var throttle=0,lastH=0,raf=0;
  window.__SANDBOX__=window.__SANDBOX__||{};
  window.__SANDBOX__.reportHeight=function(h){h=Math.max(0,h|0);if(Math.abs(h-lastH)<=1)return;lastH=h;var n=Date.now();if(n-throttle<100){if(!raf)raf=requestAnimationFrame(function(){raf=0;post(h)});return}post(h)};
  function post(h){throttle=Date.now();try{parent.postMessage({type:'sandbox:height',height:h},'*')}catch(_){}}
  function measure(){var b=document.body;if(!b)return;var h=b.scrollHeight;if(h>0)window.__SANDBOX__.reportHeight(h)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',measure);else measure();
  window.addEventListener('load',measure);
  var ro=null;function attachRO(){if(!document.body)return;if(ro){try{ro.disconnect()}catch(_){}}if(typeof ResizeObserver!=='undefined'){ro=new ResizeObserver(function(){measure()});ro.observe(document.body)}}
  attachRO();document.addEventListener('DOMContentLoaded',attachRO);
  if(typeof MutationObserver!=='undefined')new MutationObserver(function(){attachRO();measure()}).observe(document.documentElement,{childList:true,subtree:false});
  setInterval(measure,1000);
})();</script>`
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, `<head$1>${injectBlock}`)
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html([^>]*)>/i, `<html$1><head>${injectBlock}</head>`)
      } else {
        html = injectBlock + html
      }
      return res.send(html)
    }

    // 非 HTML（JS/CSS/图片/字体）：字节透传
    const buf = Buffer.from(await resp.arrayBuffer())
    return res.send(buf)
  } catch (err) {
    res.status(502).send(`proxy error: ${err.message}`)
  }
})

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
