import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox']
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 900 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('blms_token', 'mock-token-diagnose')
})
await page.goto('http://localhost:8086/#/workbench', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 1500))

// 折叠菜单
await page.click('.navbar__collapse')
await new Promise((r) => setTimeout(r, 600))

const info = await page.evaluate(() => {
  const out = {}
  const lis = [...document.querySelectorAll('.el-menu--collapse > .el-sub-menu')]
  for (const name of ['经营管理', '系统管理']) {
    const li = lis.find((el) => el.textContent.includes(name))
    if (!li) { out[name] = { missing: true }; continue }
    const title = li.querySelector('.el-sub-menu__title')
    const icon = title.querySelector(':scope > .el-icon')
    const svg = icon.querySelector('svg')
    const span = title.querySelector(':scope > span')
    const tr = title.getBoundingClientRect()
    const ir = icon.getBoundingClientRect()
    const sr = svg.getBoundingClientRect()
    const ics = getComputedStyle(icon)
    const tcs = getComputedStyle(title)
    const scs = getComputedStyle(span)
    const top = sr ? document.elementFromPoint(sr.x + sr.width / 2, sr.y + sr.height / 2) : null
    out[name] = {
      title: { x: tr.x, y: tr.y, w: tr.width, h: tr.height, padding: tcs.padding, justify: tcs.justifyContent, display: tcs.display, direction: tcs.flexDirection, wrap: tcs.flexWrap },
      icon: { x: ir.x, y: ir.y, w: ir.width, h: ir.height, width: ics.width, fontSize: ics.fontSize, display: ics.display },
      svg: { x: sr.x, y: sr.y, w: sr.width, h: sr.height },
      span: { width: scs.width, visibility: scs.visibility, text: span.textContent },
      topAtSvgCenter: top ? top.tagName + (top.className ? '.' + String(top.className).slice(0, 40) : '') : null
    }
  }
  return out
})
console.log(JSON.stringify(info, null, 1))

await page.screenshot({ path: 'sidebar-diag.png', clip: { x: 0, y: 0, width: 100, height: 900 } })
await browser.close()
console.log('done')
