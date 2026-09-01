/**
 * 派生读层（薄客户端，Phase 4 F3）
 *
 * 从 flow.js 迁移的纯派生读 + 会话态（行为等价，无逻辑改动）。
 * db 由后端 /api/snapshot 填充（refreshDb），所有读函数实时基于权威态计算；
 * 写操作已全部由后端执行（afterWrite / 直接 API 调用），本模块仅保留
 * markMessageRead 一处乐观本地写（标记已读，与原 flow.js 口径一致：afterWrite + 乐观更新）。
 * 不消耗种子随机序列，不修改业务状态（除标记已读）。
 */
import { db, NOW, MAP_NODES, tareOf, ROAD_MODES, isRoadMode } from './base'
import { afterWrite } from '@/api'
import { formatMoney } from '@/utils'
import dayjs from 'dayjs'

// re-export（视图保持既有导入路径）
export { tareOf, ROAD_MODES, isRoadMode }

/* ========== 会话（操作人） ========== */

/** 当前操作人（登录时写入；数据权限/消息可见性/标记已读使用） */
let operator = { name: '未登录', username: '', role: '', driverId: '' }
export function setOperator(user) {
  if (user && user.username) {
    operator = { name: user.name || user.username, username: user.username, role: user.role || '', driverId: user.driverId || '' }
  }
}

/** M7 修复：清除操作人（退出登录时调用） */
export function clearOperator() {
  operator = { name: '未登录', username: '', role: '', driverId: '' }
}

/* ========== 消息中心（派生读 + 标记已读） ========== */

/** 当前操作人可见消息（M4：广播全员可见；定向消息仅目标角色可见；平台管理员可见全部） */
export function visibleMessages() {
  if (operator.role === '平台管理员') return [...db.messages]
  return db.messages.filter((m) => !m.to || m.to.includes(operator.role))
}

/** 标记消息已读（仅当前操作人可见的消息可标记；afterWrite 落后端 + 乐观本地更新） */
export function markMessageRead(m) {
  afterWrite('markMessageRead', m)
  if (m && !m.read && (!m.to || m.to.includes(operator.role) || operator.role === '平台管理员')) m.read = true
  return { ok: true }
}

/** 当前操作人免打扰设置 */
export function getDnd() {
  const d = db.dnd && db.dnd[operator.username]
  return d
    ? { ...d }
    : { enabled: false, quietStart: '22:00', quietEnd: '08:00', mutedTypes: [] }
}

/** 消息是否被当前操作人免打扰：类型屏蔽，或消息时间落在免打扰时段（支持跨零点） */
export function isMuted(m) {
  const d = getDnd()
  if (!d.enabled || !m) return false
  if ((d.mutedTypes || []).includes(m.type)) return true
  const t = String(m.time || '').slice(11, 16)
  if (!t) return false
  return d.quietStart <= d.quietEnd
    ? t >= d.quietStart && t < d.quietEnd
    : t >= d.quietStart || t < d.quietEnd
}

/** 未读数（顶栏角标/消息中心）：未读且未被免打扰 */
export function unreadCount() {
  return visibleMessages().filter((m) => !m.read && !isMuted(m)).length
}

/* ========== 数据权限（行级，按登录账号） ========== */

/** 全部区域（由场站 region 派生，单一来源；动态函数：db 由后端 hydrate 后填充） */
export function dataRegions() {
  return [...new Set((db.terminals || []).map((t) => t.region))]
}

/** 当前操作人的数据范围：regions 为空 = 全量数据；平台管理员恒为全量 */
export function dataScopeOf() {
  if (operator.role === '平台管理员') return { regions: [] }
  return (db.dataScopes && db.dataScopes[operator.username]) || { regions: [] }
}

/** 记录的装货侧区域：调度单/计划直接取 loadTerminalId；合同/结算单经合同派生 */
export function recordRegion(record) {
  const loadTerminalId = record && (record.loadTerminalId || (record.contractId && contractOf(record.contractId)?.loadTerminalId))
  const t = db.terminals.find((x) => x.id === loadTerminalId)
  return t ? t.region : null
}

