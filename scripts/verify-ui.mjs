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

/** 登录（el-input 通过原生 setter 触发 v-model；账号支持用户名或司机手机号） */
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
    const { ctx, page } = await newPage(browser)
    await login(page, 'admin', '123456')
    await page.waitForSelector('.page')
    await nav(page, '#/track')
    await page.waitForSelector('.track-list__item')
    // 等首轮定时任务完成（轨迹偏离超阈值的在途车次已被围栏事件转异常单），
    // 剩余在途车次不会再被围栏命中，可稳定观察遥测推进（页面已无自研 tick，进度变化只能来自全局定时任务）
    await new Promise((r) => setTimeout(r, 4000))
    const target = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.track-list__item')]
      const list = items
        .map((el) => {
          const tag = el.querySelector('.el-tag')?.textContent || ''
          const m = el.textContent.match(/进度 (\d+)%/)
          return m && tag === '在途'
            ? { plate: el.querySelector('.track-list__plate').textContent.trim(), progress: parseInt(m[1], 10) }
            : null
        })
        .filter((x) => x && x.progress < 95)
      list.sort((a, b) => a.progress - b.progress)
      return list[0] || null
    })
    check('P2：监控页存在可观察的在途车次', !!target)
    let increased = false
    if (target) {
      try {
        await page.waitForFunction(
          (t) => {
            const el = [...document.querySelectorAll('.track-list__item')].find((i) => i.querySelector('.track-list__plate')?.textContent.trim() === t.plate)
            const m = el?.textContent.match(/进度 (\d+)%/)
            return m ? parseInt(m[1], 10) > t.progress : false
          },
          { timeout: 20000 },
          target
        )
        increased = true
      } catch {
        increased = false
      }
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
} finally {
  await browser.close()
  server.close()
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
