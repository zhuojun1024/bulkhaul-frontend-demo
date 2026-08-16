import { db, NOW } from './base'
import { outstandingOf } from './flow'
import dayjs from 'dayjs'
import { round } from '@/utils'

/**
 * 报表中心：按业务口径从 db 实时汇总（替代纯 CSV 导出）
 * 口径说明：
 *  - 月度运营：车次/运量按"卸货完成时间"归月，结算按账单周期，收款按流水时间
 *  - 客户经营：结算/未付按客户账单汇总，授信占用=未付余额/授信额度
 *  - 商品运量：损耗率=（进磅净重-出磅净重）/进磅净重，按调度单配对
 *  - 场站吞吐：按磅单场站与类型汇总
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
      overdueCount: settlements.filter((s) => s.status === 'overdue').length
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
