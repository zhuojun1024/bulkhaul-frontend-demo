import dayjs from 'dayjs'

/** 金额格式化：1234567.8 -> ¥1,234,567.80 */
export function formatMoney(n, withSymbol = true) {
  const v = Number(n || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
  return withSymbol ? `¥${v}` : v
}

/** 重量格式化：1234.56 -> 1,234.56 t */
export function formatWeight(n) {
  return `${Number(n || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`
}

/** 数字千分位 */
export function formatNum(n) {
  return Number(n || 0).toLocaleString('zh-CN')
}

export function formatDate(d, fmt = 'YYYY-MM-DD') {
  return d ? dayjs(d).format(fmt) : '-'
}

export function formatDateTime(d) {
  return formatDate(d, 'YYYY-MM-DD HH:mm')
}

/** 相对时间：3 分钟前 / 2 小时前 */
export function fromNow(d) {
  const diff = Date.now() - dayjs(d).valueOf()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const day = Math.floor(h / 24)
  if (day < 30) return `${day} 天前`
  return formatDate(d)
}

/** 模拟接口延迟 */
export function delay(ms = 300) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ========== 种子随机数（保证 mock 数据稳定） ========== */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

export function pickN(rng, arr, n) {
  const copy = [...arr]
  const res = []
  while (res.length < n && copy.length) {
    res.push(copy.splice(Math.floor(rng() * copy.length), 1)[0])
  }
  return res
}

export function round(n, digits = 1) {
  const p = Math.pow(10, digits)
  return Math.round(n * p) / p
}
