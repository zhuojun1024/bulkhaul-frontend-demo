import { db, randInt, randomName, ROUTES, NOW } from './base'
import dayjs from 'dayjs'
import { round, formatMoney } from '@/utils'

/**
 * 业务流转中枢：集中管理调度单状态机，及向计划/合同/资源的回卷联动
 * 状态机：pending(待装货) → loading(装货中) → intransit(在途) → unloading(卸货中) → completed(已完成)
 *        任意执行态可上报异常 → exception(异常)，异常关闭后可恢复运输
 * 所有页面操作统一调用本模块，避免状态逻辑散落在各页面
 */

const vehicleOf = (id) => db.vehicles.find((v) => v.id === id)
const driverOf = (id) => db.drivers.find((d) => d.id === id)
const planOf = (id) => db.plans.find((p) => p.id === id)
const contractOf = (id) => db.contracts.find((c) => c.id === id)

/** 执行中状态（占用车辆/司机） */
const ACTIVE = ['loading', 'intransit', 'unloading']

/** 登记磅单 */
function pushWeighing(d, type, net, time) {
  const v = vehicleOf(d.vehicleId)
  db.weighings.unshift({
    id: `BZ-${String(db.weighings.length + 1).padStart(5, '0')}`,
    dispatchId: d.id,
    plate: v ? v.plate : '-',
    terminalId: type === '进磅' ? d.loadTerminalId : d.unloadTerminalId,
    type,
    gross: +(13 + net).toFixed(2),
    tare: 13,
    net: +net.toFixed(2),
    time,
    operator: randomName()
  })
}

/** 占用车辆/司机（派车、发车、恢复时） */
export function occupyResource(d) {
  const v = vehicleOf(d.vehicleId)
  const dr = driverOf(d.driverId)
  if (v && v.status !== 'scrapped') v.status = 'inuse'
  if (dr) dr.status = 'onduty'
}

/** 释放车辆/司机（完成时；仍有其他执行中任务则不释放） */
export function releaseResource(d) {
  const v = vehicleOf(d.vehicleId)
  const dr = driverOf(d.driverId)
  if (v && !db.dispatches.some((x) => x.vehicleId === v.id && ACTIVE.includes(x.status))) v.status = 'idle'
  if (dr && !db.dispatches.some((x) => x.driverId === dr.id && ACTIVE.includes(x.status))) dr.status = 'available'
}

/** 回卷计划：进度=已完成车次运量/批次量；全部完成→completed，有执行/异常→intransit，未开始→dispatched */
export function rollupPlan(planId) {
  const p = planOf(planId)
  if (!p || p.status === 'cancelled') return
  const ds = db.dispatches.filter((x) => x.planId === planId)
  if (!ds.length) return
  const doneQty = ds.filter((x) => x.status === 'completed').reduce((s, x) => s + x.quantity, 0)
  p.progress = Math.min(100, Math.round((doneQty / p.quantity) * 100))
  const allDone = ds.every((x) => x.status === 'completed')
  const active = ds.some((x) => ACTIVE.includes(x.status) || x.status === 'exception')
  p.status = allDone ? 'completed' : active || doneQty > 0 ? 'intransit' : 'dispatched'
  rollupContract(p.contractId)
}

/** 回卷合同：进度=实际完成运量/合同计划量；量达成→completed */
export function rollupContract(contractId) {
  const c = contractOf(contractId)
  if (!c || c.status !== 'executing') return
  const doneQty = db.dispatches
    .filter((x) => x.contractId === contractId && x.status === 'completed')
    .reduce((s, x) => s + x.quantity, 0)
  c.progress = Math.min(100, Math.round((doneQty / c.quantity) * 100))
  if (c.progress >= 100) c.status = 'completed'
}

/** 确认装货：pending → loading，登记进磅单 */
export function confirmLoad(d) {
  d.status = 'loading'
  d.loadTime = dayjs().format('YYYY-MM-DD HH:mm')
  d.progress = 5
  pushWeighing(d, '进磅', d.quantity, d.loadTime)
  rollupPlan(d.planId)
}

