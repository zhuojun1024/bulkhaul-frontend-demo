import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../dist')
const PORT = 8090
const BASE = `http://127.0.0.1:${PORT}`

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, BASE).pathname)
  if (urlPath.startsWith('/api')) {
    const opts = { host: '127.0.0.1', port: 8081, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:8081' } }
    const proxyReq = httpRequest(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
      proxyRes.pipe(res)
    })
    proxyReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'proxy: ' + e.message, code: 'proxy' }))
    })
    req.pipe(proxyReq)
    return
  }
  let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath)
  if (!filePath.startsWith(DIST) || !existsSync(filePath) || !path.extname(filePath)) filePath = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
})
server.listen(PORT, '127.0.0.1', () => console.log('smoke server on ' + BASE))
