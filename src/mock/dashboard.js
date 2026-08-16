import { db, rng, randInt, NOW } from './base'
import dayjs from 'dayjs'
import { round, formatMoney } from '@/utils'

/**
 * 看板聚合数据：
 * - 历史趋势（volumeTrend/dailyTrend/exceptionTrend）为种子随机生成的历史数据
 * - 其余指标通过 getter 从 db 实时汇总（数据变更后自动更新，持久化恢复后同样有效）
 */

// 近 12 个月运量/收入趋势（历史数据，种子随机）
const volumeTrend = Array.from({ length: 12 }, (_, i) => {
  const month = dayjs(NOW).subtract(11 - i, 'month')
  const base = 38 + Math.sin(i / 2) * 6
  const volume = Math.round((base + rng() * 10) * 10000)
  return {
    month: month.format('YYYY-MM'),
    volume,
    revenue: Math.round(volume * (38 + rng() * 8))
  }
})

// 近 7 天装卸量（历史数据，种子随机）
const dailyTrend = Array.from({ length: 7 }, (_, i) => {
  const d = dayjs(NOW).subtract(6 - i, 'day')
  return {
    date: d.format('MM-DD'),
    load: randInt(1800, 4200),
    unload: randInt(1600, 3800)
  }
})

// 近 30 天异常趋势（历史数据，种子随机）
const exceptionTrend = Array.from({ length: 30 }, (_, i) => {
  const d = dayjs(NOW).subtract(29 - i, 'day')
  return {
    date: d.format('MM-DD'),
    count: randInt(0, 5)
  }
})

/* ===== 实时指标（getter 从 db 汇总） ===== */

/** 商品结构（按类别汇总已完成调度量） */
function computeCommodityStructure() {
  const categoryMap = {}
  for (const d of db.dispatches) {
    if (d.status !== 'completed') continue
    const c = db.commodities.find((x) => x.id === d.commodityId)
    categoryMap[c.category] = (categoryMap[c.category] || 0) + d.quantity
  }
  return Object.entries(categoryMap).map(([name, value]) => ({ name, value }))
}

/** 运输方式占比（按合同量） */
function computeModeShare() {
  const modeMap = {}
  for (const c of db.contracts) {
    modeMap[c.mode] = (modeMap[c.mode] || 0) + c.quantity
  }
  return Object.entries(modeMap).map(([name, value]) => ({ name, value }))
}