/** 发车：loading → intransit，占用车辆司机 */
export function depart(d) {
  d.status = 'intransit'
  d.progress = 10
  d.speed = randInt(40, 68)
  const hours = round((d.distance || 300) / d.speed, 1)
  d.eta = dayjs().add(Math.round(hours * 60) + 30, 'minute').format('YYYY-MM-DD HH:mm')
  occupyResource(d)
  rollupPlan(d.planId)
}

/** 到达：intransit → unloading */
export function arrive(d) {
  d.status = 'unloading'
  d.progress = 96
  d.speed = 0
  d.eta = dayjs().add(randInt(30, 90), 'minute').format('YYYY-MM-DD HH:mm')
  rollupPlan(d.planId)
}

/** 确认卸货：unloading → completed，登记出磅单（含 1.5% 损耗），释放资源并回卷 */
export function confirmUnload(d) {
  d.status = 'completed'
  d.unloadTime = dayjs().format('YYYY-MM-DD HH:mm')
  d.progress = 100
  d.speed = 0
  const loss = +(d.quantity * 0.015).toFixed(2)
  pushWeighing(d, '出磅', d.quantity - loss, d.unloadTime)
  releaseResource(d)
  rollupPlan(d.planId)
}

/** 上报异常：→ exception，生成异常单 */
export function reportException(d, description) {
  d.status = 'exception'
  d.speed = 0
  db.exceptions.unshift({
    id: `YC-${String(db.exceptions.length + 1).padStart(4, '0')}`,
    dispatchId: d.id,
    type: 'other',
    level: 'medium',
    status: 'pending',
    occurTime: dayjs().format('YYYY-MM-DD HH:mm'),
    handler: '',
    description,
    result: '',
    cost: 0
  })
  rollupPlan(d.planId)
}

/** 恢复运输：exception → intransit(已装货) / loading(未装货) */
export function resumeDispatch(d) {
  if (d.loadTime) {
    d.status = 'intransit'
    d.progress = Math.max(10, Math.min(d.progress || 10, 90))
    d.speed = randInt(40, 68)
    d.eta = dayjs().add(4, 'hour').format('YYYY-MM-DD HH:mm')
  } else {
    d.status = 'loading'
    d.progress = 5
  }
  occupyResource(d)
  rollupPlan(d.planId)
}

/** 计划调度：生成 count 张调度单，数量按批次均摊，距离取实际线路 */
export function createDispatches(p, count, vehicleIds = []) {
  const road = db.vehicles.filter((v) => v.type !== '铁路敞车' && v.type !== '散货船')
  const pool = vehicleIds.length
    ? road.filter((v) => vehicleIds.includes(v.id))
    : road.filter((v) => v.status === 'idle')
  const avail = db.drivers.filter((x) => x.status === 'available')
  if (!pool.length || !avail.length) return { created: [], error: '无可用车辆或司机' }
  const route = ROUTES.find((r) => r.from === p.loadTerminalId && r.to === p.unloadTerminalId)
  const per = Math.max(1, Math.round(p.quantity / count))
  const created = []
  for (let i = 0; i < count; i++) {
    const v = pool[i % pool.length]
    const dr = avail[(db.dispatches.length + i) % avail.length]
    if (!v || !dr) break
    const d = {
      id: `PD-${String(db.dispatches.length + 1).padStart(5, '0')}`,
      planId: p.id,
      contractId: p.contractId,
      commodityId: p.commodityId,
      quantity: per,
      loadTerminalId: p.loadTerminalId,
      unloadTerminalId: p.unloadTerminalId,
      vehicleId: v.id,
      driverId: dr.id,
      distance: route ? route.distance : 300,
      status: 'pending',
      dispatchTime: dayjs().format('YYYY-MM-DD HH:mm'),
      loadTime: null,
      unloadTime: null,
      progress: 0,
      speed: 0,
      eta: dayjs().add(8, 'hour').format('YYYY-MM-DD HH:mm'),
      fee: Math.round(per * p.unitPrice)
    }
    db.dispatches.unshift(d)
    created.push(d)
  }
  p.status = 'dispatched'
  return { created }
}

/* ========== 结算流转 ========== */

/** 对账容差（吨）：结算量与磅单净重差值超过该值视为数据不一致 */
const RECONCILE_TOLERANCE = 0.5

