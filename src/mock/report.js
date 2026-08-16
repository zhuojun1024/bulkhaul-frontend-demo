import { db, NOW } from './base'
import { outstandingOf, tripCostOf } from './flow'
import dayjs from 'dayjs'
import { round } from '@/utils'

/**
 * 报表中心：按业务口径从 db 实时汇总（替代纯 CSV 导出）
 * 口径说明：
 *  - 月度运营：车次/运量按"卸货完成时间"归月，结算按账单周期，收款按流水时间
 *  - 客户经营：结算/未付按客户账单汇总，授信占用=未付余额/授信额度
 *  - 商品运量：损耗率=（进磅净重-出磅净重）/进磅净重，按调度单配对
 *  - 场站吞吐：按磅单场站与类型汇总
 *  - 成本利润：单车次全成本（燃油×装载系数+磨损+司机+过路费+折旧，非公路按运输单元能耗口径），
 *    收入=调度单约定运费（quantity×unitPrice），毛利=收入-成本
 */

/** 月度运营报表（近 6 个月） */
export function monthlyReport() {
  const months = Array.from({ length: 6 }, (_, i) => dayjs(NOW).subtract(5 - i, 'month').format('YYYY-MM'))
  return months.map((m) => {
    const done = db.dispatches.filter((d) => d.status === 'completed' && d.unloadTime && d.unloadTime.slice(0, 7) === m)
    const settlements = db.settlements.filter((s) => s.period === m)
    const payments = db.payments.filter((p) => p.payTime.slice(0, 7) === m)
    return {
      month: m,
      trips: done.length,
      volume: +done.reduce((s, d) => s + d.quantity, 0).toFixed(1),
      settleAmount: settlements.reduce((s, x) => s + x.totalAmount, 0),
      paidAmount: payments.reduce((s, x) => s + x.amount, 0),
      overdueCount: settlements.filter((s) => s.status === 'overdue' && s.period === m).length
    }
  })
}

/** 客户经营报表（按结算金额降序） */
export function customerReport() {
  return db.customers
    .filter((c) => c.type === 'shipper' || c.type === 'both')
    .map((c) => {
      const contractIds = new Set(db.contracts.filter((x) => x.shipperId === c.id).map((x) => x.id))
      const done = db.dispatches.filter((d) => d.status === 'completed' && contractIds.has(d.contractId))
      const volume = done.reduce((s, d) => s + d.quantity, 0)
      const settleAmount = db.settlements.filter((s) => s.customerId === c.id).reduce((s, x) => s + x.totalAmount, 0)
      const outstanding = outstandingOf(c.id)
      return {
        id: c.id,
        name: c.name,
        contracts: contractIds.size,
        trips: done.length,
        volume,
        settleAmount,
        outstanding,
        creditLimit: c.creditLimit || 0,
        creditPct: c.creditLimit ? Math.round((outstanding / c.creditLimit) * 100) : 0
      }
    })
    .filter((r) => r.contracts > 0)
    .sort((a, b) => b.settleAmount - a.settleAmount)
}

/** 商品运量报表（含磅单损耗率） */
export function commodityReport() {
  const byDispatch = {}
  for (const w of db.weighings) {
    if (!byDispatch[w.dispatchId]) byDispatch[w.dispatchId] = {}
    byDispatch[w.dispatchId][w.type] = w
  }
  const lossMap = {}
  for (const id of Object.keys(byDispatch)) {
    const pair = byDispatch[id]
    if (!pair['进磅'] || !pair['出磅']) continue
    const d = db.dispatches.find((x) => x.id === id)
    if (!d) continue
    if (!lossMap[d.commodityId]) lossMap[d.commodityId] = { loss: 0, total: 0 }
    lossMap[d.commodityId].loss += pair['进磅'].net - pair['出磅'].net
    lossMap[d.commodityId].total += pair['进磅'].net
  }
  return db.commodities
    .map((c) => {
      const done = db.dispatches.filter((d) => d.status === 'completed' && d.commodityId === c.id)
      const volume = done.reduce((s, d) => s + d.quantity, 0)
      const l = lossMap[c.id]
      return {
        id: c.id,
        name: c.name,
        category: c.category,
        trips: done.length,
        volume,
        lossRate: l && l.total ? round((l.loss / l.total) * 100, 2) : 0
      }
    })
    .filter((r) => r.trips > 0)
    .sort((a, b) => b.volume - a.volume)
}

