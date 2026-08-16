/**
 * UI 层 e2e 冒烟测试（puppeteer-core + 本机 Chrome/Edge，弥补 D1：UI 接线零覆盖）
 * 覆盖场景（每场景独立浏览器上下文，localStorage 全新种子数据）：
 *  1. admin 登录 → 工作台 → 调度列表 → 待装货车次详情 → 确认装货（主链路真实操作）
 *  2. 结算专员（user03）直改 URL 访问 /dispatch → 被路由守卫拦截回工作台，侧边栏无该菜单
 *  3. 只读用户（user16）可访问调度列表但无任何操作按钮
 *  4. 客户（customer01）登录直达门户 → 本方账单/合同 → 确认对账；访问 /settlement 被拦截
 * 运行：npm run build && node scripts/verify-ui.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
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
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, BASE).pathname)
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

/** 登录（el-input 通过原生 setter 触发 v-model） */
async function login(page, username, password) {
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' })
  await page.waitForSelector('input[placeholder="用户名"]')
  await page.evaluate(
    ([u, p]) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const userInput = document.querySelector('input[placeholder="用户名"]')
      setter.call(userInput, u)
      userInput.dispatchEvent(new Event('input', { bubbles: true }))
      const passInput = document.querySelector('input[placeholder="密码"]')
      setter.call(passInput, p)
      passInput.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [username, password]
  )
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s/g, '').includes('登录'))
    btn.click()
  })
  await page.waitForFunction((u) => localStorage.getItem('blms_user') === u, { timeout: 15000 }, username)
}

/** 应用内 hash 导航 */
async function nav(page, hash) {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
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
} finally {
  await browser.close()
  server.close()
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