/** 单车结算量：按磅结算，取出磅净重；无出磅单时回退调度量 */
function settleQtyOf(d) {
  const w = db.weighings.find((x) => x.dispatchId === d.id && x.type === '出磅')
  return w ? w.net : d.quantity
}

/** 结算费用计算：按出磅净重结算，损耗与已关闭异常损失作为扣减项 */
export function calcSettlementFees(contract, dispatches) {
  const unitPrice = contract ? contract.unitPrice : 0
  const dispatchQuantity = dispatches.reduce((s, d) => s + d.quantity, 0)
  const totalQuantity = +dispatches.reduce((s, d) => s + settleQtyOf(d), 0).toFixed(2)
  const lossQty = +(dispatchQuantity - totalQuantity).toFixed(2)
  const freight = Math.round(totalQuantity * unitPrice)
  const loadingFee = Math.round(totalQuantity * 8)
  const unloadingFee = Math.round(totalQuantity * 6)
  const lossDeduction = Math.round(lossQty * unitPrice)
  const exceptionLoss = dispatches.reduce(
    (sum, d) =>
      sum +
      db.exceptions
        .filter((e) => e.dispatchId === d.id && e.status === 'closed')
        .reduce((s, e) => s + (e.cost || 0), 0),
    0
  )
  return { dispatchQuantity, totalQuantity, lossQty, freight, loadingFee, unloadingFee, lossDeduction, exceptionLoss }
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
    return { ...g, dispatchCount: g.dispatches.length, quantity, freight: Math.round(quantity * (c ? c.unitPrice : 0)) }
  })
}

/** 生成结算单：将选中的候选聚合成账单（待对账），并标记车次已入账单 */
export function generateSettlements(keys) {
  const created = []
  for (const g of settlementCandidates().filter((x) => keys.includes(x.key))) {
    const c = contractOf(g.contractId)
    const sSeq = db.settlements.length + 1
    const fees = calcSettlementFees(c, g.dispatches)
    const tollFee = randInt(2000, 20000)
    const surcharge = randInt(0, 8000)
    const s = {
      id: `JS-${String(sSeq).padStart(4, '0')}`,
      billNo: `BL-${g.period.replace('-', '')}-${String(sSeq).padStart(3, '0')}`,
      contractId: g.contractId,
      customerId: c ? c.shipperId : '',
      period: g.period,
      dispatchCount: g.dispatchCount,
      ...fees,
      tollFee,
      surcharge,
      totalAmount: fees.freight + fees.loadingFee + fees.unloadingFee + tollFee + surcharge - fees.lossDeduction - fees.exceptionLoss,
      paidAmount: 0,
      status: 'pending',
      settleDate: null,
      invoiceStatus: 'not-issued',
      reconciliation: null,
      remark: ''
    }
    db.settlements.unshift(s)
    for (const d of g.dispatches) {
      d.settled = true
      d.settlementId = s.id
    }
    created.push(s)
  }
  return created
}

/** 对账三方比对：调度量 vs 磅单净重(进/出) vs 结算量；差异=结算量-出磅净重(一致性)，损耗=调度量-结算量 */
export function buildReconciliation(s, date) {
  const c = contractOf(s.contractId)
  const price = c ? c.unitPrice : 0
  const items = db.dispatches
    .filter((d) => d.settlementId === s.id)
    .map((d) => {
      const ws = db.weighings.filter((w) => w.dispatchId === d.id)
      const inNet = ws.find((w) => w.type === '进磅')?.net ?? null
      const outNet = ws.find((w) => w.type === '出磅')?.net ?? null
      const settleQty = settleQtyOf(d)
      const ref = outNet != null ? outNet : inNet
      const diff = ref != null ? +(settleQty - ref).toFixed(2) : 0
      return {
        dispatchId: d.id,
        plate: vehicleOf(d.vehicleId)?.plate || '-',
        dispatchQty: d.quantity,
        inNet,
        outNet,
        settleQty,
        loss: +(d.quantity - settleQty).toFixed(2),
        diff,
        status: Math.abs(diff) > RECONCILE_TOLERANCE ? 'diff' : 'match'
      }
    })
  const diffItems = items.filter((i) => i.status === 'diff')
  const diffQty = +diffItems.reduce((sum, i) => sum + i.diff, 0).toFixed(2)
  const lossQty = +items.reduce((sum, i) => sum + i.loss, 0).toFixed(2)
  s.reconciliation = {
    date: date || dayjs().format('YYYY-MM-DD HH:mm'),
    items,
    diffCount: diffItems.length,
    diffQty,
    diffAmount: Math.round(Math.abs(diffQty) * price),
    lossQty,
    lossAmount: Math.round(lossQty * price)
  }
  return s.reconciliation
}

