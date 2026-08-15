import { db, rng, randInt, NOW } from './base'
import dayjs from 'dayjs'
import { round } from '@/utils'

/**
 * 看板聚合数据：从 db 实时汇总 + 历史趋势（种子随机生成）
 */

// 近 12 个月运量/收入趋势
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

// 近 7 天装卸量
const dailyTrend = Array.from({ length: 7 }, (_, i) => {
  const d = dayjs(NOW).subtract(6 - i, 'day')
  return {
    date: d.format('MM-DD'),
    load: randInt(1800, 4200),
    unload: randInt(1600, 3800)
  }
})

// 近 30 天异常趋势
const exceptionTrend = Array.from({ length: 30 }, (_, i) => {
  const d = dayjs(NOW).subtract(29 - i, 'day')
  return {
    date: d.format('MM-DD'),
    count: randInt(0, 5)
  }
})

// 商品结构（按类别汇总已完成调度量）
const categoryMap = {}
for (const d of db.dispatches) {
  if (d.status !== 'completed') continue
  const c = db.commodities.find((x) => x.id === d.commodityId)
  categoryMap[c.category] = (categoryMap[c.category] || 0) + d.quantity
}
const commodityStructure = Object.entries(categoryMap).map(([name, value]) => ({ name, value }))

// 运输方式占比
const modeMap = {}
for (const c of db.contracts) {
  modeMap[c.mode] = (modeMap[c.mode] || 0) + c.quantity
}
const modeShare = Object.entries(modeMap).map(([name, value]) => ({ name, value }))

// 场站吞吐量 TOP
const terminalThroughput = db.terminals
  .map((t) => ({ name: t.name.replace(/(煤炭|矿石|散货)?(码头|装车站|煤运站|原料场)$/, ''), value: t.todayThroughput }))
  .sort((a, b) => b.value - a.value)
  .slice(0, 8)

// 车辆状态分布
const vehicleStatusMap = {}
for (const v of db.vehicles) {
  const label = { inuse: '运输中', idle: '空闲', maintenance: '维修中', overload: '超载预警', scrapped: '已报废' }[v.status]
  vehicleStatusMap[label] = (vehicleStatusMap[label] || 0) + 1
}
const vehicleStatus = Object.entries(vehicleStatusMap).map(([name, value]) => ({ name, value }))

// 核心 KPI
const completedDispatches = db.dispatches.filter((d) => d.status === 'completed')
const intransitCount = db.dispatches.filter((d) => d.status === 'intransit').length
const monthStart = dayjs(NOW).startOf('month')
const monthVolume = completedDispatches
  .filter((d) => dayjs(d.dispatchTime).isAfter(monthStart))
  .reduce((s, d) => s + d.quantity, 0)
const totalVolume = volumeTrend.reduce((s, m) => s + m.volume, 0) + monthVolume
const totalRevenue = volumeTrend.reduce((s, m) => s + m.revenue, 0)
const onTimeRate = round(96.2 + rng() * 2.5, 1)
const utilization = round((intransitCount / db.vehicles.filter((v) => v.status !== 'scrapped').length) * 100, 1)

export const dashboard = {
  kpi: {
    totalVolume, // 累计运量（吨）
    totalRevenue, // 累计运费收入（元）
    monthVolume, // 本月运量
    intransitCount, // 在途车辆
    onTimeRate, // 准时交付率 %
    safeDays: 386, // 安全运行天数
    customerCount: db.customers.filter((c) => c.status === 'active').length,
    executingContracts: db.contracts.filter((c) => c.status === 'executing').length,
    utilization // 车辆利用率 %
  },
  volumeTrend,
  dailyTrend,
  exceptionTrend,
  commodityStructure,
  modeShare,
  terminalThroughput,
  vehicleStatus
}

/** 工作台待办 */
export const workbenchTodos = {
  pendingContracts: db.contracts.filter((c) => c.status === 'pending').length,
  pendingPlans: db.plans.filter((p) => p.status === 'pending').length,
  pendingDispatches: db.dispatches.filter((d) => d.status === 'pending').length,
  pendingExceptions: db.exceptions.filter((e) => e.status === 'pending').length,
  pendingSettlements: db.settlements.filter((s) => s.status === 'pending' || s.status === 'reconciling').length
}

/** 公告 */
export const notices = [
  { id: 1, title: '关于 8 月份煤炭运输旺季运力保障的通知', date: dayjs(NOW).subtract(1, 'day').format('MM-DD'), tag: '重要' },
  { id: 2, title: '秦皇岛港 1 号煤仓 8 月 20 日检修，预计影响 2 天', date: dayjs(NOW).subtract(2, 'day').format('MM-DD'), tag: '场站' },
  { id: 3, title: '新版磅单系统上线，请各场站操作员完成培训', date: dayjs(NOW).subtract(4, 'day').format('MM-DD'), tag: '系统' },
  { id: 4, title: '汛期安全行车提示：关注 G6/G18 沿线雨情预警', date: dayjs(NOW).subtract(6, 'day').format('MM-DD'), tag: '安全' },
  { id: 5, title: '7 月结算单已全部完成对账，请各客户核对', date: dayjs(NOW).subtract(8, 'day').format('MM-DD'), tag: '结算' }
]