/** 记录是否在当前操作人数据范围内（无范围=全量；无区域归属的记录可见） */
export function inDataScope(record) {
  const scope = dataScopeOf()
  if (!scope.regions.length) return true
  const region = recordRegion(record)
  return region ? scope.regions.includes(region) : true
}

/* ========== 轨迹 / 扫码（确定性派生） ========== */

function hashStr(s) {
  let n = 0
  for (const ch of String(s)) n = (n * 31 + ch.charCodeAt(0)) % 2147483647
  return n
}

export function hashOffset(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997
  return (h % 5) - 2
}

/** 轨迹点：沿线段均匀取 21 点，叠加按单号确定性派生的横向偏移 */
export function trackPointsOf(d) {
  const from = MAP_NODES[d.loadTerminalId]
  const to = MAP_NODES[d.unloadTerminalId]
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const base = hashOffset(d.id) * 5
  const phase = (hashOffset(d.id) % 6) * 0.7
  const pts = []
  for (let i = 0; i <= 20; i++) {
    const p = i / 20
    const off = base + 8 * Math.sin(i * 0.6 + phase)
    pts.push({ x: from.x + dx * p + nx * off, y: from.y + dy * p + ny * off })
  }
  return pts
}

/** 轨迹最大偏离：轨迹点到线路直线的最大垂直距离 */
export function maxDeviationOf(d) {
  const from = MAP_NODES[d.loadTerminalId]
  const to = MAP_NODES[d.unloadTerminalId]
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len2 = dx * dx + dy * dy || 1
  let max = 0
  for (const p of trackPointsOf(d)) {
    const t = ((p.x - from.x) * dx + (p.y - from.y) * dy) / len2
    const px = from.x + dx * t
    const py = from.y + dy * t
    max = Math.max(max, Math.sqrt((p.x - px) ** 2 + (p.y - py) ** 2))
  }
  return Math.round(max)
}

/** 装货码：装货场站张贴，司机扫码确认装货（ZD + 6 位） */
export function loadCodeOf(d) {
  return 'ZD' + String(100000 + (hashStr(d.id + ':load') % 900000))
}

/** 卸货码：卸货场站张贴，司机扫码确认卸货（XD + 6 位） */
export function unloadCodeOf(d) {
  return 'XD' + String(100000 + (hashStr(d.id + ':unload') % 900000))
}

/* ========== 合同 / 信用（派生读） ========== */

const contractOf = (id) => db.contracts.find((c) => c.id === id)

/** 客户未付余额（账单未付金额合计） */
export function outstandingOf(customerId) {
  return db.settlements
    .filter((s) => s.customerId === customerId)
    .reduce((sum, s) => sum + Math.max(0, s.totalAmount - s.paidAmount), 0)
}

/** 客户预付款台账 */
export function prepaymentOf(customerId) {
  return db.prepayments.filter((p) => p.customerId === customerId)
}

/** 客户可用预付款（已收 - 已抵扣） */
export function prepaymentAvailable(customerId) {
  return prepaymentOf(customerId).reduce((s, p) => s + (p.amount - p.used), 0)
}

/** 信用校验：信用占用（未付 - 预付）+ 本单 不得超过授信额度 */
export function creditCheck(customerId, orderAmount) {
  const c = db.customers.find((x) => x.id === customerId)
  if (!c) return { ok: true, message: '' }
  const outstanding = outstandingOf(customerId)
  const prepay = prepaymentAvailable(customerId)
  const occupied = Math.max(0, outstanding - prepay)
  const total = occupied + orderAmount
  if (total > c.creditLimit) {
    return {
      ok: false,
      message: `${c.name} 信用占用 ${formatMoney(occupied)}（未付 ${formatMoney(outstanding)} - 预付 ${formatMoney(prepay)}）+ 本单 ${formatMoney(orderAmount)} = ${formatMoney(total)}，超出授信额度 ${formatMoney(c.creditLimit)}`
    }
  }
  return { ok: true, message: '' }
}