/** 场站吞吐量 TOP8 */
function computeTerminalThroughput() {
  return db.terminals
    .map((t) => ({ name: t.name.replace(/(煤炭|矿石|散货)?(码头|装车站|煤运站|原料场)$/, ''), value: t.todayThroughput }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
}

/** 车辆状态分布 */
function computeVehicleStatus() {
  const map = {}
  for (const v of db.vehicles) {
    const label = { inuse: '运输中', idle: '空闲', maintenance: '维修中', overload: '超载预警', scrapped: '已报废' }[v.status]
    map[label] = (map[label] || 0) + 1
  }
  return Object.entries(map).map(([name, value]) => ({ name, value }))
}

/** 安全运行天数：距最近一次"重大"事故的间隔（无重大事故时按最近一次任意级别事故计） */
function computeSafeDays() {
  const major = db.accidents.filter((a) => a.level === '重大')
  const pool = major.length ? major : db.accidents
  if (!pool.length) return 365
  const latest = pool.reduce((m, a) => (a.time > m ? a.time : m), pool[0].time)
  return Math.max(1, dayjs(NOW).diff(dayjs(latest), 'day'))
}

/** 核心 KPI（口径修正：准时率/利用率按实际执行数据计算，不再取随机值） */
function computeKpi() {
  const completedDispatches = db.dispatches.filter((d) => d.status === 'completed')
  const intransitCount = db.dispatches.filter((d) => d.status === 'intransit').length
  const monthStart = dayjs(NOW).startOf('month')
  const monthVolume = completedDispatches
    .filter((d) => d.dispatchTime && dayjs(d.dispatchTime).isAfter(monthStart))
    .reduce((s, d) => s + d.quantity, 0)
  const totalVolume = volumeTrend.reduce((s, m) => s + m.volume, 0) + monthVolume
  const totalRevenue = volumeTrend.reduce((s, m) => s + m.revenue, 0)
  // 准时交付率：已完成车次中，实际运输时长（装货→卸货）不超过理论时长（50km/h）×120% + 1h 装卸缓冲 的比例
  const measurable = completedDispatches.filter((d) => d.loadTime && d.unloadTime && d.distance)
  const onTime = measurable.filter(
    (d) => dayjs(d.unloadTime).diff(dayjs(d.loadTime), 'minute') <= (d.distance / 50) * 60 * 1.2 + 60
  ).length
  const onTimeRate = measurable.length ? round((onTime / measurable.length) * 100, 1) : 0
  // 车辆利用率：运输中车辆 / 非报废车辆
  const usable = db.vehicles.filter((v) => v.status !== 'scrapped').length
  const utilization = usable ? round((db.vehicles.filter((v) => v.status === 'inuse').length / usable) * 100, 1) : 0
  return {
    totalVolume, // 累计运量（吨）
    totalRevenue, // 累计运费收入（元）
    monthVolume, // 本月运量
    intransitCount, // 在途车辆
    onTimeRate, // 准时交付率 %
    safeDays: computeSafeDays(), // 安全运行天数（按事故记录实时计算）
    customerCount: db.customers.filter((c) => c.status === 'active').length,
    executingContracts: db.contracts.filter((c) => c.status === 'executing').length,
    utilization // 车辆利用率 %
  }
}

export const dashboard = {
  get kpi() {
    return computeKpi()
  },
  get commodityStructure() {
    return computeCommodityStructure()
  },
  get modeShare() {
    return computeModeShare()
  },
  get terminalThroughput() {
    return computeTerminalThroughput()
  },
  get vehicleStatus() {
    return computeVehicleStatus()
  },
  volumeTrend,
  dailyTrend,
  exceptionTrend
}

/** 工作台待办（实时） */
export const workbenchTodos = {
  get pendingContracts() {
    return db.contracts.filter((c) => c.status === 'pending').length
  },
  get pendingPlans() {
    return db.plans.filter((p) => p.status === 'pending').length
  },
  get pendingDispatches() {
    return db.dispatches.filter((d) => d.status === 'pending').length
  },
  get pendingExceptions() {
    return db.exceptions.filter((e) => e.status === 'pending').length
  },
  get pendingSettlements() {
    return db.settlements.filter((s) => s.status === 'pending' || s.status === 'reconciling').length
  }
}

/* ===== 工作台指标与待办（P2：聚合下沉服务层，视图只展示；对接后为后端聚合接口） ===== */

/** 工作台指标（今日/本月 + 环比基期：昨日/上月） */
export function workbenchStats() {
  const today = dayjs().format('YYYY-MM-DD')
  const month = dayjs().format('YYYY-MM')
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
  const prevMonth = dayjs().subtract(1, 'month').format('YYYY-MM')
  const sumNet = (list) => +list.reduce((s, w) => s + w.net, 0).toFixed(1)
  return {
    todayDispatches: db.dispatches.filter((d) => d.dispatchTime.slice(0, 10) === today).length,
    todayLoad: sumNet(db.weighings.filter((w) => w.type === '进磅' && w.time.slice(0, 10) === today)),
    todayUnload: sumNet(db.weighings.filter((w) => w.type === '出磅' && w.time.slice(0, 10) === today)),
    monthSettled:
      db.settlements
        .filter((s) => s.status === 'settled' && s.settleDate && s.settleDate.slice(0, 7) === month)
        .reduce((s, x) => s + x.totalAmount, 0) / 10000,
    yesterdayDispatches: db.dispatches.filter((d) => d.dispatchTime.slice(0, 10) === yesterday).length,
    yesterdayLoad: sumNet(db.weighings.filter((w) => w.type === '进磅' && w.time.slice(0, 10) === yesterday)),
    yesterdayUnload: sumNet(db.weighings.filter((w) => w.type === '出磅' && w.time.slice(0, 10) === yesterday)),
    prevMonthSettled:
      db.settlements
        .filter((s) => s.status === 'settled' && s.settleDate && s.settleDate.slice(0, 7) === prevMonth)
        .reduce((s, x) => s + x.totalAmount, 0) / 10000
  }
}

/** 工作台待办列表（纯数据：key/title/desc/path；图标配色为视图层关注点） */
export function workbenchTodoList() {
  const list = []
  const pendingContracts = db.contracts.filter((c) => c.status === 'pending')
  if (pendingContracts.length) {
    list.push({ key: 'contract', title: `${pendingContracts.length} 份合同待审批`, desc: pendingContracts[0].name, path: '/contract' })
  }
  const pendingDispatches = db.dispatches.filter((d) => d.status === 'pending')
  if (pendingDispatches.length) {
    list.push({ key: 'dispatch', title: `${pendingDispatches.length} 张调度单待装货`, desc: `最早下发：${pendingDispatches[0].dispatchTime}`, path: '/dispatch' })
  }
  const pendingExceptions = db.exceptions.filter((e) => e.status === 'pending')
  if (pendingExceptions.length) {
    list.push({ key: 'exception', title: `${pendingExceptions.length} 条异常待处理`, desc: pendingExceptions[0].description, path: '/exception' })
  }
  const pendingSettlements = db.settlements.filter((s) => s.status === 'pending')
  if (pendingSettlements.length) {
    list.push({
      key: 'settlement',
      title: `${pendingSettlements.length} 笔结算待对账`,
      desc: `合计 ${formatMoney(pendingSettlements.reduce((s, x) => s + x.totalAmount, 0))}`,
      path: '/settlement'
    })
  }
  const overdue = db.settlements.filter((s) => s.status === 'overdue')
  if (overdue.length) {
    list.push({ key: 'overdue', title: `${overdue.length} 笔结算已逾期`, desc: `最早周期：${overdue[0].period}`, path: '/settlement' })
  }
  return list
}

/** 天气（按日期确定性派生，演示数据源；后续可替换为真实天气接口） */
const WEATHERS = ['晴', '多云', '阴', '小雨', '晴', '晴', '多云', '雷阵雨']
export function weatherOf(dateStr) {
  let n = 0
  for (const ch of String(dateStr)) n = (n * 31 + ch.charCodeAt(0)) % 997
  const cond = WEATHERS[n % WEATHERS.length]
  const temp = 16 + (n % 18)
  return {
    city: '北京',
    temp,
    cond,
    tip: cond === '小雨' || cond === '雷阵雨' ? '雨天路滑，注意行车安全' : '适宜运输'
  }
}
