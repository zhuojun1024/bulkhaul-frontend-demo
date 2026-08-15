/**
 * 集成验收脚本：无头浏览器遍历全部路由，捕获运行时错误并截图
 * 运行：node verify.mjs
 */
import puppeteer from 'puppeteer-core'
import fs from 'fs'

const BASE = 'http://localhost:8086/'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SHOT_DIR = 'C:/Users/zhuojun/AppData/Local/Temp/blms-shots'

/** 菜单路由（detail: true 表示列表页点击首行进入详情页验证） */
const routes = [
  { path: '/workbench', name: '工作台' },
  { path: '/monitor', name: '数据看板' },
  { path: '/contract', name: '合同管理', detail: true },
  { path: '/plan', name: '运输计划', detail: true },
  { path: '/dispatch', name: '调度管理', detail: true },
  { path: '/track', name: '在途监控' },
  { path: '/exception', name: '异常处理' },
  { path: '/vehicle', name: '车辆管理', detail: true },
  { path: '/driver', name: '司机管理', detail: true },
  { path: '/terminal', name: '场站管理' },
  { path: '/terminal/weighing', name: '磅单记录' },
  { path: '/warehouse', name: '仓储管理' },
  { path: '/warehouse/inventory', name: '库存管理' },
  { path: '/commodity', name: '商品管理' },
  { path: '/customer', name: '客户管理', detail: true },
  { path: '/settlement', name: '结算管理', detail: true },
  { path: '/settlement/invoice', name: '发票管理' },
  { path: '/safety', name: '安全管理' },
  { path: '/system/user', name: '用户管理' },
  { path: '/system/role', name: '角色管理' },
  { path: '/system/log', name: '操作日志' }
]
const createRoutes = ['/contract/create', '/plan/create']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1600, height: 900 }
  })
  const page = await browser.newPage()

  const errors = []
  page.on('pageerror', (e) => errors.push({ type: 'pageerror', msg: e.message, url: page.url() }))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push({ type: 'console', msg: msg.text(), url: page.url() })
  })
  page.on('requestfailed', (req) => {
    const u = req.url()
    if (u.includes('favicon') || u.includes('sockjs-node')) return
    errors.push({ type: 'requestfailed', msg: u + ' ' + (req.failure()?.errorText || ''), url: page.url() })
  })

  const shot = (name) => page.screenshot({ path: `${SHOT_DIR}/${name}.png` })
  const nav = (p) => page.evaluate((path) => { location.hash = '#' + path }, p)

  // 1. 登录页
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(1000)
  await shot('00-login')
  console.log('[OK] 登录页')

  // 2. 登录
  await page.click('.login__btn')
  await page.waitForFunction(() => {
    const h = location.hash
    return h === '#/workbench' || h.startsWith('#/workbench?')
  }, { timeout: 15000 })
  await sleep(1800)
  await shot('01-workbench')
  console.log('[OK] 登录 -> 工作台')

  // 3. 遍历菜单路由
  for (const r of routes) {
    await nav(r.path)
    await sleep(1400)
    await shot(r.path.replace(/\//g, '_'))
    console.log(`[OK] ${r.name} ${r.path}`)

    if (r.detail) {
      const clicked = await page.evaluate(() => {
        const row = document.querySelector('.el-table__body tbody tr.el-table__row')
        if (!row) return false
        row.click()
        return true
      })
      if (clicked) {
        await sleep(1400)
        const dhash = await page.evaluate(() => location.hash)
        if (dhash !== '#' + r.path) {
          await shot(r.path.replace(/\//g, '_') + '__detail')
          console.log(`[OK] ${r.name} 详情页 ${dhash}`)
          await nav(r.path)
          await sleep(900)
        } else {
          console.log(`[WARN] ${r.name} 点击行未跳转详情`)
        }
      } else {
        console.log(`[WARN] ${r.name} 未找到表格行`)
      }
    }
  }

  // 4. 新建页
  for (const p of createRoutes) {
    await nav(p)
    await sleep(1200)
    await shot(p.replace(/\//g, '_'))
    console.log(`[OK] 新建页 ${p}`)
  }

  // 5. 404
  await nav('/not-exist-page-xyz')
  await sleep(900)
  await shot('404')
  console.log('[OK] 404 页')

  console.log('\n===== 运行时错误报告 =====')
  if (errors.length === 0) {
    console.log('未捕获到任何运行时错误')
  } else {
    for (const e of errors) {
      console.log(`[${e.type}] ${e.msg}\n    at ${e.url}`)
    }
    console.log(`共 ${errors.length} 条`)
  }

  await browser.close()
}

main().catch((e) => {
  console.error('验证脚本执行失败:', e)
  process.exit(1)
})
