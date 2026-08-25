/**
 * ActionColumn 自适应宽度验证（puppeteer-core + 本机 Chrome/Edge）
 * 核心断言：操作列宽度应随"可见按钮数量"收敛——
 *   - 只读用户（user16）：每行仅"详情"1 个按钮 → 操作列窄
 *   - 管理员（admin）：pending 行 详情/确认装货/改派/取消/报异常 5 个按钮 → 操作列宽
 *   断言 admin 操作列宽 > user16 操作列宽，且 user16 列宽接近单按钮宽（不再固定 300px）。
 * 运行：npm run build && node scripts/verify-actioncol.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../dist')
const PORT = 8087
const BASE = `http://127.0.0.1:${PORT}`

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('未找到 dist/index.html，请先执行：npm run build')
  process.exit(1)
}
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('未找到 Chrome/Edge 可执行文件，可通过环境变量 CHROME_PATH 指定')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
}

const server = createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  if (urlPath === '/') urlPath = '/index.html'
  let filePath = path.join(DIST, urlPath)
  if (!existsSync(filePath) || existsSync(filePath) && !filePath.endsWith('.html') && !/\.[a-z0-9]+$/i.test(path.basename(filePath))) {
    filePath = path.join(DIST, 'index.html')
  }
  if (!existsSync(filePath)) {
    res.writeHead(404)
    res.end('Not Found')
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
console.log(`静态服务：${BASE}`)

async function login(page, username, password) {
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
  await page.waitForSelector('input[placeholder="用户名 / 司机手机号"]')
  await page.evaluate(
    ([u, p]) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const userInput = document.querySelector('input[placeholder="用户名 / 司机手机号"]')
      setter.call(userInput, u)
      userInput.dispatchEvent(new Event('input', { bubbles: true }))
      const passInput = document.querySelector('input[placeholder="密码"]')
      setter.call(passInput, p)
      passInput.dispatchEvent(new Event('input', { bubbles: true }))
      const capCode = [...document.querySelectorAll('.login__captcha-img svg text')].map((t) => t.textContent).join('')
      const capInput = document.querySelector('input[placeholder="验证码"]')
      setter.call(capInput, capCode)
      capInput.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [username, password]
  )
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s/g, '').includes('登录'))
    btn.click()
  })
  await page.waitForFunction((u) => localStorage.getItem('blms_user') === u, { timeout: 15000 }, username)
}

/** 测量调度列表"操作"列的实测宽度（表头单元格 offsetWidth）+ 该行按钮数；
 *  statusChip 可选：先点该文案的状态页签过滤（如"待装货"），让多按钮行进入当前页 */
async function measureDispatch(page, statusChip) {
  await page.evaluate(() => { window.location.hash = '/dispatch' })
  await page.waitForSelector('.el-table__row', { timeout: 15000 })
  if (statusChip) {
    await page.evaluate((label) => {
      const chips = [...document.querySelectorAll('.stat-chip')]
      const c = chips.find((x) => (x.textContent || '').includes(label))
      if (c) c.click()
    }, statusChip)
    await new Promise((r) => setTimeout(r, 400))
  }
  await new Promise((r) => setTimeout(r, 600)) // 等 ActionColumn 收敛
  return page.evaluate(() => {
    // 找到"操作"表头
    const ths = [...document.querySelectorAll('.el-table__header th')]
    const opTh = ths.find((t) => (t.textContent || '').trim() === '操作')
    const opWidth = opTh ? opTh.offsetWidth : -1
    // 每行操作单元格按钮数
    const rows = [...document.querySelectorAll('.el-table__row')]
    const perRow = rows.map((r) => {
      const cell = r.querySelector('.action-cell')
      return cell ? cell.querySelectorAll('.el-button').length : 0
    })
    const maxBtns = Math.max(0, ...perRow)
    // 诊断：每行状态（第二列通常是状态列）
    const statusCol = ths.findIndex((t) => (t.textContent || '').includes('状态'))
    const statuses = rows.map((r) => {
      const cells = r.querySelectorAll('td .cell')
      return statusCol > -1 && cells[statusCol] ? cells[statusCol].textContent.trim() : '?'
    })
    return { opWidth, rowCount: rows.length, maxBtns, perRow, statuses }
  })
}

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '（' + extra + '）' : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? '（' + extra + '）' : ''}`) }
}

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
})

try {
  // 只读用户：同样筛"待装货"，每行仅"详情"1 按钮
  const ctx1 = await browser.createBrowserContext()
  const p1 = await ctx1.newPage()
  await login(p1, 'user16', '123456')
  const ro = await measureDispatch(p1, '待装货')
  await ctx1.close()

  // 管理员：筛选"待装货"，pending 行 5 按钮（详情/确认装货/改派/取消/报异常）
  const ctx2 = await browser.createBrowserContext()
  const p2 = await ctx2.newPage()
  await login(p2, 'admin', '123456')
  const adm = await measureDispatch(p2, '待装货')
  await ctx2.close()

  console.log(`\n只读用户 user16：操作列 ${ro.opWidth}px，行数 ${ro.rowCount}，最多按钮 ${ro.maxBtns}`)
  console.log(`  状态分布：${ro.statuses.join(' / ')}`)
  console.log(`管理员 admin：   操作列 ${adm.opWidth}px，行数 ${adm.rowCount}，最多按钮 ${adm.maxBtns}`)
  console.log(`  状态分布：${adm.statuses.join(' / ')}`)

  check('只读用户操作列已收敛（< 200px，不再固定 300px）', ro.opWidth > 0 && ro.opWidth < 200, `${ro.opWidth}px`)
  check('只读用户每行仅 1 个按钮（详情）', ro.maxBtns === 1, `max=${ro.maxBtns}`)
  check('管理员 pending 行按钮 > 只读用户', adm.maxBtns > ro.maxBtns, `admin=${adm.maxBtns} vs ro=${ro.maxBtns}`)
  check('管理员操作列宽 > 只读用户操作列宽（随按钮数收敛）', adm.opWidth > ro.opWidth, `${adm.opWidth}px vs ${ro.opWidth}px`)
  check('管理员操作列宽 ≤ 420px（maxWidth 上限）', adm.opWidth <= 420, `${adm.opWidth}px`)
} finally {
  await browser.close()
  server.close()
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