/** 场站吞吐报表（按磅单进出汇总） */
export function terminalReport() {
  return db.terminals
    .map((t) => {
      const inW = db.weighings.filter((w) => w.terminalId === t.id && w.type === '进磅')
      const outW = db.weighings.filter((w) => w.terminalId === t.id && w.type === '出磅')
      return {
        id: t.id,
        name: t.name,
        loadTrips: inW.length,
        loadVolume: +inW.reduce((s, w) => s + w.net, 0).toFixed(1),
        unloadTrips: outW.length,
        unloadVolume: +outW.reduce((s, w) => s + w.net, 0).toFixed(1)
      }
    })
    .filter((r) => r.loadTrips > 0 || r.unloadTrips > 0)
    .sort((a, b) => b.loadVolume + b.unloadVolume - (a.loadVolume + a.unloadVolume))
}

/** 成本利润报表：已完成车次单车次成本归集（收入=调度单约定运费）
 *  口径：成本按 flow.tripCostOf 全成本（公路含车辆折旧，非公路按运输单元能耗口径）；
 *  月度按卸货完成时间归月（与月度运营同口径），近 6 个月 */
export function costReport() {
  const done = db.dispatches.filter((d) => d.status === 'completed')
  const rows = done.map((d) => ({ d, cost: tripCostOf(d), revenue: d.fee || 0 }))

  const sumCost = (list) => list.reduce((s, x) => s + x.cost.total, 0)
  const sumRevenue = (list) => list.reduce((s, x) => s + x.revenue, 0)
  const withProfit = (r) => ({
    ...r,
    profit: r.revenue - r.cost,
    margin: r.revenue ? round(((r.revenue - r.cost) / r.revenue) * 100, 1) : 0
  })

  const summary = withProfit({ trips: rows.length, cost: sumCost(rows), revenue: sumRevenue(rows) })

  // 按车辆（公路车次）
  const vMap = new Map()
  for (const x of rows) {
    if (!x.d.vehicleId) continue
    if (!vMap.has(x.d.vehicleId)) {
      const v = db.vehicles.find((vv) => vv.id === x.d.vehicleId)
      vMap.set(x.d.vehicleId, { id: x.d.vehicleId, plate: v?.plate || '-', type: v?.type || '', trips: 0, cost: 0, revenue: 0 })
    }
    const r = vMap.get(x.d.vehicleId)
    r.trips += 1
    r.cost += x.cost.total
    r.revenue += x.revenue
  }
  const byVehicle = [...vMap.values()].map(withProfit).sort((a, b) => b.trips - a.trips)

  // 按线路（装货场→卸货场）
  const rMap = new Map()
  for (const x of rows) {
    const key = x.d.loadTerminalId + x.d.unloadTerminalId
    if (!rMap.has(key)) {
      rMap.set(key, {
        key,
        route: `${db.terminals.find((t) => t.id === x.d.loadTerminalId)?.name || '-'}→${db.terminals.find((t) => t.id === x.d.unloadTerminalId)?.name || '-'}`,
        trips: 0,
        cost: 0,
        revenue: 0
      })
    }
    const r = rMap.get(key)
    r.trips += 1
    r.cost += x.cost.total
    r.revenue += x.revenue
  }
  const byRoute = [...rMap.values()].map(withProfit).sort((a, b) => b.trips - a.trips)

  // 按月（近 6 个月，卸货完成时间归月）
  const months = Array.from({ length: 6 }, (_, i) => dayjs(NOW).subtract(5 - i, 'month').format('YYYY-MM'))
  const byMonth = months.map((m) => {
    const list = rows.filter((x) => x.d.unloadTime && x.d.unloadTime.slice(0, 7) === m)
    return withProfit({ month: m, trips: list.length, cost: sumCost(list), revenue: sumRevenue(list) })
  })

  return { summary, byVehicle, byRoute, byMonth }
}