/** 合同剩余可计划量：合同总量 - 未取消计划批次量之和 */
export function contractRemaining(contractId) {
  const c = contractOf(contractId)
  if (!c) return 0
  const planned = db.plans
    .filter((p) => p.contractId === contractId && p.status !== 'cancelled')
    .reduce((s, p) => s + p.quantity, 0)
  return Math.max(0, c.quantity - planned)
}

/* ========== 运价 / 保险（派生读） ========== */

export function listRateCards() {
  return [...db.rateCards]
}

/** 查线路运价（按 商品+装/卸场站+方式 匹配启用中的运价卡） */
export function rateOf(commodityId, loadTerminalId, unloadTerminalId, mode) {
  return (
    db.rateCards.find(
      (r) =>
        r.status === 'active' &&
        r.commodityId === commodityId &&
        r.loadTerminalId === loadTerminalId &&
        r.unloadTerminalId === unloadTerminalId &&
        (r.mode || '公路') === (mode || '公路')
    ) || null
  )
}

export function listInsuranceClaims() {
  return [...db.insurance]
}

/* ========== 安全 / 车辆（派生读） ========== */

/** 车辆年检过期（nextInspection 早于今天） */
export function vehicleInspectionExpired(v) {
  return !!v && !!v.nextInspection && dayjs(v.nextInspection).isBefore(dayjs(), 'day')
}

/** 未完结车次状态（占用车辆/司机，派车互斥口径） */
export const BUSY_STATUSES = ['pending', 'loading', 'intransit', 'unloading', 'exception']

/* ========== 仓储（派生读） ========== */

/** 指定仓库×商品的安全库存记录（未设置返回 null） */
export function safetyStockOf(warehouseId, commodityId) {
  return (db.safetyStocks || []).find((x) => x.warehouseId === warehouseId && x.commodityId === commodityId) || null
}

/** 指定仓库×商品的可发库存（normal 状态批次合计） */
export function availableStockOf(warehouseId, commodityId) {
  return db.inventories
    .filter((i) => i.warehouseId === warehouseId && i.commodityId === commodityId && i.status === 'normal')
    .reduce((s, i) => s + i.quantity, 0)
}

/** 安全库存预警：可发库存 < 安全库存下限（仓库×商品维度，实时计算） */
export function inventoryAlerts() {
  const res = []
  for (const sq of db.safetyStocks || []) {
    const available = availableStockOf(sq.warehouseId, sq.commodityId)
    if (available < sq.minQty) {
      res.push({ warehouseId: sq.warehouseId, commodityId: sq.commodityId, available, minQty: sq.minQty, gap: +(sq.minQty - available).toFixed(2) })
    }
  }
  return res
}

/* ========== 结算费用 / 候选（预览口径，与后端一致） ========== */

export const QUALITY_STANDARD = { moisture: 10, ash: 15 }
export const QUALITY_RATE = { moisture: 0.015, ash: 0.01 }

/** 单车结算量：按磅结算，取出磅净重；无出磅单时回退调度量 */
export function settleQtyOf(d) {
  const w = db.weighings.find((x) => x.dispatchId === d.id && x.type === '出磅')
  return w ? w.net : d.quantity
}

/** 质量扣重吨数：按出磅净重对水分/灰分超标部分比例扣减 */
export function qualityDeductionQty(d) {
  if (!d || !d.quality) return 0
  const net = settleQtyOf(d)
  const over =
    Math.max(0, d.quality.moisture - QUALITY_STANDARD.moisture) * QUALITY_RATE.moisture +
    Math.max(0, d.quality.ash - QUALITY_STANDARD.ash) * QUALITY_RATE.ash
  return +(net * over).toFixed(2)
}

