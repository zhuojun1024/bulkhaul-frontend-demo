/**
 * UI 层 e2e 冒烟测试（puppeteer-core + 本机 Chrome/Edge，弥补 D1：UI 接线零覆盖）
 * 覆盖场景（每场景独立浏览器上下文，localStorage 全新种子数据）：
 *  1. admin 登录 → 工作台 → 调度列表 → 待装货车次详情 → 确认装货（主链路真实操作）
 *  2. 结算专员（user03）直改 URL 访问 /dispatch → 被路由守卫拦截回工作台，侧边栏无该菜单
 *  3. 只读用户（user16）可访问调度列表但无任何操作按钮
 *  4. 客户（customer01）登录直达门户 → 本方账单/合同 → 确认对账；访问 /settlement 被拦截
 *  5. admin 安全管理三个登记入口（G1：事故登记真实提交）
 *  6. admin 合同管理"运输需求"页签 → 生成合同草稿（G2 后端侧）
 *  7. 客户门户发起运输需求（G2 客户侧：表单 → 我的运输需求新增）
 *  8. 司机端收入结算视图（G3：收入卡片 + 趟次收入明细）
 *  9. 司机账号手机号登录 → 司机端锁定账号（G5）
 *  10. admin 消息中心：未读角标 → 全部已读（G6）
 *  11. admin 银行对账页签 → 自动核销（G8）
 *  12. admin 客户数据导入：CSV 上传 → 预览校验 → 确认导入（G7）
 *  13. P2 架构下沉：在途进度由全局定时任务推进（UI 只读）+ 只读用户无操作按钮
 *  14. N-1 回归：司机账号全链路扫码（接单→扫码装货→发车→到达→扫码卸货签收，司机端入口不被 RBAC 拦截）
 *  15. M8 回归：登录失败锁定（连续 5 次失败 → 5 分钟锁定，刷新后仍生效）
 *  16. 环节1-3 回归：补签入口 / 客户异议 / 改价审批（UI 接线）
 *  17. 环节4-6：质量扣减费用项 / 预付款台账+收取+抵扣 / 消息免打扰（UI 接线）
 *  18. 环节7-8：安全库存预警（预警面板+设置） / 数据权限行级过滤（user02 仅华北）
 * 运行：npm run build && node scripts/verify-ui.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../dist')
const PORT = 8086
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

/* ===== 静态服务（dist + SPA fallback） ===== */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}
const { request: httpRequest } = await import('node:http')
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, BASE).pathname)
  // 切真实 API：/api/* 反向代理到后端 8081（无 CORS，前端用相对 /api）
  if (urlPath.startsWith('/api')) {
    const opts = {
      host: '127.0.0.1',
      port: 8081,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:8081' }
    }
    const proxyReq = httpRequest(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
      proxyRes.pipe(res)
    })
    proxyReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: '后端代理失败: ' + e.message, code: 'proxy' }))
    })
    req.pipe(proxyReq)
    return
  }
  let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath)
  if (!filePath.startsWith(DIST) || !existsSync(filePath) || !path.extname(filePath)) {
    filePath = path.join(DIST, 'index.html')
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(PORT, '127.0.0.1', resolve)
})

/* ===== 断言 ===== */
let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) {
    pass++
    console.log('  ✓', name)
  } else {
    fail++
    console.log('  ✗', name)
  }
}

/* ===== 页面工具 ===== */
async function newPage(browser) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [page-error]', msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => console.log('  [page-crash]', String(err).slice(0, 300)))
  return { ctx, page }
}

/** 登录（el-input 通过原生 setter 触发 v-model；账号支持用户名或司机手机号；环节9 自动读取并填写图形验证码） */
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
      // 环节9：读取图形验证码（SVG <text> 字符）并填写
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
  // 切真实 API：登录页 onLogin 在 blms_user 落盘后才 hydrate() 填充 db.users 并 router.push(home)。
  // 路由守卫读 db.users 判定权限，须等浏览器离开登录页（hydrate + 导航完成）后再做后续导航，
  // 否则守卫因 db.users 未填充而误判未登录 → 重定向回登录页。
  await page.waitForFunction(() => !window.location.hash.startsWith('#/login'), { timeout: 15000 })
}

/** 应用内 hash 导航 */
async function nav(page, hash) {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

/* ===== 切真实 API：node 侧读后端快照（替代旧架构的 localStorage['blms_db_snapshot']） =====
 * 新架构 db 由后端 hydrate（GET /api/snapshot），浏览器不再写 localStorage 快照。
 * 测试需要"种子态"或"写后持久化"数据时，node 侧直接登录后端拉快照（独立于浏览器）。 */
const BACKEND = 'http://127.0.0.1:8081/api'
let _backendToken = null
async function getBackendSnapshot() {
  if (!_backendToken) {
    const cap = (await (await fetch(BACKEND + '/auth/captcha')).json()).data
    const loginRes = await fetch(BACKEND + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456', captchaId: cap.id, captchaCode: cap.code })
    })
    _backendToken = (await loginRes.json()).data.token
  }
  const snapRes = await fetch(BACKEND + '/snapshot', { headers: { Authorization: 'Bearer ' + _backendToken } })
  return (await snapRes.json()).data
}
/** 轮询后端快照直到条件满足（替代旧架构的 page.waitForFunction 读 localStorage）；超时返回 false */
async function waitForBackend(condFn, { timeout = 15000, interval = 500 } = {}) {
  const start = Date.now()
  for (;;) {
    const v = condFn(await getBackendSnapshot())
    if (v) return v
    if (Date.now() - start > timeout) return false
    await new Promise((r) => setTimeout(r, interval))
  }
}
/** 重置后端内存数据仓库回种子态（等价旧架构"每场景全新种子"：跨场景恢复种子前置数据）。
 *  回归组（场景 16-19）依赖种子前置数据，而主链路组（场景 1-15）会消耗种子资源，
 *  故每个回归场景开始前重置，保证浏览器 hydrate 与 node 侧 waitForBackend 都读到种子态。 */
async function resetDemo() {
  await getBackendSnapshot() // 确保 token 已登录
  const res = await fetch(BACKEND + '/admin/reset-demo', { method: 'POST', headers: { Authorization: 'Bearer ' + _backendToken } })
  const r = await res.json()
  if (!r.ok) console.log('  [reset-demo] 重置失败：', r.error)
  return r.ok
}
/** node 侧调后端 API（带 token），供 P2 手动驱动 /api/scheduler/tick 与创建车次（确定性，不受 auto-enabled 限制） */
async function apiPost(p, body = {}) {
  await getBackendSnapshot() // 确保 token
  const res = await fetch(BACKEND + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + _backendToken },
    body: JSON.stringify(body)
  })
  return (await res.json())
}