/** 发起对账：执行三方比对并进入"对账中" */
export function startReconcile(s) {
  buildReconciliation(s)
  s.status = 'reconciling'
  return s.reconciliation
}

/** 逾期规则：已结算且超账期未付清 → 逾期；逾期账单付清 → 回到已结算 */
export function recalcSettlementStatus(s) {
  if (s.status !== 'settled' && s.status !== 'overdue') return
  const c = contractOf(s.contractId)
  const due = s.settleDate ? dayjs(s.settleDate).add(c ? c.paymentDays || 30 : 30, 'day') : null
  const unpaid = s.totalAmount - s.paidAmount > 0
  s.status = due && unpaid && dayjs().isAfter(due) ? 'overdue' : 'settled'
}

/** 确认结算：对账中 → 已结算，进入收款（账期由合同约定） */
export function confirmSettle(s) {
  s.status = 'settled'
  s.settleDate = dayjs().format('YYYY-MM-DD')
  s.paidAmount = 0
}

/** 登记收款：写入收款流水并更新已付金额，超收按未付余额截断 */
export function recordPayment(s, amount, method) {
  const real = Math.min(amount, s.totalAmount - s.paidAmount)
  db.payments.unshift({
    id: `SK-${String(db.payments.length + 1).padStart(4, '0')}`,
    settlementId: s.id,
    amount: real,
    payTime: dayjs().format('YYYY-MM-DD HH:mm'),
    method,
    remark: real >= s.totalAmount - s.paidAmount ? '付清' : '部分收款'
  })
  s.paidAmount += real
  recalcSettlementStatus(s)
  return real
}

/** 客户未付余额（全部账单未付部分之和） */
export function outstandingOf(customerId) {
  return db.settlements
    .filter((s) => s.customerId === customerId)
    .reduce((sum, s) => sum + Math.max(0, s.totalAmount - s.paidAmount), 0)
}

/** 信用校验：未付余额 + 新订单金额 vs 客户授信额度 */
export function creditCheck(customerId, orderAmount) {
  const c = db.customers.find((x) => x.id === customerId)
  if (!c) return { ok: true, message: '' }
  const outstanding = outstandingOf(customerId)
  const total = outstanding + orderAmount
  if (total > c.creditLimit) {
    return {
      ok: false,
      message: `${c.name} 未付余额 ${formatMoney(outstanding)} + 本单 ${formatMoney(orderAmount)} = ${formatMoney(total)}，超出授信额度 ${formatMoney(c.creditLimit)}`
    }
  }
  return { ok: true, message: '' }
}

/** 启动时全量校准：计划/合同进度与调度实际执行对齐 */
export function recalcAll() {
  for (const p of db.plans) {
    if (p.status === 'cancelled') continue
    const ds = db.dispatches.filter((x) => x.planId === p.id)
    if (!ds.length) {
      p.progress = 0
      continue
    }
    const doneQty = ds.filter((x) => x.status === 'completed').reduce((s, x) => s + x.quantity, 0)
    p.progress = Math.min(100, Math.round((doneQty / p.quantity) * 100))
    const allDone = ds.every((x) => x.status === 'completed')
    const active = ds.some((x) => ACTIVE.includes(x.status) || x.status === 'exception')
    if (allDone) p.status = 'completed'
    else if (active || doneQty > 0) p.status = 'intransit'
    else p.status = 'dispatched'
  }
  for (const c of db.contracts) {
    if (c.status !== 'executing') continue
    const doneQty = db.dispatches
      .filter((x) => x.contractId === c.id && x.status === 'completed')
      .reduce((s, x) => s + x.quantity, 0)
    c.progress = Math.min(100, Math.round((doneQty / c.quantity) * 100))
    if (c.progress >= 100) c.status = 'completed'
  }
  for (const s of db.settlements) recalcSettlementStatus(s)
}

recalcAll()