/** 结算费用计算：按出磅净重结算，损耗/质量扣重/已关闭异常损失作为扣减项 */
export function calcSettlementFees(contract, dispatches) {
  const fallbackPrice = contract ? contract.unitPrice : 0
  const priceOf = (d) => (d.unitPrice != null ? d.unitPrice : fallbackPrice)
  const dispatchQuantity = dispatches.reduce((s, d) => s + d.quantity, 0)
  const totalQuantity = +dispatches.reduce((s, d) => s + settleQtyOf(d), 0).toFixed(2)
  const lossQty = +(dispatchQuantity - totalQuantity).toFixed(2)
  const freight = Math.round(dispatches.reduce((s, d) => s + settleQtyOf(d) * priceOf(d), 0))
  const loadingFee = Math.round(totalQuantity * 8)
  const unloadingFee = Math.round(totalQuantity * 6)
  const lossDeduction = Math.round(dispatches.reduce((s, d) => s + (d.quantity - settleQtyOf(d)) * priceOf(d), 0))
  const qualityQty = +dispatches.reduce((s, d) => s + qualityDeductionQty(d), 0).toFixed(2)
  const qualityDeduction = Math.round(dispatches.reduce((s, d) => s + qualityDeductionQty(d) * priceOf(d), 0))
  const exceptionLoss = dispatches.reduce(
    (sum, d) =>
      sum +
      db.exceptions
        .filter((e) => e.dispatchId === d.id && e.status === 'closed')
        .reduce((s, e) => s + (e.cost || 0), 0),
    0
  )
  return {
    dispatchQuantity,
    totalQuantity,
    lossQty,
    freight,
    loadingFee,
    unloadingFee,
    lossDeduction,
    qualityQty,
    qualityDeduction,
    exceptionLoss
  }
}

/** 结算候选：已完成且未入账单的调度单，按 合同+月份(卸货时间) 聚合 */
export function settlementCandidates() {
  const groups = new Map()
  for (const d of db.dispatches) {
    if (d.status !== 'completed' || d.settled) continue
    const period = d.unloadTime ? dayjs(d.unloadTime).format('YYYY-MM') : dayjs(NOW).format('YYYY-MM')
    const key = `${d.contractId}|${period}`
    if (!groups.has(key)) {
      const c = contractOf(d.contractId)
      groups.set(key, { key, contractId: d.contractId, customerId: c ? c.shipperId : '', period, dispatches: [] })
    }
    groups.get(key).dispatches.push(d)
  }
  return [...groups.values()].map((g) => {
    const quantity = g.dispatches.reduce((s, d) => s + d.quantity, 0)
    const c = contractOf(g.contractId)
    // M1 修复：预览运费与实际账单同口径（calcSettlementFees：车次快照单价 × 出磅净重）
    const freight = calcSettlementFees(c, g.dispatches).freight
    return { ...g, dispatchCount: g.dispatches.length, quantity, freight }
  })
}

/** 应付统计（待付/已付 笔数与金额） */
export function payableStats() {
  const pending = db.payables.filter((p) => p.status === 'pending')
  const paid = db.payables.filter((p) => p.status === 'paid')
  return {
    pendingCount: pending.length,
    pendingAmount: pending.reduce((s, p) => s + p.amount, 0),
    paidCount: paid.length,
    paidAmount: paid.reduce((s, p) => s + p.amount, 0)
  }
}

/* ========== 成本侧（司机收入） ========== */

/** 单车次成本：公路口径按车辆（燃油×装载系数 + 磨损 + 司机 + 过路费 + 折旧） */
export function tripCostOf(d) {
  const dist = d.distance || 300
  const v = d.vehicleId ? db.vehicles.find((x) => x.id === d.vehicleId) : null
  if (!v) {
    const fuel = Math.round(dist * 2.2)
    const wear = Math.round(dist * 0.5)
    const toll = Math.round(dist * 0.35)
    return { fuel, wear, driver: 0, toll, depreciation: 0, total: fuel + wear + toll }
  }
  const loadFactor = Math.max(0.5, Math.min(1, d.quantity / (v.capacity || 35)))
  const fuel = Math.round(dist * 1.8 * loadFactor)
  const wear = Math.round(dist * 0.6)
  const driver = Math.round(600 + dist * 0.25)
  const toll = Math.round(dist * 0.35)
  const depreciation = Math.round((v.monthlyCost || 0) / 30)
  return { fuel, wear, driver, toll, depreciation, total: fuel + wear + driver + toll + depreciation }
}

/** 司机趟次收入：与成本侧司机项同口径（底薪 600 + 0.25 元/公里） */
export function driverIncomeOf(d) {
  if (!d || !d.driverId) return 0
  return tripCostOf(d).driver
}