/** 弹窗内 el-select（按表单项标签定位）：打开下拉 → 输入过滤 → 点击匹配选项 */
async function pickDialogSelect(page, label, keyword) {
  await page.evaluate((label) => {
    const dialog = document.querySelector('.el-dialog')
    const items = [...dialog.querySelectorAll('.el-form-item')]
    const item = items.find((i) => (i.querySelector('.el-form-item__label')?.textContent || '').includes(label))
    const sel = item.querySelector('.el-select')
    const wrapper = sel.querySelector('.el-select__wrapper') || sel
    wrapper.click()
  }, label)
  await page.waitForFunction(
    () => [...document.querySelectorAll('.el-select-dropdown__item')].some((i) => i.offsetParent !== null),
    { timeout: 5000 }
  )
  await page.evaluate(({ label, keyword }) => {
    const dialog = document.querySelector('.el-dialog')
    const items = [...dialog.querySelectorAll('.el-form-item')]
    const item = items.find((i) => (i.querySelector('.el-form-item__label')?.textContent || '').includes(label))
    const input = item.querySelector('.el-select input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, keyword)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, { label, keyword })
  await page.waitForFunction(
    ({ keyword }) => [...document.querySelectorAll('.el-select-dropdown__item')].some((i) => i.offsetParent !== null && i.textContent.includes(keyword)),
    { timeout: 5000 },
    { keyword }
  )
  await page.evaluate(({ keyword }) => {
    const item = [...document.querySelectorAll('.el-select-dropdown__item')].find((i) => i.offsetParent !== null && i.textContent.includes(keyword))
    item.click()
  }, { keyword })
  await new Promise((r) => setTimeout(r, 250))
}

/** 点击 ElMessageBox 的"确定" */
async function confirmBox(page) {
  await page.waitForSelector('.el-message-box', { timeout: 10000 })
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.el-message-box__btns button')]
    btns.find((b) => b.textContent.includes('确'))?.click()
  })
}

/** 点击指定调度单行的"详情"按钮并等待导航（失败重试一次，规避表格重渲染竞态） */
async function clickAndWaitNav(page, dispatchId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate((id) => {
      const rows = [...document.querySelectorAll('.el-table__row')]
      const row = rows.find((r) => r.textContent.includes(id))
      const btn = row && [...row.querySelectorAll('button')].find((b) => b.textContent.includes('详情'))
      btn && btn.click()
    }, dispatchId)
    try {
      await page.waitForFunction((id) => window.location.hash.includes(id), { timeout: 5000 }, dispatchId)
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1600,900']
})

try {
  // 脚本起点重置后端内存数据仓库回种子态（等价旧架构"每场景全新种子"）。
  // 后端 commitAll 会把前次测试/演示的业务写操作回写 biz_*（污染种子：消耗在途车次、
  // 结算收款等），重启后内存态从污染态加载；脚本开头重置保证场景 1-15（主链路组）
  // 从干净种子态开始，P2 监控页（在途车次遥测推进）等依赖种子前置数据的场景可复现。
  await resetDemo()
  console.log('== 0. 重置后端回种子态（commitAll 污染防护） ==')

  /* ===== 场景 1：admin 登录 → 主链路操作（确认装货） ===== */
  console.log('== 1. admin：登录 → 调度 → 确认装货（主链路） ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    check('admin 登录成功进入工作台', page.url().includes('#/workbench'))

    await nav(page, '#/dispatch')
    await page.waitForSelector('.el-table__row')
    // 用状态筛选芯片切到"待装货"，保证第一行可确认装货
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('.stat-chip')].find((c) => c.textContent.includes('待装货'))
      chip?.click()
    })
    await page.waitForFunction(() => {
      const row = document.querySelector('.el-table__row')
      return row && row.textContent.includes('待装货')
    })
    // 筛选后等待表格渲染稳定（避免在重渲染中途点击）
    await new Promise((r) => setTimeout(r, 600))
    const dispatchId = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.el-table__row')]
      const row = rows.find((r) => r.textContent.includes('待装货')) || rows[0]
      return row.textContent.match(/PD-\d{5}/)?.[0] || ''
    })
    const navOk = await clickAndWaitNav(page, dispatchId)
    check('进入待装货调度单详情（' + dispatchId + '）', navOk)

    const hasLoadBtn = await page.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) => b.textContent.includes('确认装货'))
    )
    check('详情页有"确认装货"按钮（admin 有 dispatch 操作权）', hasLoadBtn)
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('确认装货'))
      btn.click()
    })
    await confirmBox(page)
    await page.waitForFunction(() => {
      const tag = document.querySelector('.dispatch-detail__name')
      return tag && tag.textContent.includes('装货中')
    })
    check('确认装货后状态流转为"装货中"（flow 状态机在 UI 生效）', true)

    // 调度详情展示装/卸货码（扫码确认入口）
    const hasCodes = await page.evaluate(() => {
      const text = document.querySelector('.page')?.textContent || ''
      return /ZD\d{6}/.test(text) && /XD\d{6}/.test(text)
    })
    check('调度详情展示装货码/卸货码（扫码确认）', hasCodes)
    await ctx.close()
  }

  /* ===== 场景 2：结算专员权限拦截（user04=结算专员，无 /dispatch 菜单） ===== */
  console.log('== 2. 结算专员（user04）：直改 URL 访问 /dispatch 被拦截 ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'user04', '123456')
    await page.waitForSelector('.page')
    const hasMenu = await page.evaluate(() => (document.querySelector('.layout__sidebar')?.textContent || '').includes('调度管理'))
    check('侧边栏无"调度管理"菜单（结算专员）', !hasMenu)
    // 先切到一个可访问的非工作台页，避免"重定向目标=当前页"的边界，使拦截跳转可观测
    await nav(page, '#/settlement')
    await page.waitForFunction(() => window.location.hash.startsWith('#/settlement'))
    // 再直改 URL 访问无权限的 /dispatch → 路由守卫应拦截回工作台
    await nav(page, '#/dispatch')
    await page.waitForFunction(() => window.location.hash.startsWith('#/workbench'))
    check('无 /dispatch 菜单权限 → 路由守卫拦截回工作台', true)
    const dispatchRendered = await page.evaluate(() =>
      (document.querySelector('.page')?.querySelector('[class*=title]')?.textContent || '').includes('调度管理')
    )
    check('调度管理页未渲染（权限拦截生效）', !dispatchRendered)
    await ctx.close()
  }

  /* ===== 场景 3：只读用户（user16）：可见不可操作 ===== */
  console.log('== 3. 只读用户（user16）：菜单可见、操作按钮全部隐藏 ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'user16', '123456')
    await page.waitForSelector('.page')
    await nav(page, '#/dispatch')
    await page.waitForSelector('.el-table__row')
    check('只读用户可访问调度列表（菜单全开）', page.url().includes('#/dispatch'))
    const hasActionBtns = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.el-table__row')]
      return rows.some((r) =>
        [...r.querySelectorAll('button')].some((b) =>
          ['确认装货', '发车', '到达', '确认卸货', '恢复', '报异常'].some((t) => b.textContent.includes(t))
        )
      )
    })
    check('列表行无任何调度/异常操作按钮（只读）', !hasActionBtns)
    await ctx.close()
  }

  /* ===== 场景 4：客户门户（customer01） ===== */
  console.log('== 4. 客户（customer01）：门户展示 + 确认对账 + 内部菜单拦截 ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'customer01', '123456')
    await page.waitForSelector('.page')
    check('客户登录默认进入客户门户', page.url().includes('#/portal'))
    const custName = await page.evaluate(() => document.querySelector('.page')?.textContent?.includes('晋能控股煤业集团') || false)
    check('门户展示绑定客户（晋能控股煤业集团）', custName)
    await page.waitForSelector('.el-table__row')
    const rowCount = await page.evaluate(() => document.querySelectorAll('.el-table__row').length)
    check('门户展示本方合同/账单数据', rowCount > 0)

    // 确认对账（若存在"对账中"账单）
    const hasConfirmBtn = await page.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) => b.textContent.includes('确认对账'))
    )
    if (hasConfirmBtn) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('确认对账'))
        btn.click()
      })
      await confirmBox(page)
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.el-tag')].some((t) => t.textContent.includes('已确认'))
      )
      check('客户确认对账：按钮 → 弹窗确认 → 已确认标记', true)
    } else {
      console.log('  - 跳过确认对账（本方无"对账中"账单）')
    }

    await nav(page, '#/settlement')
    await page.waitForFunction(() => window.location.hash.startsWith('#/workbench') || window.location.hash.startsWith('#/portal'))
    check('客户访问 /settlement 被拦截（无该菜单权限）', !page.url().includes('#/settlement'))
    await ctx.close()
  }

  /* ===== 场景 5：admin 安全管理新增入口（G1：事故/培训/检查登记） ===== */
  console.log('== 5. admin：安全管理登记入口（G1） ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    await nav(page, '#/safety')
    await page.waitForSelector('.el-table__row')
    const entryBtns = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].map((b) => b.textContent)
      return {
        accident: btns.some((t) => t.includes('登记事故')),
        training: btns.some((t) => t.includes('培训计划')),
        inspection: btns.some((t) => t.includes('登记检查'))
      }
    })
    check('安全页三个登记入口可见（事故/培训/检查）', entryBtns.accident && entryBtns.training && entryBtns.inspection)

    // 事故登记（真实提交 → 列表新增一行）
    const accRowsBefore = await page.evaluate(() => document.querySelectorAll('.el-table__row').length)
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('登记事故'))
      btn.click()
    })
    await page.waitForSelector('.el-dialog')
    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      const desc = dialog.querySelector('textarea')
      setter.call(desc, 'UI e2e：事故登记')
      desc.dispatchEvent(new Event('input', { bubbles: true }))
      const submit = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('确认登记'))
      submit.click()
    })
    await page.waitForFunction(
      (before) => document.querySelectorAll('.el-table__row').length === before + 1,
      { timeout: 10000 },
      accRowsBefore
    )
    check('事故登记：弹窗提交 → 列表新增记录（flow 联动生效）', true)
    await ctx.close()
  }

  /* ===== 场景 6：admin 合同管理 → 运输需求 → 生成合同草稿（G2 后端侧） ===== */
  console.log('== 6. admin：合同管理运输需求页签 → 生成合同草稿（G2） ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    await nav(page, '#/contract')
    await page.waitForSelector('.el-table__row')
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.el-tabs__item')].find((t) => t.textContent.includes('运输需求'))
      tab.click()
    })
    await page.waitForFunction(() => [...document.querySelectorAll('.el-table__row')].some((r) => r.textContent.includes('YS-')))
    check('运输需求页签展示需求数据（YS- 编号）', true)

    const pendingRow = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.el-table__row')]
      const row = rows.find((r) => r.textContent.includes('待处理'))
      if (!row) return false
      const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('生成合同草稿'))
      btn && btn.click()
      return !!btn
    })
    if (pendingRow) {
      await page.waitForSelector('.el-dialog')
      await page.evaluate(() => {
        const dialog = document.querySelector('.el-dialog')
        const submit = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('确认生成'))
        submit.click()
      })
      await page.waitForFunction(() => [...document.querySelectorAll('.el-table__row')].some((r) => r.textContent.includes('已转合同')))
      check('生成合同草稿：需求状态转为"已转合同"（flow 联动生效）', true)
    } else {
      console.log('  - 跳过转合同（无待处理需求）')
    }
    await ctx.close()
  }

  /* ===== 场景 7：客户门户发起运输需求（G2 客户侧） ===== */
  console.log('== 7. 客户（customer01）：发起运输需求（G2） ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'customer01', '123456')
    await page.waitForSelector('.page')
    const hasReqBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('发起运输需求')))
    check('门户有"发起运输需求"入口（客户角色）', hasReqBtn)

    const reqRowsBefore = await page.evaluate(() => [...document.querySelectorAll('.el-table__row')].filter((r) => r.textContent.includes('YS-')).length)
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('发起运输需求'))
      btn.click()
    })
    await page.waitForSelector('.el-dialog')
    // 依次选择：商品/装货场站/卸货场站/收货方（el-select：打开下拉 → 输入过滤 → 点选项）
    for (const [label, keyword] of [['商品', '动力煤'], ['装货场站', '大同'], ['卸货场站', '秦皇岛'], ['收货方', '宝钢']]) {
      await pickDialogSelect(page, label, keyword)
    }
    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog')
      const submit = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('提交需求'))
      submit.click()
    })
    await page.waitForFunction(
      (before) => [...document.querySelectorAll('.el-table__row')].filter((r) => r.textContent.includes('YS-')).length === before + 1,
      { timeout: 10000 },
      reqRowsBefore
    )
    check('发起运输需求：表单提交 → "我的运输需求"新增待处理记录', true)
    await ctx.close()
  }

  /* ===== 场景 8：司机端收入结算视图（G3） ===== */
  console.log('== 8. 司机端：收入结算视图（G3） ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    await nav(page, '#/driver-app')
    await page.waitForSelector('.driver-app__frame')
    // 默认司机可能无已完成趟次，切换到有已完成车次的司机
    const incomeVisible = await page.evaluate(() => {
      const card = document.querySelector('.income-card')
      return !!card && card.textContent.includes('收入结算')
    })
    check('司机端展示"收入结算"卡片', incomeVisible)
    // 默认司机可能无已完成趟次：必要时逐个切换司机（全量选项），直到出现收入明细行
    let found = await page.evaluate(() => !!document.querySelector('.income-row'))
    for (let i = 0; i < 65 && !found; i++) {
      await page.evaluate((idx) => {
        const sel = document.querySelector('.driver-app__header .el-select')
        const wrapper = sel.querySelector('.el-select__wrapper') || sel
        wrapper.click()
      }, i)
      await page.waitForFunction(() => [...document.querySelectorAll('.el-select-dropdown__item')].some((x) => x.offsetParent !== null), { timeout: 5000 })
      await page.evaluate((idx) => {
        const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter((x) => x.offsetParent !== null)
        items[idx % items.length] && items[idx % items.length].click()
      }, i)
      await new Promise((r) => setTimeout(r, 400))
      found = await page.evaluate(() => !!document.querySelector('.income-row'))
    }
    check('司机端展示趟次收入明细（收入行存在）', found)
    await ctx.close()
  }

  /* ===== 场景 9：司机账号手机号登录 → 司机端锁定账号（G5） ===== */
  console.log('== 9. 司机账号：手机号登录 → 司机端锁定账号（G5） ==')
  {
    // 1) admin 上下文从司机管理列表取一名司机的姓名 + 手机号
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    await nav(page, '#/driver')
    // 等待司机管理页真正渲染（工作台旧表格行会干扰 .el-table__row 等待）
    await page.waitForFunction(() => (document.querySelector('.page-header__title')?.textContent || '').includes('司机管理'))
    await page.waitForSelector('.el-table__row')
    const driverInfo = await page.evaluate(() => {
      const row = document.querySelector('.el-table__row')
      const tds = row.querySelectorAll('td')
      // 姓名单元格含头像首字，取 span 内的完整姓名
      return { name: tds[0]?.querySelector('span')?.textContent.trim() || '', phone: tds[1]?.textContent.trim() || '' }
    })
    check('司机管理列表可取到司机姓名/手机号', /^1[3-9]\d{9}$/.test(driverInfo.phone) && !!driverInfo.name)
    await ctx.close()

    // 2) 新上下文用手机号登录 → 直达司机端且账号锁定
    const { ctx: ctx2, page: page2 } = await newPage(browser)
    await login(page2, driverInfo.phone, '123456')
    await page2.waitForSelector('.driver-app__frame')
    check('司机手机号登录直达司机端', page2.url().includes('#/driver-app'))
    const locked = await page2.evaluate((name) => {
      const header = document.querySelector('.driver-app__header')
      const noSelect = !header.querySelector('.el-select')
      const hasSwitch = [...header.querySelectorAll('button')].some((b) => b.textContent.includes('切换账号'))
      const accountName = (header.querySelector('.driver-app__account')?.textContent || '').includes(name)
      return noSelect && hasSwitch && accountName
    }, driverInfo.name)
    check('司机端账号锁定（无切换下拉 + 切换账号按钮 + 展示本人姓名）', locked)
    await ctx2.close()
  }

  /* ===== 场景 10：admin 消息中心（G6：未读角标 → 全部已读） ===== */
  console.log('== 10. admin：消息中心（G6） ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    const badge = await page.evaluate(() => {
      const b = document.querySelector('.navbar__badge')
      return b ? parseInt(b.textContent, 10) : 0
    })
    check('顶栏未读角标 > 0（种子消息）', badge > 0)

    // 铃铛下拉 → "查看全部消息" → 消息中心页
    await page.evaluate(() => {
      document.querySelector('.navbar__bell').click()
    })
    await page.waitForSelector('.navbar__dropdown-more')
    await page.evaluate(() => {
      document.querySelector('.navbar__dropdown-more').click()
    })
    await page.waitForFunction(() => window.location.hash.startsWith('#/message'))
    await page.waitForSelector('.el-table__row')
    const rowCount = await page.evaluate(() => document.querySelectorAll('.el-table__row').length)
    check('消息中心页展示消息列表', rowCount > 0)

    // 全部已读 → 顶栏角标消失
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('全部已读'))
      btn.click()
    })
    await page.waitForFunction(() => !document.querySelector('.navbar__badge'), { timeout: 10000 })
    check('全部已读后顶栏未读角标消失', true)
    await ctx.close()
  }

  /* ===== 场景 11：admin 银行对账 → 自动核销（G8） ===== */
  console.log('== 11. admin：银行对账自动核销（G8） ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    await nav(page, '#/settlement')
    await page.waitForFunction(() => (document.querySelector('.page-header__title')?.textContent || '').includes('结算管理'))
    await page.waitForSelector('.el-table__row')
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.el-tabs__item')].find((t) => t.textContent.includes('银行对账'))
      tab.click()
    })
    await page.waitForFunction(() => [...document.querySelectorAll('.el-table__row')].some((r) => r.textContent.includes('YH-')))
    const beforeCount = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.el-tabs__item')].find((t) => t.textContent.includes('银行对账'))
      const m = tab.textContent.match(/待核销 (\d+)/)
      return m ? parseInt(m[1], 10) : -1
    })
    check('银行对账页签展示待核销流水（待核销 > 0）', beforeCount > 0)

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('自动核销'))
      btn.click()
    })
    await confirmBox(page)
    await page.waitForFunction(
      (before) => {
        const tab = [...document.querySelectorAll('.el-tabs__item')].find((t) => t.textContent.includes('银行对账'))
        const m = tab.textContent.match(/待核销 (\d+)/)
        return m && parseInt(m[1], 10) < before
      },
      { timeout: 10000 },
      beforeCount
    )
    check('自动核销：待核销数量减少（精确匹配核销）', true)
    const hasNewMatch = await page.evaluate(() =>
      [...document.querySelectorAll('.el-table__row')].some((r) => r.textContent.includes('张建国'))
    )
    check('核销历史新增本次核销记录（核销人=当前操作人）', hasNewMatch)
    await ctx.close()
  }

  /* ===== 场景 12：admin 客户数据导入（G7：CSV → 预览校验 → 确认导入） ===== */
  console.log('== 12. admin：客户数据导入（G7） ==')
  {
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    await nav(page, '#/customer')
    await page.waitForFunction(() => (document.querySelector('.page-header__title')?.textContent || '').includes('客户管理'))
    await page.waitForSelector('.el-table__row')
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('导入')))
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('导入'))
      btn.click()
    })
    await page.waitForSelector('.el-dialog')

    // 生成 CSV（表头 + 1 行新数据 + 1 行重名数据）
    const existingName = await page.evaluate(() => document.querySelector('.customer-cell__name')?.textContent.trim() || '')
    const csvPath = path.join(os.tmpdir(), `blms_import_test.csv`)
    const headers = ['客户名称', '类型(发货方/收货方/双向客户)', '等级(A/B/C)', '区域', '联系人', '电话', '授信额度(元)']
    writeFileSync(
      csvPath,
      '﻿' + [headers, ['G7 E2E 导入客户', '发货方', 'A', '山西', '测试联系人', '13900001111', 1000000], [existingName, '发货方', 'B', '山西', '重名测试', '13900002222', 2000000]]
        .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'),
      'utf8'
    )
    const fileInput = await page.$('.el-dialog input[type=file]')
    await fileInput.uploadFile(csvPath)
    await page.waitForFunction(() => document.querySelectorAll('.el-dialog .el-table__row').length === 2)
    const previewOk = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.el-dialog .el-table__row')]
      return rows.length === 2 && rows.every((r) => r.textContent.includes('通过'))
    })
    check('导入预览：CSV 解析 + 逐行校验通过', previewOk)

    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog')
      const btn = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('确认导入'))
      btn.click()
    })
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.el-dialog .el-alert')].some((a) => a.textContent.includes('已导入 1 条') && a.textContent.includes('跳过重复 1 条'))
    )
    check('确认导入：新增 1 条 + 跳过重复 1 条（flow 去重生效）', true)

    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog')
      const btn = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '关闭')
      btn.click()
    })
    await page.waitForFunction(() => [...document.querySelectorAll('.el-table__row')].some((r) => r.textContent.includes('G7 E2E 导入客户')))
    check('导入后客户列表新增记录', true)
    await ctx.close()
  }

  /* ===== 场景 13：P2 架构下沉（定时任务驱动数据 + 只读用户无操作按钮） ===== */
  console.log('== 13. P2：在途进度由全局定时任务推进 + 只读用户无操作按钮 ==')
  {
    // 重置回种子态（场景 1-12 消耗了种子）。
    await resetDemo()
    // 种子在途车次的 eta 是 dump 时刻的固定过去时间 → 围栏 delay 分支每次 tick 命中 →
    // createException 把车次改成 exception（P2 无稳定可观察目标）。故动态创建新在途车次：
    // depart 生成未来 eta（now + 行驶时长 + 30min），围栏不命中，进度可稳定观察推进。
    // 后端 auto-enabled=false（验证/演示环境确定性运行，不后台自动 tick），
    // 故 node 侧手动驱动 /api/scheduler/tick（等价浏览器前端 timer 每 3s 调 tick），UI 只读、无用户操作。
    const snap0 = await getBackendSnapshot()
    const pending = (snap0.dispatches || []).find((x) => x.status === 'pending')
    let targetId = null
    if (pending) {
      await apiPost('/dispatch/' + pending.id + '/confirmLoad')
      await apiPost('/dispatch/' + pending.id + '/depart')
      targetId = pending.id
    }
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456') // login 时 hydrate 后端快照（已含新建在途车次）
    await page.waitForSelector('.page')
    await nav(page, '#/track')
    await page.waitForSelector('.track-list__item')
    // 新在途车次出现在监控页列表（tag 在途/延误，progress<95；dispatchId 从 data-dispatch-id 读，
    // 铁路车次 vehicleId 为 null 时 plate 映射不可靠）
    const target = await page.evaluate((id) => {
      const el = [...document.querySelectorAll('.track-list__item')].find((i) => i.dataset.dispatchId === id)
      if (!el) return null
      const tag = el.querySelector('.el-tag')?.textContent || ''
      const m = el.textContent.match(/进度 (\d+)%/)
      return m && (tag === '在途' || tag === '延误') ? { dispatchId: id, progress: parseInt(m[1], 10) } : null
    }, targetId)
    check('P2：监控页存在可观察的在途车次', !!target)
    // 进度推进用后端快照（float 精度）观察，而非 UI 文本（取整显示）：
    // 调度器每 tick 随机推进 0~0.9，UI Math.round 取整后窗口内随机增量可能不足 1 → 误报 flaky。
    // node 侧驱动定时任务 tick（等价全局定时任务），UI 只读、无用户操作；float 比较无取整误差。
    let increased = false
    if (target) {
      const base = Number((await getBackendSnapshot()).dispatches.find((x) => x.id === target.dispatchId)?.progress)
      for (let i = 0; i < 4; i++) {
        await apiPost('/scheduler/tick')
        await new Promise((r) => setTimeout(r, 300))
      }
      increased = await waitForBackend(
        (snap) => {
          const d = (snap.dispatches || []).find((x) => x.id === target.dispatchId)
          return d && Number(d.progress) > base
        },
        { timeout: 10000 }
      )
    }
    check('P2：无用户操作进度自动推进（全局定时任务驱动，UI 只读）', increased)
    await ctx.close()

    // 只读用户（user16）：商品/用户管理页无操作按钮（RBAC 视图门控）
    const { ctx: ctx2, page: page2 } = await newPage(browser)
    await login(page2, 'user16', '123456')
    await page2.waitForSelector('.page')
    await nav(page2, '#/commodity')
    await page2.waitForFunction(() => (document.querySelector('.page-header__title')?.textContent || '').includes('商品管理'))
    await page2.waitForSelector('.el-table__row')
    const commodityNoBtns = await page2.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].map((b) => b.textContent)
      return !btns.some((t) => t.includes('新建') || t.includes('导入'))
    })
    check('P2：只读用户商品页无新建/导入按钮', commodityNoBtns)
    await nav(page2, '#/system/user')
    await page2.waitForFunction(() => (document.querySelector('.page-header__title')?.textContent || '').includes('用户管理'))
    await page2.waitForSelector('.el-table__row')
    const userNoBtns = await page2.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].map((b) => b.textContent)
      return !btns.some((t) => t.includes('新增用户'))
    })
    check('P2：只读用户用户管理页无新增按钮', userNoBtns)
    await ctx2.close()
  }

  /* ===== 场景 14：N-1 司机账号 UI 级全链路（接单→扫码装货→发车→到达→扫码卸货签收） ===== */
  console.log('== 14. N-1：司机账号全链路扫码（司机端入口不被 RBAC 拦截） ==')
  {
    const { ctx, page } = await newPage(browser)
    // 1) 从后端快照取"待装货公路车次 + 司机启用账号（手机号=登录账号）"组合
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
    const seed = await waitForBackend((snap) => {
        const d = (snap.dispatches || []).find((x) => x.status === 'pending' && x.vehicleId)
        if (!d) return false
        const drv = (snap.drivers || []).find((x) => x.id === d.driverId && x.status !== 'disabled')
        if (!drv) return false
        const u = (snap.users || []).find((x) => x.username === drv.phone && x.status === 'active')
        return u ? { dispatchId: d.id, phone: drv.phone } : false
      }, { timeout: 15000 })
    check('N-1：种子含待装货公路车次与司机手机号账号', !!seed)
    if (seed) {
      // 2) 手机号登录 → 直达司机端（账号锁定本人）
      await login(page, seed.phone, '123456')
      check('N-1：司机手机号登录直达司机端', page.url().includes('#/driver-app'))
      await page.waitForSelector('.task-card')
      // 页面内任务卡工具函数（hash 导航不重载文档，函数保持有效）
      await page.evaluate(() => {
        window.__card = (id) =>
          [...document.querySelectorAll('.task-card')].find((c) => (c.querySelector('.task-card__id')?.textContent || '').trim() === id)
        window.__tag = (id) => window.__card(id)?.querySelector('.el-tag')?.textContent?.trim() || null
        window.__btn = (id, t) => {
          const card = window.__card(id)
          const b = card && [...card.querySelectorAll('button')].find((x) => x.textContent.replace(/\s/g, '').includes(t))
          return b ? { exists: true, disabled: b.disabled, click: () => b.click() } : { exists: false }
        }
        window.__dbtn = (t, title) => {
          // 已关闭的 el-dialog 仍留在 DOM（隐藏），且关闭动画期间旧弹窗仍"可见"——按标题定位目标弹窗
          const vis = [...document.querySelectorAll('.el-dialog')].filter((x) => x.offsetParent !== null)
          const d = (title && vis.find((x) => (x.textContent || '').includes(title))) || vis[vis.length - 1]
          const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.replace(/\s/g, '').includes(t))
          return b ? { exists: true, click: () => b.click() } : { exists: false }
        }
        window.__dialogVisible = (title) =>
          [...document.querySelectorAll('.el-dialog')].some((d) => d.offsetParent !== null && (d.textContent || '').includes(title))
        window.__receipt = (id) => !!window.__card(id)?.querySelector('.receipt')
      })
      // 3) 接单（种子未接单时）
      const acceptBtn = await page.evaluate((id) => window.__btn(id, '接单'), seed.dispatchId)
      if (acceptBtn.exists && !acceptBtn.disabled) {
        await page.evaluate((id) => window.__btn(id, '接单').click(), seed.dispatchId)
        await page.waitForFunction((id) => !window.__btn(id, '扫码装货').disabled, { timeout: 10000 }, seed.dispatchId)
      }
      check('N-1：司机端任务卡可见且扫码装货可用', (await page.evaluate((id) => window.__btn(id, '扫码装货'), seed.dispatchId)).exists)
      // 4) 扫码确认装货（模拟扫码 → 确认扫码 → 装货中）
      await page.evaluate((id) => window.__btn(id, '扫码装货').click(), seed.dispatchId)
      await page.waitForFunction(() => window.__dialogVisible('扫码确认装货'), { timeout: 10000 })
      await page.evaluate(() => window.__dbtn('模拟扫码', '扫码确认装货').click())
      await page.evaluate(() => window.__dbtn('确认扫码', '扫码确认装货').click())
      await page.waitForFunction((id) => window.__tag(id) === '装货中', { timeout: 10000 }, seed.dispatchId)
      check('N-1：司机账号扫码确认装货（待装货→装货中）', true)
      // 5) 发车 → 在途
      await page.evaluate((id) => window.__btn(id, '发车').click(), seed.dispatchId)
      await page.waitForFunction((id) => window.__tag(id) === '在途', { timeout: 10000 }, seed.dispatchId)
      check('N-1：司机端发车（装货中→在途）', true)
      // 6) 到达卸货场 → 卸货中
      await page.evaluate((id) => window.__btn(id, '到达卸货场').click(), seed.dispatchId)
      await page.waitForFunction((id) => window.__tag(id) === '卸货中', { timeout: 10000 }, seed.dispatchId)
      check('N-1：司机端到达卸货场（在途→卸货中）', true)
      // 7) 扫码确认卸货 + 电子签收 → 已完成
      await page.evaluate((id) => window.__btn(id, '确认卸货并签收').click(), seed.dispatchId)
      await page.waitForFunction(() => window.__dialogVisible('电子签收'), { timeout: 10000 })
      await page.evaluate(() => window.__dbtn('模拟扫码', '电子签收').click())
      await page.evaluate(() => window.__dbtn('确认签收', '电子签收').click())
      await page.waitForFunction((id) => window.__tag(id) === '已完成' && window.__receipt(id), { timeout: 10000 }, seed.dispatchId)
      check('N-1：司机账号扫码确认卸货 + 电子签收（卸货中→已完成）', true)
    }
    await ctx.close()
  }

  /* ===== 场景 15：M8 登录失败锁定（连续 5 次失败 → 5 分钟锁定，刷新后仍生效） ===== */
  console.log('== 15. M8：登录失败锁定 ==')
  {
    const { ctx, page } = await newPage(browser)
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
    await page.waitForSelector('input[placeholder="用户名 / 司机手机号"]')
    // 连续 5 次错误密码（默认账号 admin 已预填）
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        const p = document.querySelector('input[placeholder="密码"]')
        setter.call(p, 'wrong-pass')
        p.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('.login__btn').click()
      })
      await new Promise((r) => setTimeout(r, 400))
    }
    const locked = await page.evaluate(() => {
      const btn = document.querySelector('.login__btn')
      return !!btn && btn.disabled && /重试/.test(btn.textContent)
    })
    check('M8：连续 5 次登录失败 → 账号锁定（按钮禁用 + 倒计时）', locked)
    // 锁定状态刷新后仍生效（localStorage 持久化）
    await page.reload({ waitUntil: 'networkidle0' })
    const stillLocked = await page.evaluate(() => {
      const btn = document.querySelector('.login__btn')
      return !!btn && btn.disabled && /重试/.test(btn.textContent)
    })
    check('M8：锁定状态刷新后仍生效（localStorage 持久化）', stillLocked)
    await ctx.close()
  }

  /* ===== 场景 16：环节1-3 UI（补签入口 / 客户异议 / 改价审批） ===== */
  console.log('== 16. 环节1-3：补签入口 + 客户异议 + 改价审批（UI 接线） ==')
  await resetDemo() // 回归组起点：主链路组（1-15）已消耗种子资源，重置回种子态
  {
    const { ctx, page } = await newPage(browser)
    // 页面工具：可见弹窗内按钮（按标题定位，规避已关闭弹窗残留 DOM）
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
    await page.evaluate(() => {
      window.__visDialog = (title) =>
        [...document.querySelectorAll('.el-dialog')].filter((x) => x.offsetParent !== null).find((x) => (x.textContent || '').includes(title))
      window.__visDialogBtn = (title, t) => {
        const d = window.__visDialog(title)
        const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.replace(/\s/g, '').includes(t))
        return b ? { exists: true, click: () => b.click() } : { exists: false }
      }
      window.__visDialogInput = (title, label) => {
        const d = window.__visDialog(title)
        if (!d) return null
        const items = [...d.querySelectorAll('.el-form-item')]
        const item = label ? items.find((i) => (i.querySelector('.el-form-item__label')?.textContent || '').includes(label)) : items[0]
        return item && (item.querySelector('textarea') || item.querySelector('input'))
      }
      window.__setInput = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    // 后端快照：取"已完成未签收公路车次"与"执行中合同"
    const seed = await waitForBackend((snap) => {
        const d = (snap.dispatches || []).find((x) => x.status === 'completed' && x.vehicleId && !x.receipt)
        const c = (snap.contracts || []).find((x) => x.status === 'executing')
        return d && c ? { dispatchId: d.id, contractId: c.id } : false
      }, { timeout: 15000 })
    check('环节1：种子含已完成未签收公路车次（补签演示前置）', !!seed)
    if (seed) {
      // 环节1：admin 调度详情"补签"
      await login(page, 'admin', '123456')
      await nav(page, '#/dispatch/' + seed.dispatchId)
      await page.waitForSelector('.dispatch-detail__name')
      const supBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.replace(/\s/g, '').includes('补签')))
      check('环节1：未签收已完成车次详情页有"补签"按钮', supBtn)
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s/g, '').includes('补签'))
        btn.click()
      })
      await page.waitForFunction(() => window.__visDialog('补签电子签收单'), { timeout: 10000 })
      await page.evaluate(() => {
        const input = window.__visDialogInput('补签电子签收单', '签收人')
        window.__setInput(input, '收货方仓管员')
      })
      await page.evaluate(() => window.__visDialogBtn('补签电子签收单', '确认补签').click())
      await page.waitForFunction(() => /QS-B\d{5}/.test(document.querySelector('.page')?.textContent || ''), { timeout: 10000 })
      check('环节1：补签提交后签收单生成（QS-B 码展示）', true)

      // 环节3：admin 合同详情"变更（改价）→ 变更待审批 → 审批通过"
      await nav(page, '#/contract/' + seed.contractId)
      await page.waitForSelector('.contract-detail__name')
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s/g, '').includes('变更'))
        btn.click()
      })
      await page.waitForFunction(() => window.__visDialog('合同变更'), { timeout: 10000 })
      await page.evaluate(() => {
        const priceInput = window.__visDialogInput('合同变更', '合同单价')
        const next = String(Math.round(Number(priceInput.value) + 10))
        window.__setInput(priceInput, next)
        const reason = window.__visDialogInput('合同变更', '变更原因')
        window.__setInput(reason, 'e2e 改价审批测试')
      })
      await page.evaluate(() => window.__visDialogBtn('合同变更', '确认变更').click())
      await page.waitForFunction(() => (document.querySelector('.page')?.textContent || '').includes('变更待审批'), { timeout: 10000 })
      check('环节3：改价提交后不即时生效，展示"变更待审批"面板', true)
      // 两级审批通过（部门 → 公司）
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s/g, '').includes('审批变更'))
          btn.click()
        })
        await page.waitForFunction(() => window.__visDialog('变更审批'), { timeout: 10000 })
        await page.evaluate(() => window.__visDialogBtn('变更审批', '通过').click())
        await page.waitForFunction(() => !window.__visDialog('变更审批'), { timeout: 10000 })
      }
      const pendingGone = await page.evaluate(() => !(document.querySelector('.page')?.textContent || '').includes('变更待审批'))
      check('环节3：改价两级审批通过后待批面板消失（变更生效）', pendingGone)
      await ctx.close()
    }
  }
  {
    // 环节2：客户门户"异议"（独立上下文：customer01 必有对账中账单，种子兜底保证）
    const { ctx, page } = await newPage(browser)
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
    await page.evaluate(() => {
      window.__visDialog = (title) =>
        [...document.querySelectorAll('.el-dialog')].filter((x) => x.offsetParent !== null).find((x) => (x.textContent || '').includes(title))
      window.__visDialogBtn = (title, t) => {
        const d = window.__visDialog(title)
        const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.replace(/\s/g, '').includes(t))
        return b ? { exists: true, click: () => b.click() } : { exists: false }
      }
      window.__visDialogInput = (title, label) => {
        const d = window.__visDialog(title)
        if (!d) return null
        const items = [...d.querySelectorAll('.el-form-item')]
        const item = label ? items.find((i) => (i.querySelector('.el-form-item__label')?.textContent || '').includes(label)) : items[0]
        return item && (item.querySelector('textarea') || item.querySelector('input'))
      }
      window.__setInput = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await login(page, 'customer01', '123456')
    check('环节2：客户登录直达门户', page.url().includes('#/portal'))
    await page.waitForSelector('.el-table__row')
    const objRow = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.el-table__row')]
      const row = rows.find((r) => [...r.querySelectorAll('button')].some((b) => b.textContent.includes('确认对账')))
      if (!row) return { exists: false, clicked: false }
      const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('异议'))
      if (!btn) return { exists: false, clicked: false }
      btn.click()
      return { exists: true, clicked: true }
    })
    check('环节2：对账中账单行有"异议"按钮（与"确认对账"并列）', objRow.exists)
    if (objRow.clicked) {
      await page.waitForFunction(() => window.__visDialog('提交对账异议'), { timeout: 10000 })
      await page.evaluate(() => {
        const input = window.__visDialogInput('提交对账异议', '异议原因')
        window.__setInput(input, 'e2e 测试异议：损耗金额偏高')
      })
      await page.evaluate(() => window.__visDialogBtn('提交对账异议', '提交异议').click())
      await page.waitForFunction(
        () => [...document.querySelectorAll('.el-table__row')].some((r) => r.textContent.includes('已异议')),
        { timeout: 10000 }
      )
      check('环节2：异议提交后账单回待对账（行显示"已异议 · 待重新对账"）', true)
    }
    await ctx.close()
  }

  /* ===== 场景 17：环节4-6 UI（质量扣减 / 预付款管理 / 消息免打扰） ===== */
  console.log('== 17. 环节4-6：质量扣减 + 预付款管理 + 消息免打扰（UI 接线） ==')
  await resetDemo() // 场景 16 已改后端态，重置回种子态保证种子前置数据
  {
    const { ctx, page } = await newPage(browser)
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
    await page.evaluate(() => {
      window.__visDialog = (title) =>
        [...document.querySelectorAll('.el-dialog')].filter((x) => x.offsetParent !== null).find((x) => (x.textContent || '').includes(title))
      window.__visDialogBtn = (title, t) => {
        const d = window.__visDialog(title)
        const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.replace(/\s/g, '').includes(t))
        return b ? { exists: true, click: () => b.click() } : { exists: false }
      }
      window.__visDialogInput = (title, label) => {
        const d = window.__visDialog(title)
        if (!d) return null
        const items = [...d.querySelectorAll('.el-form-item')]
        const item = label ? items.find((i) => (i.querySelector('.el-form-item__label')?.textContent || '').includes(label)) : items[0]
        return item && (item.querySelector('textarea') || item.querySelector('input'))
      }
      window.__setInput = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    // 后端快照：质量扣减账单 + 预付款抵扣演示账单（客户既有可用预付款、又有已结算/逾期未付清账单）。
    // 不写死客户：种子漂移后 CUS001 可能无已结算/逾期未付清账单（当前种子为 CUS003：YF-0002 预付 + JS-0020 逾期未付）。
    const seed = await waitForBackend((snap) => {
        const s1 = (snap.settlements || []).find((x) => x.qualityDeduction > 0 && x.reconciliation)
        const s2 = (snap.settlements || []).find(
          (x) => ['settled', 'overdue'].includes(x.status) && x.totalAmount - x.paidAmount > 0 &&
            (snap.prepayments || []).some((p) => p.customerId === x.customerId)
        )
        return s1 && s2 ? { qualitySettleId: s1.id, prepaySettleId: s2.id, prepayCustomerId: s2.customerId } : false
      }, { timeout: 15000 })
    check('环节4：种子含质量扣减账单（结算演示前置）', !!seed)
    if (seed) {
      await login(page, 'admin', '123456')
      // 环节4：结算详情"质量扣减"费用项 + 对账明细"质量扣重"列
      await nav(page, '#/settlement/' + seed.qualitySettleId)
      await page.waitForSelector('.settlement-detail__name')
      const pageText = await page.evaluate(() => document.querySelector('.page')?.textContent || '')
      check('环节4：结算详情费用明细含"质量扣减"项', pageText.includes('质量扣减'))
      check('环节4：对账明细含"质量扣重"列', pageText.includes('质量扣重'))

      // 环节5：结算详情"预付款抵扣"（该客户有种子预付，按钮 prepayAvail>0 才显示）
      await nav(page, '#/settlement/' + seed.prepaySettleId)
      await page.waitForSelector('.settlement-detail__name')
      const prepayBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.replace(/\s/g, '').includes('预付款抵扣')))
      check(`环节5：${seed.prepayCustomerId} 已结算/逾期账单有"预付款抵扣"按钮`, prepayBtn)
      if (prepayBtn) {
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s/g, '').includes('预付款抵扣'))
          btn.click()
        })
        await page.waitForFunction(() => window.__visDialog('预付款抵扣'), { timeout: 10000 })
        await page.evaluate(() => window.__visDialogBtn('预付款抵扣', '确认抵扣').click())
        await page.waitForFunction(
          () => [...document.querySelectorAll('.el-table__row')].some((r) => r.textContent.includes('预付款抵扣')),
          { timeout: 10000 }
        )
        check('环节5：预付款抵扣后收款流水出现"预付款抵扣"记录', true)
      }

      // 环节5：客户详情"预付款台账" + 收取预付款
      await nav(page, '#/customer/CUS001')
      await page.waitForSelector('.customer-detail__name')
      const ledgerText = await page.evaluate(() => document.querySelector('.page')?.textContent || '')
      check('环节5：客户详情含"预付款台账"面板（种子 YF-0001）', ledgerText.includes('预付款台账') && ledgerText.includes('YF-0001'))
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s/g, '').includes('收取预付款'))
        btn.click()
      })
      await page.waitForFunction(() => window.__visDialog('收取预付款'), { timeout: 10000 })
      await page.evaluate(() => {
        const input = window.__visDialogInput('收取预付款', '预付金额')
        window.__setInput(input, '100000')
      })
      await page.evaluate(() => window.__visDialogBtn('收取预付款', '确认收取').click())
      await page.waitForFunction(() => (document.querySelector('.page')?.textContent || '').includes('YF-0003'), { timeout: 10000 })
      check('环节5：收取预付款后台账新增记录（YF-0003）', true)
      await ctx.close()
    }
  }
  {
    // 环节6：消息中心"免打扰"设置（类型屏蔽 → 列表"免打扰"标记）
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await nav(page, '#/message')
    await page.waitForSelector('.el-table__row')
    await page.evaluate(() => {
      window.__visDialog = (title) =>
        [...document.querySelectorAll('.el-dialog')].filter((x) => x.offsetParent !== null).find((x) => (x.textContent || '').includes(title))
      window.__visDialogBtn = (title, t) => {
        const d = window.__visDialog(title)
        const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.replace(/\s/g, '').includes(t))
        return b ? { exists: true, click: () => b.click() } : { exists: false }
      }
    })
    const dndBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.replace(/\s/g, '').includes('免打扰')))
    check('环节6：消息中心有"免打扰"入口', dndBtn)
    if (dndBtn) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s/g, '').includes('免打扰'))
        btn.click()
      })
      await page.waitForFunction(() => window.__visDialog('免打扰设置'), { timeout: 10000 })
      // 启用开关 + 勾选"系统"类型
      await page.evaluate(() => {
        const d = window.__visDialog('免打扰设置')
        d.querySelector('.el-switch').click()
        const cb = [...d.querySelectorAll('.el-checkbox')].find((x) => (x.textContent || '').includes('系统'))
        cb.click()
      })
      await page.evaluate(() => window.__visDialogBtn('免打扰设置', '保存设置').click())
      await page.waitForFunction(() => !window.__visDialog('免打扰设置'), { timeout: 10000 })
      // 按"系统"类型筛选，把唯一的系统消息拉到第 1 页：
      // 消息列表按最新在前排序，定时任务生成的异常消息会不断把系统消息挤到后面（第 2/3 页），
      // 直接查第 1 页行会漏掉系统消息。筛选后列表只剩系统消息，标记断言与排序无关。
      await page.evaluate(() => {
        const sel = document.querySelector('.filter-bar .el-select')
        const wrapper = sel.querySelector('.el-select__wrapper') || sel
        wrapper.click()
      })
      await page.waitForFunction(
        () => [...document.querySelectorAll('.el-select-dropdown__item')].some((i) => i.offsetParent !== null && i.textContent.includes('系统')),
        { timeout: 5000 }
      )
      await page.evaluate(() => {
        const item = [...document.querySelectorAll('.el-select-dropdown__item')].find((i) => i.offsetParent !== null && i.textContent.includes('系统'))
        item.click()
      })
      // 标记依赖本地 db.dnd：保存后 200ms 快照刷新可能早于后端 PUT 落库（~2.3s）而回写种子态，
      // 需等下一轮 3s 定时任务快照刷新把已落库的 dnd 同步回本地，标记才出现（10s 足够覆盖）。
      await page.waitForFunction(
        () => [...document.querySelectorAll('.el-table__row')].some((r) => r.textContent.includes('免打扰')),
        { timeout: 10000 }
      )
      check('环节6：保存后系统类消息显示"免打扰"标记', true)
      // 设置持久化（后端快照 dnd.admin）
      const dndSaved = await waitForBackend(
        (snap) => snap.dnd && snap.dnd.admin && snap.dnd.admin.enabled === true && (snap.dnd.admin.mutedTypes || []).includes('system'),
        { timeout: 10000 }
      )
      check('环节6：免打扰设置随后端快照持久化（dnd.admin）', !!dndSaved)
    }
    await ctx.close()
  }

  /* ===== 场景 18：环节7-8 UI（安全库存预警 / 数据权限行级过滤） ===== */
  console.log('== 18. 环节7-8：安全库存预警 + 数据权限（UI 接线） ==')
  await resetDemo() // 场景 17 已改后端态，重置回种子态
  {
    // 环节7：库存管理"低于安全库存"预警面板 + 安全库存设置（admin）
    const { ctx, page } = await newPage(browser)
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
    await page.evaluate(() => {
      window.__visDialog = (title) =>
        [...document.querySelectorAll('.el-dialog')].filter((x) => x.offsetParent !== null).find((x) => (x.textContent || '').includes(title))
      window.__visDialogBtn = (title, t) => {
        const d = window.__visDialog(title)
        const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.replace(/\s/g, '').includes(t))
        return b ? { exists: true, click: () => b.click() } : { exists: false }
      }
      window.__visDialogInput = (title, label) => {
        const d = window.__visDialog(title)
        if (!d) return null
        const items = [...d.querySelectorAll('.el-form-item')]
        const item = label ? items.find((i) => (i.querySelector('.el-form-item__label')?.textContent || '').includes(label)) : items[0]
        return item && (item.querySelector('textarea') || item.querySelector('input'))
      }
      window.__setInput = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await login(page, 'admin', '123456')
    await nav(page, '#/warehouse/inventory')
    await page.waitForSelector('.el-table__row')
    const invText = await page.evaluate(() => document.querySelector('.page')?.textContent || '')
    check('环节7：库存管理含"低于安全库存"统计卡与"安全库存预警"面板（种子有低于下限组合）', invText.includes('低于安全库存') && invText.includes('安全库存预警'))
    const sqBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.replace(/\s/g, '').includes('安全库存设置')))
    check('环节7：库存管理有"安全库存设置"入口', sqBtn)
    if (sqBtn) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s/g, '').includes('安全库存设置'))
        btn.click()
      })
      await page.waitForFunction(() => window.__visDialog('安全库存设置'), { timeout: 10000 })
      await pickDialogSelect(page, '仓库', '秦皇岛港 1 号煤仓')
      await pickDialogSelect(page, '商品', '动力煤')
      await page.evaluate(() => {
        const input = window.__visDialogInput('安全库存设置', '安全库存')
        window.__setInput(input, '1234')
      })
      await page.evaluate(() => window.__visDialogBtn('安全库存设置', '保存').click())
      await page.waitForFunction(() => !window.__visDialog('安全库存设置'), { timeout: 10000 })
      // 设置持久化（后端快照 safetyStocks WH001/CM001 = 1234）
      const sqSaved = await waitForBackend(
        (snap) => {
          const sq = (snap.safetyStocks || []).find((s) => s.warehouseId === 'WH001' && s.commodityId === 'CM001')
          return sq && sq.minQty === 1234
        },
        { timeout: 10000 }
      )
      check('环节7：安全库存设置保存并随后端快照持久化（WH001/动力煤 = 1234）', !!sqSaved)
    }
    await ctx.close()
  }
  {
    // 环节8：数据权限行级过滤（user02 调度员，仅华北装货侧）
    const { ctx, page } = await newPage(browser)
    await login(page, 'user02', '123456')
    // 后端快照：计算华北装货侧调度单数（行级过滤预期值）
    const seed = await waitForBackend((snap) => {
        if (!snap.dispatches || !snap.dataScopes) return false
        const north = new Set(['T001', 'T002', 'T003', 'T004', 'T005', 'T011'])
        const scoped = snap.dispatches.filter((d) => north.has(d.loadTerminalId)).length
        return scoped > 0 && scoped < snap.dispatches.length
          ? { scopedCount: scoped, totalCount: snap.dispatches.length, user02: snap.dataScopes.user02 }
          : false
      }, { timeout: 15000 })
    check('环节8：种子数据范围（user02 = 华北，且为真子集）', !!seed && seed.user02.regions.join() === '华北')
    if (seed) {
      await nav(page, '#/dispatch')
      await page.waitForSelector('.el-table__row')
      const dText = await page.evaluate(() => document.querySelector('.page')?.textContent || '')
      check('环节8：调度列表显示"数据范围：华北"标签', dText.includes('数据范围：华北（装货侧）'))
      check('环节8：调度列表分页总数=华北装货侧调度单数（行级过滤生效）', dText.includes(`共 ${seed.scopedCount} 条`))
      // 顶栏数据范围标签
      const navTag = await page.evaluate(() => (document.querySelector('.navbar')?.textContent || '').includes('数据范围：华北'))
      check('环节8：顶栏显示数据范围标签', navTag)
      // 计划列表同样行级过滤
      await nav(page, '#/plan')
      await page.waitForSelector('.el-table__row')
      const pText = await page.evaluate(() => document.querySelector('.page')?.textContent || '')
      check('环节8：计划列表显示"数据范围：华北"标签', pText.includes('数据范围：华北（装货侧）'))
    }
    await ctx.close()
  }

  /* ===== 场景 19：环节9-10 UI（登录验证码 / 单证归档） ===== */
  console.log('== 19. 环节9-10：登录验证码 + 单证归档（UI 接线） ==')
  await resetDemo() // 场景 18 已改后端态，重置回种子态（单证归档需种子单证）
  {
    const { ctx, page } = await newPage(browser)
    // 环节9：登录页验证码渲染 + 错误验证码拒绝 + 正确验证码登录
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
    await page.waitForSelector('input[placeholder="验证码"]')
    const capInfo = await page.evaluate(() => {
      const texts = [...document.querySelectorAll('.login__captcha-img svg text')]
      return { hasSvg: !!document.querySelector('.login__captcha-img svg'), code: texts.map((t) => t.textContent).join('') }
    })
    check('环节9：登录页渲染图形验证码（4 位字符）', capInfo.hasSvg && capInfo.code.length === 4)
    // 错误验证码 → 拒绝（未登录）
    await page.evaluate(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const p = document.querySelector('input[placeholder="密码"]')
      setter.call(p, '123456')
      p.dispatchEvent(new Event('input', { bubbles: true }))
      const c = document.querySelector('input[placeholder="验证码"]')
      setter.call(c, '0000')
      c.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('.login__btn').click()
    })
    await page.waitForFunction(() => /验证码/.test(document.querySelector('.el-message')?.textContent || ''), { timeout: 5000 })
    const wrongCap = await page.evaluate(() => ({
      user: localStorage.getItem('blms_user'),
      msg: document.querySelector('.el-message')?.textContent || ''
    }))
    check('环节9：错误验证码拒绝（提示验证码错误，未登录）', /验证码/.test(wrongCap.msg) && !wrongCap.user)
    // 正确验证码 → 登录成功（login 工具自动读取并填写验证码）
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    check('环节9：正确验证码登录成功进入工作台', page.url().includes('#/workbench'))

    // 环节10：单证归档（admin）
    await nav(page, '#/document')
    await page.waitForSelector('.el-table__row')
    const docText = await page.evaluate(() => document.querySelector('.page')?.textContent || '')
    check('环节10：单证归档页渲染（统计卡 + 表格有数据）', docText.includes('单证归档') && docText.includes('磅单') && docText.includes('签收单') && docText.includes('发票'))
    const hasMenu = await page.evaluate(() => (document.querySelector('.layout__sidebar')?.textContent || '').includes('单证归档'))
    check('环节10：侧边栏含"单证归档"菜单', hasMenu)
    // 类型筛选（磅单）
    await page.evaluate(() => {
      const sel = document.querySelector('.filter-bar .el-select')
      const wrapper = sel.querySelector('.el-select__wrapper') || sel
      wrapper.click()
    })
    await page.waitForFunction(() => [...document.querySelectorAll('.el-select-dropdown__item')].some((i) => i.offsetParent !== null && i.textContent.includes('磅单')))
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('.el-select-dropdown__item')].find((i) => i.offsetParent !== null && i.textContent.includes('磅单'))
      item.click()
    })
    await new Promise((r) => setTimeout(r, 400))
    const filteredRows = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.el-table__row')]
      return { count: rows.length, allWeighing: rows.length > 0 && rows.every((r) => r.textContent.includes('磅单')) }
    })
    check('环节10：类型筛选（磅单）后全部为磅单', filteredRows.count > 0 && filteredRows.allWeighing)
    // 预览（iframe 渲染电子单证）
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.el-table__row button')].find((x) => x.textContent.includes('预览'))
      b.click()
    })
    await page.waitForSelector('.el-dialog iframe')
    const previewOk = await page.evaluate(() => {
      const f = document.querySelector('.el-dialog iframe')
      return f && (f.getAttribute('srcdoc') || '').includes('电子单证')
    })
    check('环节10：单证预览（iframe 渲染电子单证内容）', previewOk)
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.el-dialog__footer button')]
      btns.find((b) => b.textContent.includes('关闭'))?.click()
    })
    await page.waitForFunction(() => !document.querySelector('.el-dialog iframe'), { timeout: 5000 }).catch(() => {})
    // 下载（拦截 URL.createObjectURL 捕获 Blob，验证下载触发且内容为电子单证 HTML；
    // 本版本 puppeteer 的 download 事件在 browser 层，page 层不可靠，故以 Blob 内容为准）
    const dlResult = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const origCreate = URL.createObjectURL
          let captured = null
          URL.createObjectURL = (blob) => {
            captured = blob
            return origCreate(blob)
          }
          const b = [...document.querySelectorAll('.el-table__row button')].find((x) => x.textContent.includes('下载'))
          b.click()
          setTimeout(async () => {
            URL.createObjectURL = origCreate
            let text = ''
            if (captured) text = await captured.text()
            resolve({ captured: !!captured, type: captured ? captured.type : '', hasTable: text.includes('<table'), isDoc: text.includes('电子单证') })
          }, 300)
        })
    )
    check('环节10：单证下载触发 Blob（text/html 电子单证 HTML）', dlResult.captured && dlResult.type.includes('text/html') && dlResult.hasTable && dlResult.isDoc)
    await ctx.close()
  }
  /* ===== 场景 20：Phase 4 阶段 3 生产模式（薄客户端）合同列表——服务端分页 + 过滤 + 交叉引用 =====
   * 演示模式（默认）由现有场景 1-19 覆盖；本场景验证生产模式（localStorage blms_app_mode=production）
   * 下合同列表读服务端权威态：分页总数=后端全量、状态过滤=后端过滤数、交叉引用列（客户名）经 hydrate 本地 db 渲染。 */
  console.log('== 20. 生产模式：合同列表服务端分页 + 过滤（薄客户端） ==')
  await resetDemo() // 回种子态
  {
    const { ctx, page } = await newPage(browser)
    // 生产模式：登录前设置 localStorage 覆盖（合同组件 setup 读 isProduction()）
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
    await page.evaluate(() => localStorage.setItem('blms_app_mode', 'production'))
    await login(page, 'admin', '123456')
    // 后端权威值（admin 范围 → 与 UI 同口径；snapshot 与 /api/coll 均按当前操作人数据范围过滤）
    const snap = await getBackendSnapshot()
    const totalContracts = (snap.contracts || []).length
    const statusCount = (s) => (snap.contracts || []).filter((c) => c.status === s).length
    const statuses = ['executing', 'pending', 'completed', 'terminated', 'archived']
    const pickStatus = statuses.find((s) => statusCount(s) > 0) || ''
    const labelOf = { executing: '执行中', pending: '待审批', completed: '已完成', terminated: '已终止', archived: '已归档' }

    await nav(page, '#/contract')
    await page.waitForSelector('.el-table__row')
    await page.waitForFunction(
      (t) => (document.querySelector('.page')?.textContent || '').includes('共 ' + t + ' 条'),
      { timeout: 15000 }, totalContracts
    )
    const listText = await page.evaluate(() => document.querySelector('.page')?.textContent || '')
    check('阶段3：生产模式合同列表分页总数=后端全量合同数（服务端分页生效）', listText.includes('共 ' + totalContracts + ' 条'))
    // 交叉引用列（客户名）渲染 → 证明 hydrate 填充本地 db 供 find.* 使用
    const custNames = (snap.customers || []).map((c) => c.name).filter(Boolean)
    check('阶段3：生产模式交叉引用列渲染客户名（本地 db 供 find.* 交叉引用）', custNames.some((n) => listText.includes(n)))

    if (pickStatus) {
      // 点状态统计 chip → 生产模式 watch 触发服务端过滤重取
      await page.evaluate((label) => {
        const chip = [...document.querySelectorAll('.stat-chip')].find((c) => (c.textContent || '').includes(label))
        chip.click()
      }, labelOf[pickStatus])
      await page.waitForFunction(
        (t) => (document.querySelector('.page')?.textContent || '').includes('共 ' + t + ' 条'),
        { timeout: 15000 }, statusCount(pickStatus)
      )
      const filteredText = await page.evaluate(() => document.querySelector('.page')?.textContent || '')
      check('阶段3：生产模式状态过滤（' + labelOf[pickStatus] + '）总数=后端过滤数（服务端过滤生效）', filteredText.includes('共 ' + statusCount(pickStatus) + ' 条'))
    }
    await ctx.close()
  }
  /* ===== 场景 21：Phase 4 阶段 4 生产模式（薄客户端）调度详情——读聚合端点 GET /api/dispatch/{id}/detail =====
   * 演示模式（默认）由现有场景覆盖；本场景验证生产模式下调度详情读面（dispatch/commodity/vehicle/
   * driver/terminals/weighings）来自后端聚合端点（单次往返），磅单行数=后端该单磅单数。 */
  console.log('== 21. 生产模式：调度详情读聚合端点（薄客户端） ==')
  await resetDemo() // 回种子态
  {
    const { ctx, page } = await newPage(browser)
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
    await page.evaluate(() => localStorage.setItem('blms_app_mode', 'production'))
    await login(page, 'admin', '123456')
    // 后端权威：取一张有磅单的调度单（详情读面非空，磅单表可断言行数）
    const snap = await getBackendSnapshot()
    const d = (snap.dispatches || []).find((x) => (snap.weighings || []).some((w) => w.dispatchId === x.id))
      || (snap.dispatches || [])[0]
    check('阶段4：种子含可断言调度单（详情端点前置）', !!d)
    if (d) {
      const wCount = (snap.weighings || []).filter((w) => w.dispatchId === d.id).length
      const comm = (snap.commodities || []).find((c) => c.id === d.commodityId)
      const veh = (snap.vehicles || []).find((v) => v.id === d.vehicleId)
      await nav(page, '#/dispatch/' + d.id)
      await page.waitForSelector('.dispatch-detail__name')
      // 等详情端点渲染完成（商品名出现 → 证明读面来自聚合端点而非本地空态）
      if (comm && comm.name) {
        await page.waitForFunction((n) => (document.querySelector('.page')?.textContent || '').includes(n), { timeout: 15000 }, comm.name)
      }
      const pageText = await page.evaluate(() => document.querySelector('.page')?.textContent || '')
      check('阶段4：生产模式详情头部渲染调度单号（读面来自聚合端点）', pageText.includes(d.id))
      if (comm && comm.name) check('阶段4：生产模式详情商品名来自聚合端点', pageText.includes(comm.name))
      if (veh && veh.plate) check('阶段4：生产模式详情车牌来自聚合端点', pageText.includes(veh.plate))
      // 磅单表行数=后端该单磅单数（端点 weighings 与 db.weighings 同源）
      const rows = await page.evaluate(() => [...document.querySelectorAll('.el-table__row')].length)
      check('阶段4：生产模式磅单行数=后端该单磅单数（' + wCount + '）', rows === wCount)
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
