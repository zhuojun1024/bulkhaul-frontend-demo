#!/usr/bin/env node
/**
 * D2 API 契约测试（防漂移）：前端 W 映射（src/api/endpoints.js 写端点 method+path）vs 后端控制器路由
 * （@RequestMapping + @Get/Post/Put/DeleteMapping）。不匹配即红（CI 拦截前后端契约漂移）。
 * 把 2026-08-30 手工扫描（hashStr/派车顺序/契约漂移都是"翻译错"）固化成自动化。
 *
 * 用法：node scripts/check-contract.mjs [serverDir]
 *   serverDir 默认 ../bulkhaul-server（本地同级目录）；CI 检出后端仓库后传入其路径。
 * 规则：前端每个 W 写端点（method+归一化 path）必须在后端存在（{...} 路径变量归一为 {x}）；
 *   缺失/方法不符 → 红（exit 1）。后端未被 W 引用的路由（读/认证/快照）为孤儿，仅提示不红。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, '..')
const serverDir = path.resolve(process.argv[2] || path.join(webRoot, '..', 'bulkhaul-server'))
if (!fs.existsSync(path.join(serverDir, 'src', 'main', 'java'))) {
  console.error('[红] 后端目录不存在：' + serverDir + '（serverDir 参数/布局不对——CI 为子目录布局 ./bulkhaul-server，本地为兄弟目录 ../bulkhaul-server）')
  process.exit(2)
}

function norm(p) { return p.replace(/\$\{[^}]+\}/g, '{x}').replace(/\{[^}]+\}/g, '{x}') }

// ---- 前端 W 映射（src/api/endpoints.js）----
const apiSrc = fs.readFileSync(path.join(webRoot, 'src', 'api', 'endpoints.js'), 'utf8')
const lines = apiSrc.split('\n')
const W = []
let cur = null
for (const line of lines) {
  const fnm = line.match(/^\s{2,}(\w+):\s*\{/)
  if (fnm) cur = fnm[1]
  const pm = line.match(/path:\s*(?:\(\w*\)\s*=>\s*)?(?:`([^`]+)`|'([^']+)'|"([^"]+)")/)
  if (pm && cur) {
    const p = pm[1] || pm[2] || pm[3]
    const mm = line.match(/method:\s*'(\w+)'/)
    W.push({ fn: cur, method: mm ? mm[1].toUpperCase() : 'POST', path: norm('/api' + p) })
  }
}

// ---- 后端控制器路由（serverDir/src/main/java/**/*Controller.java）----
function walk(d, out = []) {
  if (!fs.existsSync(d)) return out
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, f.name)
    if (f.isDirectory()) walk(fp, out)
    else if (f.name.endsWith('Controller.java')) out.push(fp)
  }
  return out
}
const controllers = walk(path.join(serverDir, 'src', 'main', 'java'))
const routes = []
for (const cf of controllers) {
  const src = fs.readFileSync(cf, 'utf8')
  const cm = src.match(/@RequestMapping\("([^"]+)"\)/)
  const base = cm ? cm[1] : ''
  const mre = /@(Get|Post|Put|Delete)Mapping\((?:value\s*=\s*)?"([^"]*)"/g
  let mm2
  while ((mm2 = mre.exec(src)) !== null) {
    routes.push({ method: mm2[1].toUpperCase(), path: norm(base + mm2[2]), file: path.basename(cf) })
  }
}

// ---- 契约检查：前端每个 W 端点必须在后端存在 ----
const backendSet = new Set(routes.map(r => r.method + ' ' + r.path))
const missing = W.filter(e => !backendSet.has(e.method + ' ' + e.path))
const frontendSet = new Set(W.map(e => e.method + ' ' + e.path))
const orphans = routes.filter(r => !frontendSet.has(r.method + ' ' + r.path))

console.log('=== D2 API 契约测试（前端 W 映射 vs 后端路由）===')
console.log('前端 W 写端点：' + W.length + '；后端路由：' + routes.length)
if (missing.length) {
  console.log('\n[红] 前端 W 端点在后端缺失/方法不符（契约漂移）：')
  for (const e of missing) console.log('  ' + e.method + ' ' + e.path + '  (' + e.fn + ')')
  console.log('\nFAIL：' + missing.length + ' 个契约漂移')
  process.exit(1)
}
console.log('[绿] 前端 ' + W.length + ' 个 W 写端点全部在后端匹配（method+path）')
if (orphans.length) {
  console.log('\n[提示] 后端未被 W 映射引用的路由（读/认证/快照/管理，非写端点，不红）：' + orphans.length)
  for (const r of orphans.slice(0, 12)) console.log('  ' + r.method + ' ' + r.path + '  (' + r.file + ')')
  if (orphans.length > 12) console.log('  ... 另 ' + (orphans.length - 12) + ' 个')
}
console.log('\nPASS：契约一致（' + W.length + '/' + W.length + '）')
