import { db, randInt, randomName, ROUTES, MAP_NODES, NOW, tareOf } from './base'
import dayjs from 'dayjs'
import { round, formatMoney } from '@/utils'

export { tareOf }

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

/** 公路口径运输方式（派车+磅单）；铁路/水运/管道按运输单元执行，不占车辆司机、无公路磅单 */
export const ROAD_MODES = ['公路', '多式联运']
export const isRoadMode = (mode) => ROAD_MODES.includes(mode || '公路')

/** 运输单元编号（铁路车号/船舶名/管段），按 方式+调度单号 确定性派生 */
export function unitNoOf(mode, seedStr) {
  let n = 0
  for (const ch of String(seedStr)) n = (n * 31 + ch.charCodeAt(0)) % 100000
  if (mode === '铁路') return `X${1000 + (n % 9000)}次`
  if (mode === '水运') return `冀散货${100 + (n % 899)}`
  if (mode === '管道') return `管线${['一', '二', '三', '四'][n % 4]}线`
  return `联运${2026000 + (n % 999)}`
}

/** 发票号码：按种子串确定性派生 16 位（与全局种子随机体系一致，不用 Math.random） */
export function genInvoiceNo(seedStr) {
  let n = 0
  for (const ch of String(seedStr)) n = (n * 31 + ch.charCodeAt(0)) % 2147483647
  return '2410' + String(100000000000 + (n % 900000000000))
}

/* ========== 审计日志 ========== */

/** 当前操作人（登录时写入，审计日志使用） */
let operator = { name: '张建国', username: 'admin' }
export function setOperator(user) {
  if (user && user.username) operator = { name: user.name || user.username, username: user.username }
}

/** 写审计日志（状态变更动作实时落日志） */
export function logAction(module, action, detail, result = 'success') {
  db.logs.unshift({
    id: `LOG-${String(db.logs.length + 1).padStart(5, '0')}`,
    time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    user: operator.name,
    username: operator.username,
    action,
    module,
    detail: detail || '',
    ip: '192.168.1.100',
    result
  })
}

/* ========== 消息中心（G6：flow 事件驱动，顶栏未读角标 + 消息中心页） ========== */

/** 发送平台消息（关键业务事件调用；type: approval/dispatch/exception/settlement/request/system） */
export function notify(title, type, path, content = '') {
  db.messages.unshift({
    id: `MSG-${String(db.messages.length + 1).padStart(4, '0')}`,
    title,
    content,
    type,
    path,
    time: dayjs().format('YYYY-MM-DD HH:mm'),
    read: false
  })
  return db.messages[0]
}

/** 标记消息已读 */
export function markMessageRead(m) {
  if (m && !m.read) m.read = true
  return { ok: true }
}

/** 全部标记已读，返回本次标记条数 */
export function markAllMessagesRead() {
  let n = 0
  for (const m of db.messages) {
    if (!m.read) {
      m.read = true
      n += 1
    }
  }
  return n
}

/** 登记磅单 */
function pushWeighing(d, type, net, time) {
  const v = vehicleOf(d.vehicleId)
  const tare = tareOf(v)
  db.weighings.unshift({
    id: `BZ-${String(db.weighings.length + 1).padStart(5, '0')}`,
    dispatchId: d.id,
    plate: v ? v.plate : '-',
    terminalId: type === '进磅' ? d.loadTerminalId : d.unloadTerminalId,
    type,
    gross: +(tare + net).toFixed(2),
    tare,
    net: +net.toFixed(2),
    time,
    operator: randomName()
  })
}

/** 磅单补录：场站操作员对尚无该类型磅单的车次手工录单（仅公路口径车次） */
export function manualWeighing(dispatchId, type, net) {
  const d = db.dispatches.find((x) => x.id === dispatchId)
  if (!d) return { error: '调度单不存在' }
  if (!isRoadMode(d.mode)) return { error: `${d.mode} 车次按运输单元执行，无公路磅单，无需补录` }
  if (db.weighings.some((w) => w.dispatchId === dispatchId && w.type === type)) {
    return { error: `该调度单已存在${type}磅单，不能重复补录` }
  }
  pushWeighing(d, type, net, dayjs().format('YYYY-MM-DD HH:mm'))
  logAction('磅单记录', '磅单补录', `调度单 ${d.id} 补录${type}磅单，净重 ${net} 吨`)
  return { ok: true }
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

/** 仓储联动：确认装货 → 装货场站（有仓库时）出库，扣减最早批次与仓库占用 */
function warehouseOut(d) {
  const t = db.terminals.find((x) => x.id === d.loadTerminalId)
  const wh = t && t.warehouseId ? db.warehouses.find((w) => w.id === t.warehouseId) : null
  if (!wh || wh.status !== 'operating') return
  const batch = db.inventories
    .filter((i) => i.warehouseId === wh.id && i.commodityId === d.commodityId && i.status === 'normal' && i.quantity > 0)
    .sort((a, b) => (a.inDate < b.inDate ? -1 : 1))[0]
  if (batch) batch.quantity = Math.max(0, batch.quantity - d.quantity)
  wh.used = Math.max(0, wh.used - d.quantity)
  logAction('仓储管理', '出库', `调度单 ${d.id} 装货：${wh.name} 出库 ${d.quantity} 吨`)
}

/** 仓储联动：确认卸货 → 卸货场站（有仓库时）入库，按出磅净重生成新批次 */
function warehouseIn(d) {
  const t = db.terminals.find((x) => x.id === d.unloadTerminalId)
  const wh = t && t.warehouseId ? db.warehouses.find((w) => w.id === t.warehouseId) : null
  if (!wh || wh.status !== 'operating') return
  const w = db.weighings.find((x) => x.dispatchId === d.id && x.type === '出磅')
  const qty = w ? w.net : d.quantity
  db.inventories.unshift({
    id: `INV-${String(db.inventories.length + 1).padStart(4, '0')}`,
    warehouseId: wh.id,
    commodityId: d.commodityId,
    batch: `B${dayjs().format('YYMMDD')}-${d.id.slice(-3)}`,
    quantity: qty,
    inDate: dayjs().format('YYYY-MM-DD'),
    status: 'normal'
  })
  wh.used = Math.min(wh.capacity, wh.used + qty)
  logAction('仓储管理', '入库', `调度单 ${d.id} 卸货：${wh.name} 入库 ${qty} 吨`)
}

/** 确认装货：pending → loading，公路车次登记进磅单，装货场站出库
 *  前置守卫：须处于"待装货"态；公路车次须司机已接单（与司机端规则一致） */
export function confirmLoad(d) {
  if (d.status !== 'pending') return { error: `调度单 ${d.id} 当前非"待装货"状态，无法确认装货` }
  if (isRoadMode(d.mode) && d.driverId && !d.accepted) return { error: `司机尚未接单，请先由司机接单后再确认装货` }
  d.status = 'loading'
  d.loadTime = dayjs().format('YYYY-MM-DD HH:mm')
  d.progress = 5
  if (isRoadMode(d.mode)) pushWeighing(d, '进磅', d.quantity, d.loadTime)
  warehouseOut(d)
  rollupPlan(d.planId)
  logAction(
    '场站管理',
    '确认装货',
    isRoadMode(d.mode)
      ? `调度单 ${d.id} 确认装货（进磅 ${d.quantity} 吨）`
      : `调度单 ${d.id} 确认装货（${d.mode} ${d.unitNo || ''}，${d.quantity} 吨）`
  )
}

/** 发车：loading → intransit，占用车辆司机 */
export function depart(d) {
  if (d.status !== 'loading') return { error: `调度单 ${d.id} 当前非"装货中"状态，无法发车` }
  d.status = 'intransit'
  d.progress = 10
  d.speed = randInt(40, 68)
  const hours = round((d.distance || 300) / d.speed, 1)
  d.eta = dayjs().add(Math.round(hours * 60) + 30, 'minute').format('YYYY-MM-DD HH:mm')
  occupyResource(d)
  rollupPlan(d.planId)
  logAction('调度管理', '车辆发车', `调度单 ${d.id} 发车，预计 ${d.eta} 到达`)
}

/** 到达：intransit → unloading */
export function arrive(d) {
  if (d.status !== 'intransit') return { error: `调度单 ${d.id} 当前非"在途"状态，无法确认到达` }
  d.status = 'unloading'
  d.progress = 96
  d.speed = 0
  d.eta = dayjs().add(randInt(30, 90), 'minute').format('YYYY-MM-DD HH:mm')
  rollupPlan(d.planId)
  logAction('调度管理', '到达卸货场', `调度单 ${d.id} 到达，开始卸货`)
}

/** 确认卸货：unloading → completed，公路车次登记出磅单（含 1.5% 损耗），卸货场站入库，释放资源并回卷 */
export function confirmUnload(d) {
  if (d.status !== 'unloading') return { error: `调度单 ${d.id} 当前非"卸货中"状态，无法确认卸货` }
  d.status = 'completed'
  d.unloadTime = dayjs().format('YYYY-MM-DD HH:mm')
  d.progress = 100
  d.speed = 0
  let loss = 0
  if (isRoadMode(d.mode)) {
    loss = +(d.quantity * 0.015).toFixed(2)
    pushWeighing(d, '出磅', d.quantity - loss, d.unloadTime)
  }
  warehouseIn(d)
  releaseResource(d)
  rollupPlan(d.planId)
  logAction(
    '场站管理',
    '确认卸货',
    isRoadMode(d.mode)
      ? `调度单 ${d.id} 确认卸货（出磅 ${(d.quantity - loss).toFixed(2)} 吨，损耗 ${loss} 吨）`
      : `调度单 ${d.id} 确认卸货（${d.mode} ${d.unitNo || ''}，${d.quantity} 吨，无磅单损耗）`
  )
}

/** 上报异常：→ exception，生成异常单；事故类同步生成事故记录 */
export function reportException(d, description, type = 'other', level = 'medium') {
  if (!['pending', 'loading', 'intransit', 'unloading'].includes(d.status)) {
    return { error: `调度单 ${d.id} 当前非执行中状态，无法上报异常` }
  }
  d.status = 'exception'
  d.speed = 0
  const e = {
    id: `YC-${String(db.exceptions.length + 1).padStart(4, '0')}`,
    dispatchId: d.id,
    type,
    level,
    status: 'pending',
    occurTime: dayjs().format('YYYY-MM-DD HH:mm'),
    handler: '',
    description,
    result: '',
    cost: 0
  }
  db.exceptions.unshift(e)
  if (type === 'accident') {
    const v = vehicleOf(d.vehicleId)
    const a = {
      id: `SG-${String(db.accidents.length + 1).padStart(3, '0')}`,
      time: dayjs().format('YYYY-MM-DD'),
      type: '碰撞',
      level: level === 'high' ? '重大' : level === 'medium' ? '较大' : '一般',
      vehicleId: d.vehicleId,
      plate: v ? v.plate : '-',
      location: `调度单 ${d.id} 在途`,
      description,
      handling: '处置中',
      loss: 0,
      status: 'handling',
      exceptionId: e.id
    }
    db.accidents.unshift(a)
    e.accidentId = a.id
  }
  rollupPlan(d.planId)
  logAction('异常处理', '上报异常', `调度单 ${d.id} 上报异常（${type}），生成异常单 ${e.id}${type === 'accident' ? ' 及事故记录 ' + e.accidentId : ''}`)
  notify(`调度单 ${d.id} 上报异常`, 'exception', '/exception', description)
  return e
}

/** 恢复运输：exception → intransit(已装货) / loading(未装货) */
export function resumeDispatch(d) {
  if (d.status !== 'exception') return { error: `调度单 ${d.id} 当前非"异常"状态，无法恢复运输` }
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
  logAction('异常处理', '恢复运输', `调度单 ${d.id} 恢复运输（${d.status === 'intransit' ? '在途' : '装货'}）`)
}

/* ===== 异常处置（受理/处置/关闭） ===== */

/** 受理异常：pending → handling，指派处理人 */
export function acceptException(e, handler) {
  e.handler = handler
  e.status = 'handling'
  logAction('异常处理', '受理异常', `异常单 ${e.id} 受理，处理人 ${handler}`)
}

/** 处置完成：填写处置结果与损失金额 */
export function finishException(e, result, cost) {
  e.result = result
  e.cost = cost || 0
  if (e.accidentId) {
    const a = db.accidents.find((x) => x.id === e.accidentId)
    if (a) {
      a.handling = result
      a.loss = cost || 0
    }
  }
  logAction('异常处理', '处置完成', `异常单 ${e.id} 处置完成，损失 ${cost || 0} 元`)
}

/** 关闭归档：closed；事故类同步结案并更新车辆状态
 *  结算联动：车次已入账单且损失未计入 → 补扣损失（结算调整），避免"结算后异常才关闭"损失漏扣 */
export function closeException(e) {
  e.status = 'closed'
  if (!e.handler) e.handler = '系统'
  if (!e.result) e.result = '已处理完毕'
  if (e.accidentId) {
    const a = db.accidents.find((x) => x.id === e.accidentId)
    if (a) {
      a.status = 'closed'
      a.handling = a.handling || '已结案'
      const v = vehicleOf(a.vehicleId)
      if (v && v.status === 'idle') v.status = 'maintenance'
    }
  }
  if (e.cost > 0 && e.dispatchId && !e.settleApplied) {
    const d = db.dispatches.find((x) => x.id === e.dispatchId)
    const s = d && d.settlementId ? db.settlements.find((x) => x.id === d.settlementId) : null
    if (s) {
      s.exceptionLoss = (s.exceptionLoss || 0) + e.cost
      s.totalAmount -= e.cost
      s.adjustments = s.adjustments || []
      s.adjustments.push({
        time: dayjs().format('YYYY-MM-DD HH:mm'),
        reason: `异常单 ${e.id} 关闭，损失补扣${s.invoiceStatus === 'issued' ? '（已开票，需红冲重开）' : ''}`,
        amount: -e.cost
      })
      e.settleApplied = s.id
      logAction(
        '结算管理',
        '结算调整',
        `账单 ${s.billNo} 因异常单 ${e.id} 关闭补扣损失 ${formatMoney(e.cost)}，结算金额调整为 ${formatMoney(s.totalAmount)}`
      )
    }
  }
  logAction('异常处理', '关闭异常单', `异常单 ${e.id} 关闭归档${e.accidentId ? `，事故 ${e.accidentId} 结案` : ''}`)
  notify(`异常单 ${e.id} 已关闭`, 'exception', '/exception', e.result)
}

/* ===== 安全管理（事故登记 / 培训计划 / 车辆检查） ===== */

/** 事故登记：手工登记事故记录（不一定关联车次异常单，如场外/历史事故补录） */
export function registerAccident(payload) {
  const v = payload.vehicleId ? vehicleOf(payload.vehicleId) : null
  const a = {
    id: `SG-${String(db.accidents.length + 1).padStart(3, '0')}`,
    time: payload.time,
    type: payload.type,
    level: payload.level,
    vehicleId: v ? v.id : '',
    plate: v ? v.plate : payload.plate || '-',
    location: payload.location || '',
    description: payload.description || '',
    handling: payload.handling || '',
    loss: payload.loss || 0,
    status: payload.status || 'handling'
  }
  db.accidents.unshift(a)
  logAction('安全管理', '事故登记', `事故 ${a.id} 登记（${a.level}·${a.type}，车辆 ${a.plate}，损失 ${formatMoney(a.loss)}）`)
  return a
}

/** 事故结案：handling → closed（独立入口，不依赖异常单关闭） */
export function closeAccident(a) {
  if (a.status !== 'handling') return { error: `事故 ${a.id} 当前非"处理中"状态，无法结案` }
  a.status = 'closed'
  a.handling = a.handling || '已结案'
  logAction('安全管理', '事故结案', `事故 ${a.id} 结案`)
  return { ok: true }
}

/** 培训计划：新建培训（计划中，参训司机待标记完成时记录） */
export function addTraining(payload) {
  if (!payload.title || !payload.title.trim()) return { error: '请填写培训主题' }
  if (!payload.date) return { error: '请选择培训日期' }
  if (dayjs(payload.date).isBefore(dayjs(), 'day')) return { error: '培训日期不能早于今天' }
  const t = {
    id: `PX-${String(db.trainings.length + 1).padStart(3, '0')}`,
    title: payload.title.trim(),
    date: payload.date,
    trainer: payload.trainer || '',
    participants: 0,
    driverIds: [],
    status: 'scheduled'
  }
  db.trainings.unshift(t)
  logAction('安全管理', '培训计划', `培训 ${t.id} 计划：${t.title}（${t.date}）`)
  return t
}

/** 培训完成：计划中 → 已完成，记录实际参训司机（覆盖率口径按 driverIds 计算） */
export function completeTraining(t, driverIds) {
  if (t.status !== 'scheduled') return { error: `培训 ${t.id} 当前非"计划中"状态，无法标记完成` }
  if (dayjs(t.date).isAfter(dayjs(), 'day')) return { error: `培训 ${t.id} 日期（${t.date}）未到，无法标记完成` }
  t.status = 'completed'
  t.driverIds = driverIds || []
  t.participants = t.driverIds.length
  logAction('安全管理', '培训完成', `培训 ${t.id} 完成，${t.participants} 名司机参训`)
  return { ok: true }
}

/** 车辆检查登记 */
export function addInspection(payload) {
  const v = payload.vehicleId ? vehicleOf(payload.vehicleId) : null
  if (!v) return { error: '请选择被检车辆' }
  const i = {
    id: `JC-${String(db.inspections.length + 1).padStart(3, '0')}`,
    vehicleId: v.id,
    plate: v.plate,
    date: payload.date,
    item: payload.item || '',
    result: payload.result === 'fail' ? 'fail' : 'pass',
    inspector: payload.inspector || '',
    remark: payload.remark || ''
  }
  db.inspections.unshift(i)
  logAction('安全管理', '检查登记', `车辆 ${v.plate} 检查（${i.item}）：${i.result === 'pass' ? '合格' : '不合格'}`)
  return i
}

/** 车辆年检过期（nextInspection 早于今天） */
export function vehicleInspectionExpired(v) {
  return !!v && !!v.nextInspection && dayjs(v.nextInspection).isBefore(dayjs(), 'day')
}

/** 驾照过期（licenseExpire 早于今天） */
export function driverLicenseExpired(d) {
  return !!d && !!d.licenseExpire && dayjs(d.licenseExpire).isBefore(dayjs(), 'day')
}

/** 计划调度：生成 count 张调度单，数量按批次均摊，距离取实际线路
 *  公路/多式联运 → 匹配车辆+司机；铁路/水运/管道 → 按运输单元派车（车号/船名/管段），不占车辆司机
 *  守卫：合同已终止不可再派车；车辆/司机排除已有未完结车次（待装货/装货中/异常）者，防重复占用；
 *  年检/驾照过期拦截：自动匹配排除年检过期车辆与驾照过期司机，手动指定年检过期车辆直接报错 */
export function createDispatches(p, count, vehicleIds = []) {
  const c = contractOf(p.contractId)
  if (c && c.status === 'terminated') return { created: [], error: '合同已终止，不能再下发调度单' }
  const route = ROUTES.find((r) => r.from === p.loadTerminalId && r.to === p.unloadTerminalId)
  const per = Math.max(1, Math.round(p.quantity / count))
  const road = isRoadMode(p.mode)
  const created = []
  if (road) {
    const BUSY = ['pending', 'loading', 'exception']
    const busyV = new Set(db.dispatches.filter((x) => BUSY.includes(x.status)).map((x) => x.vehicleId))
    const busyD = new Set(db.dispatches.filter((x) => BUSY.includes(x.status)).map((x) => x.driverId))
    // 手动指定：年检过期车辆硬拦截（明确报错，避免静默少派车）
    if (vehicleIds.length) {
      const expiredSel = db.vehicles.filter((v) => vehicleIds.includes(v.id) && vehicleInspectionExpired(v))
      if (expiredSel.length) {
        return { created, error: `年检过期车辆不可派车：${expiredSel.map((v) => v.plate).join('、')}` }
      }
    }
    const pool = vehicleIds.length
      ? db.vehicles.filter((v) => v.type !== '铁路敞车' && v.type !== '散货船' && vehicleIds.includes(v.id) && !busyV.has(v.id))
      : db.vehicles.filter((v) => v.type !== '铁路敞车' && v.type !== '散货船' && v.status === 'idle' && !vehicleInspectionExpired(v) && !busyV.has(v.id))
    const avail = db.drivers.filter((x) => x.status === 'available' && !driverLicenseExpired(x) && !busyD.has(x.id))
    if (!pool.length || !avail.length) {
      const reasons = []
      if (!pool.length) reasons.push('无可用车辆（须空闲、年检未过期且无未完结车次）')
      if (!avail.length) reasons.push('无可用司机（须空闲、驾照未过期且无未完结车次）')
      return { created, error: reasons.join('；') }
    }
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
        mode: p.mode,
        loadTerminalId: p.loadTerminalId,
        unloadTerminalId: p.unloadTerminalId,
        vehicleId: v.id,
        driverId: dr.id,
        unitNo: p.mode === '多式联运' ? unitNoOf('多式联运', `PD-${db.dispatches.length + 1}`) : '',
        distance: route ? route.distance : 300,
        status: 'pending',
        accepted: false,
        dispatchTime: dayjs().format('YYYY-MM-DD HH:mm'),
        loadTime: null,
        unloadTime: null,
        progress: 0,
        speed: 0,
        eta: dayjs().add(8, 'hour').format('YYYY-MM-DD HH:mm'),
        fee: Math.round(per * p.unitPrice),
        unitPrice: p.unitPrice
      }
      db.dispatches.unshift(d)
      created.push(d)
    }
  } else {
    for (let i = 0; i < count; i++) {
      const id = `PD-${String(db.dispatches.length + 1).padStart(5, '0')}`
      const d = {
        id,
        planId: p.id,
        contractId: p.contractId,
        commodityId: p.commodityId,
        quantity: per,
        mode: p.mode,
        loadTerminalId: p.loadTerminalId,
        unloadTerminalId: p.unloadTerminalId,
        vehicleId: null,
        driverId: null,
        unitNo: unitNoOf(p.mode, id),
        distance: route ? route.distance : 300,
        status: 'pending',
        accepted: false,
        dispatchTime: dayjs().format('YYYY-MM-DD HH:mm'),
        loadTime: null,
        unloadTime: null,
        progress: 0,
        speed: 0,
        eta: dayjs().add(8, 'hour').format('YYYY-MM-DD HH:mm'),
        fee: Math.round(per * p.unitPrice),
        unitPrice: p.unitPrice
      }
      db.dispatches.unshift(d)
      created.push(d)
    }
  }
  p.status = 'dispatched'
  logAction(
    '调度管理',
    '下发调度单',
    `计划 ${p.id} 生成 ${created.length} 张调度单（${p.mode}${road ? '' : '，按运输单元执行' }）`
  )
  if (created.length) notify(`计划 ${p.id} 下发 ${created.length} 张调度单`, 'dispatch', '/dispatch')
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

/** 结算费用计算：按出磅净重结算，损耗与已关闭异常损失作为扣减项
 *  单价口径：按车次派车时快照单价（d.unitPrice）逐车次计算，合同改价不追溯已派车车次；
 *  无快照价（历史数据）回退合同当前单价 */
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
      // 已关闭异常损失已在账单中计入，标记防止 closeException 重复补扣
      for (const e of db.exceptions.filter((x) => x.dispatchId === d.id && x.status === 'closed')) e.settleApplied = s.id
    }
    created.push(s)
  }
  if (created.length) {
    logAction('结算管理', '生成结算单', `生成 ${created.length} 张结算单（${created.map((s) => s.billNo).join('、')}）`)
    notify(`生成 ${created.length} 张结算单`, 'settlement', '/settlement', created.map((s) => s.billNo).join('、'))
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
        plate: vehicleOf(d.vehicleId)?.plate || d.unitNo || '-',
        dispatchQty: d.quantity,
        inNet,
        outNet,
        settleQty,
        loss: +(d.quantity - settleQty).toFixed(2),
        diff,
        // 签收状态：公路车次须有电子签收单（收货凭证）；非公路按运输单元执行，无签收（null=不适用）
        hasReceipt: isRoadMode(d.mode) ? !!d.receipt : null,
        status: Math.abs(diff) > RECONCILE_TOLERANCE ? 'diff' : 'match'
      }
    })
  const diffItems = items.filter((i) => i.status === 'diff')
  const diffQty = +diffItems.reduce((sum, i) => sum + i.diff, 0).toFixed(2)
  const lossQty = +items.reduce((sum, i) => sum + i.loss, 0).toFixed(2)
  const missingReceipt = items.filter((i) => i.hasReceipt === false)
  s.reconciliation = {
    date: date || dayjs().format('YYYY-MM-DD HH:mm'),
    items,
    diffCount: diffItems.length,
    diffQty,
    diffAmount: Math.round(Math.abs(diffQty) * price),
    lossQty,
    lossAmount: Math.round(lossQty * price),
    missingReceiptCount: missingReceipt.length,
    missingReceiptIds: missingReceipt.map((i) => i.dispatchId)
  }
  return s.reconciliation
}

/** 发起对账：执行三方比对并进入"对账中" */
export function startReconcile(s) {
  buildReconciliation(s)
  s.status = 'reconciling'
  logAction('结算管理', '发起对账', `账单 ${s.billNo} 三方比对完成，${s.reconciliation.diffCount} 车次不一致，损耗 ${s.reconciliation.lossQty} 吨`)
  return s.reconciliation
}

/** 重算结算单（仅"待对账"账单）：按当前磅单与已关闭异常重算费用，差异记入调整记录
 *  适用场景：生成账单后磅单补录/异常损失变化，对账前刷新金额 */
export function recalcSettlement(s) {
  if (s.status !== 'pending') return { error: `账单 ${s.billNo} 当前非"待对账"状态，无法重算` }
  const c = contractOf(s.contractId)
  const ds = db.dispatches.filter((d) => d.settlementId === s.id)
  if (!ds.length) return { error: `账单 ${s.billNo} 下无车次，无法重算` }
  const fees = calcSettlementFees(c, ds)
  const oldTotal = s.totalAmount
  Object.assign(s, fees)
  s.totalAmount =
    fees.freight + fees.loadingFee + fees.unloadingFee + (s.tollFee || 0) + (s.surcharge || 0) - fees.lossDeduction - fees.exceptionLoss
  const delta = s.totalAmount - oldTotal
  if (delta !== 0) {
    s.adjustments = s.adjustments || []
    s.adjustments.push({ time: dayjs().format('YYYY-MM-DD HH:mm'), reason: '重算结算（磅单/异常口径刷新）', amount: delta })
    logAction(
      '结算管理',
      '重算结算',
      `账单 ${s.billNo} 重算：结算金额 ${formatMoney(oldTotal)} → ${formatMoney(s.totalAmount)}（${delta > 0 ? '+' : ''}${formatMoney(delta)}）`
    )
  }
  return { ok: true, delta }
}

/** 逾期规则：已结算且超账期未付清 → 逾期；逾期账单付清 → 回到已结算 */
export function recalcSettlementStatus(s) {
  if (s.status !== 'settled' && s.status !== 'overdue') return
  const c = contractOf(s.contractId)
  const due = s.settleDate ? dayjs(s.settleDate).add(c ? c.paymentDays || 30 : 30, 'day') : null
  const unpaid = s.totalAmount - s.paidAmount > 0
  s.status = due && unpaid && dayjs().isAfter(due) ? 'overdue' : 'settled'
}

/** 确认结算：对账中 → 已结算，进入收款（账期由合同约定）
 *  保留预付款：不清零已累积的 paidAmount（对账前已收预付），与收款流水保持一致
 *  客户确认闸门：须客户已在门户确认对账结果（customerConfirmed），未确认不可结算 */
export function confirmSettle(s) {
  if (s.status !== 'reconciling') return { error: `账单 ${s.billNo} 当前非"对账中"状态，无法确认结算` }
  if (!s.customerConfirmed) {
    return { error: `客户尚未确认账单 ${s.billNo} 的对账结果，请先由客户在客户门户确认对账后再确认结算` }
  }
  s.status = 'settled'
  s.settleDate = dayjs().format('YYYY-MM-DD')
  logAction('结算管理', '确认结算', `账单 ${s.billNo} 结算金额 ${formatMoney(s.totalAmount)}，累计已付 ${formatMoney(s.paidAmount)}`)
  notify(`账单 ${s.billNo} 已确认结算`, 'settlement', '/settlement', `结算金额 ${formatMoney(s.totalAmount)}，进入收款`)
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
  logAction('结算管理', '登记收款', `账单 ${s.billNo} 收款 ${formatMoney(real)}（${method}）`)
  notify(`账单 ${s.billNo} 收款到账`, 'settlement', '/settlement', `${method} ${formatMoney(real)}`)
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

/** 合同剩余可计划量：合同总量 - 未取消计划批次量之和（新建计划校验用） */
export function contractRemaining(contractId) {
  const c = contractOf(contractId)
  if (!c) return 0
  const planned = db.plans
    .filter((p) => p.contractId === contractId && p.status !== 'cancelled')
    .reduce((s, p) => s + p.quantity, 0)
  return Math.max(0, c.quantity - planned)
}

/** 客户确认对账：客户门户确认账单对账结果（须已有对账结果且未确认过）
 *  不改账单状态（结算确认仍由结算专员执行），结果记 customerConfirmed 并审计 */
export function customerConfirm(s) {
  if (!s.reconciliation) return { error: `账单 ${s.billNo} 尚无对账结果，无法确认` }
  if (s.customerConfirmed) return { error: `账单 ${s.billNo} 客户已确认过，无需重复确认` }
  s.customerConfirmed = { time: dayjs().format('YYYY-MM-DD HH:mm'), comment: '对账结果确认，无异议' }
  logAction('客户门户', '确认对账', `客户确认账单 ${s.billNo} 对账结果（差异 ${s.reconciliation.diffCount} 车次，损耗 ${s.reconciliation.lossQty} 吨）`)
  notify(`客户已确认对账结果`, 'settlement', '/settlement', `账单 ${s.billNo} 客户已确认，可确认结算`)
  return { ok: true }
}

/* ===== 客户运输需求（门户发起 → 合同草稿） ===== */

/** 客户发起运输需求（门户）：生成待处理需求单，由销售在合同管理转为合同草稿 */
export function submitTransportRequest(customerId, payload) {
  const c = db.customers.find((x) => x.id === customerId)
  if (!c) return { error: '当前账号未绑定客户，无法发起运输需求' }
  if (c.status === 'frozen') return { error: `客户 ${c.name} 已冻结，无法发起运输需求` }
  if (!payload.commodityId || !payload.loadTerminalId || !payload.unloadTerminalId || !payload.consigneeId) {
    return { error: '请完整填写商品、装/卸货场站与收货方' }
  }
  if (!payload.quantity || payload.quantity <= 0) return { error: '计划数量须大于 0' }
  const r = {
    id: `YS-${String(db.transportRequests.length + 1).padStart(4, '0')}`,
    customerId: c.id,
    consigneeId: payload.consigneeId,
    commodityId: payload.commodityId,
    quantity: payload.quantity,
    loadTerminalId: payload.loadTerminalId,
    unloadTerminalId: payload.unloadTerminalId,
    mode: payload.mode || '公路',
    expectDate: payload.expectDate || dayjs().add(14, 'day').format('YYYY-MM-DD'),
    unitPrice: payload.unitPrice || 0,
    remark: payload.remark || '',
    status: 'pending',
    createTime: dayjs().format('YYYY-MM-DD HH:mm'),
    contractId: null,
    rejectReason: ''
  }
  db.transportRequests.unshift(r)
  logAction(
    '客户门户',
    '发起运输需求',
    `客户 ${c.name} 发起运输需求 ${r.id}（${db.commodities.find((x) => x.id === r.commodityId)?.name || ''} ${r.quantity} 吨）`
  )
  notify(`客户发起运输需求`, 'request', '/contract', `客户 ${c.name} 需求 ${r.id}，请及时处理`)
  return r
}

/** 需求转合同草稿（合同管理：销售确认商务条款后生成草稿，进入正常审批流） */
export function convertRequestToContract(r, fields = {}) {
  if (r.status !== 'pending') return { error: `运输需求 ${r.id} 当前非"待处理"状态，无法转换` }
  const c = db.customers.find((x) => x.id === r.customerId)
  const consignee = db.customers.find((x) => x.id === r.consigneeId)
  const commodity = db.commodities.find((x) => x.id === r.commodityId)
  const quantity = fields.quantity ?? r.quantity
  const unitPrice = fields.unitPrice ?? r.unitPrice ?? 0
  const contract = {
    id: `HT-${String(db.contracts.length + 1).padStart(4, '0')}`,
    name: `${c?.name || ''}→${consignee?.name || ''} ${commodity?.name || ''}运输合同`,
    shipperId: r.customerId,
    consigneeId: r.consigneeId,
    commodityId: r.commodityId,
    mode: r.mode,
    loadTerminalId: r.loadTerminalId,
    unloadTerminalId: r.unloadTerminalId,
    quantity,
    unitPrice,
    amount: Math.round(quantity * unitPrice),
    paymentDays: fields.paymentDays ?? 30,
    startDate: dayjs().format('YYYY-MM-DD'),
    endDate: fields.endDate || dayjs().add(180, 'day').format('YYYY-MM-DD'),
    signDate: dayjs().format('YYYY-MM-DD'),
    status: 'draft',
    progress: 0,
    approvalChain: null,
    contact: c?.contact || '—',
    phone: c?.phone || '—',
    remark: `由客户运输需求 ${r.id} 生成${r.remark ? '；' + r.remark : ''}`,
    source: 'request',
    requestId: r.id
  }
  db.contracts.unshift(contract)
  r.status = 'converted'
  r.contractId = contract.id
  logAction('合同管理', '需求转合同', `运输需求 ${r.id} 转为合同草稿 ${contract.id}（${contract.name}）`)
  notify(`运输需求转合同`, 'request', '/contract', `需求 ${r.id} 转为合同草稿 ${contract.id}`)
  return contract
}

/** 驳回运输需求：pending → rejected（须记录原因） */
export function rejectTransportRequest(r, reason) {
  if (r.status !== 'pending') return { error: `运输需求 ${r.id} 当前非"待处理"状态，无法驳回` }
  r.status = 'rejected'
  r.rejectReason = reason || '未通过'
  logAction('合同管理', '驳回需求', `运输需求 ${r.id} 驳回：${r.rejectReason}`, 'fail')
  notify(`运输需求被驳回`, 'request', '/contract', `需求 ${r.id}：${r.rejectReason}`)
  return { ok: true }
}

/* ===== 成本归集（单车次全成本：燃油/磨损/司机/过路费/折旧） ===== */

/** 单车次成本：公路口径按车辆口径（燃油×装载系数 + 磨损 + 司机 + 过路费 + 折旧）；
 *  铁路/水运/管道无车辆司机，按运输单元能耗口径（能耗 + 磨损 + 通道费） */
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

/** 司机趟次收入：与成本侧司机项同口径（底薪 600 + 0.25 元/公里）；非公路车次无司机收入 */
export function driverIncomeOf(d) {
  if (!d || !d.driverId) return 0
  return tripCostOf(d).driver
}

/* ===== 司机端（接单 / 电子签收） ===== */

/** 司机接单：标记已接单（不改状态机，装货确认前司机需先接单） */
export function acceptDispatch(d) {
  d.accepted = true
  logAction('司机端', '司机接单', `调度单 ${d.id} 司机 ${driverOf(d.driverId)?.name || '-'} 接单`)
  notify(`司机接单提醒`, 'dispatch', '/dispatch', `调度单 ${d.id} 司机 ${driverOf(d.driverId)?.name || '-'} 已接单`)
}

/** 司机端电子签收：卸货完成后生成签收单（签收人+时间+签收码） */
export function signReceipt(d, signer) {
  d.receipt = {
    code: 'QS-' + d.id.slice(-5),
    signer: signer || '收货方',
    time: dayjs().format('YYYY-MM-DD HH:mm')
  }
  logAction('司机端', '电子签收', `调度单 ${d.id} 电子签收，签收人 ${d.receipt.signer}（${d.receipt.code}）`)
  return d.receipt
}

/* ===== 扫码确认（装/卸货码按调度单号确定性派生，司机端扫码核验后流转） ===== */

function hashStr(s) {
  let n = 0
  for (const ch of String(s)) n = (n * 31 + ch.charCodeAt(0)) % 2147483647
  return n
}

/** 装货码：装货场站张贴，司机扫码确认装货（ZD + 6 位） */
export function loadCodeOf(d) {
  return 'ZD' + String(100000 + (hashStr(d.id + ':load') % 900000))
}

/** 卸货码：卸货场站张贴，司机扫码确认卸货（XD + 6 位） */
export function unloadCodeOf(d) {
  return 'XD' + String(100000 + (hashStr(d.id + ':unload') % 900000))
}

/** 扫码确认装货：码不匹配/状态不符/未接单均拦截（复用 confirmLoad 守卫） */
export function scanConfirmLoad(d, code) {
  const expect = loadCodeOf(d)
  if (String(code || '').trim() !== expect) return { error: `装货码校验失败：「${code || '空'}」与本车次装货码 ${expect} 不符` }
  const r = confirmLoad(d)
  if (r && r.error) return r
  logAction('司机端', '扫码确认装货', `调度单 ${d.id} 扫装货码 ${expect} 核验通过，确认装货`)
  return { ok: true }
}

/** 扫码确认卸货：码不匹配/状态不符均拦截（复用 confirmUnload 守卫） */
export function scanConfirmUnload(d, code) {
  const expect = unloadCodeOf(d)
  if (String(code || '').trim() !== expect) return { error: `卸货码校验失败：「${code || '空'}」与本车次卸货码 ${expect} 不符` }
  const r = confirmUnload(d)
  if (r && r.error) return r
  logAction('司机端', '扫码确认卸货', `调度单 ${d.id} 扫卸货码 ${expect} 核验通过，确认卸货`)
  return { ok: true }
}

/* ===== 电子围栏（事件化：参数可配置 + 偏离/超时自动写异常单） ===== */

/** 地图坐标哈希偏移（与在途监控地图同一口径，保证回放轨迹与实时位置一致） */
export function hashOffset(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997
  return (h % 5) - 2
}

/** 轨迹点：沿线段均匀取 21 点，叠加按单号确定性派生的横向偏移（基础偏移 + 正弦波动） */
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

/** 轨迹最大偏离：轨迹点到线路直线的最大垂直距离（地图坐标单位） */
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

/** 围栏事件检查：在途车次 轨迹偏离超阈值→偏离异常 / 超 ETA 超阈值→延误异常，自动写异常单
 *  去重：每车次每类事件仅生成一次（d.fenceAlerted 记忆），恢复运输后不重复触发；
 *  由在途监控页 3 秒 tick 调用，围栏参数在 db.fenceConfig（监控页可配置） */
export function checkFenceEvents() {
  const cfg = db.fenceConfig
  if (!cfg || !cfg.enabled) return []
  const created = []
  for (const d of db.dispatches) {
    if (d.status !== 'intransit') continue
    d.fenceAlerted = d.fenceAlerted || {}
    const dev = maxDeviationOf(d)
    if (!d.fenceAlerted.deviate && dev > cfg.deviateLimit) {
      d.fenceAlerted.deviate = true
      const e = reportException(d, `围栏预警：轨迹偏离线路 ${dev} 个地图单位（阈值 ${cfg.deviateLimit}）`, 'other', 'medium')
      if (e && e.id) {
        e.source = 'fence'
        created.push(e)
      }
    } else if (!d.fenceAlerted.delay && d.eta && dayjs(d.eta).isBefore(dayjs().subtract(cfg.delayMinutes, 'minute'))) {
      d.fenceAlerted.delay = true
      const e = reportException(d, `围栏预警：超预计到达时间 ${dayjs().diff(dayjs(d.eta), 'minute')} 分钟（阈值 ${cfg.delayMinutes} 分钟）`, 'delay', 'medium')
      if (e && e.id) {
        e.source = 'fence'
        created.push(e)
      }
    }
  }
  return created
}

/* ===== 合同审批与开票（多级审批：部门审批 → 公司审批） ===== */

/** 审批链层级定义 */
export const APPROVAL_STEPS = [
  { level: 1, name: '部门审批' },
  { level: 2, name: '公司审批' }
]

/** 生成审批链（首级待审批，其余等待中） */
function buildApprovalChain() {
  return APPROVAL_STEPS.map((s, i) => ({
    level: s.level,
    name: s.name,
    status: i === 0 ? 'pending' : 'waiting',
    approver: '',
    comment: '',
    time: null
  }))
}

/** 提交审批：draft → pending，生成审批链（重新提交时重置审批链） */
export function submitContractApproval(c) {
  if (c.status !== 'draft') return { error: `合同 ${c.id} 当前非"草稿"状态，无法提交审批` }
  c.status = 'pending'
  c.approvalChain = buildApprovalChain()
  logAction('合同管理', '提交合同审批', `合同 ${c.id} 提交审批（部门审批 → 公司审批）`)
  notify(`合同 ${c.id} 提交审批`, 'approval', '/contract', '请及时处理（部门审批 → 公司审批）')
  return { ok: true }
}

/** 审批通过：推进当前待审批层级；末级通过 → executing
 *  返回 { final }：false 表示还有后续层级，true 表示全链通过 */
export function approveContract(c, comment) {
  const step = (c.approvalChain || []).find((s) => s.status === 'pending')
  if (!step) return { error: `合同 ${c.id} 无待审批层级` }
  step.status = 'approved'
  step.approver = operator.name
  step.comment = comment || '同意'
  step.time = dayjs().format('YYYY-MM-DD HH:mm')
  const next = (c.approvalChain || []).find((s) => s.status === 'waiting')
  if (next) {
    next.status = 'pending'
    logAction('合同管理', '合同审批', `合同 ${c.id} ${step.name}通过（${step.approver}），进入${next.name}`)
    notify(`合同 ${c.id} ${step.name}通过`, 'approval', '/contract', `进入${next.name}（审批人 ${step.approver}）`)
    return { ok: true, final: false, step: step.name }
  }
  c.status = 'executing'
  c.startDate = dayjs().format('YYYY-MM-DD')
  c.approval = { approver: operator.name, time: step.time, comment: step.comment }
  logAction('合同管理', '合同审批', `合同 ${c.id} 全级审批通过（末级：${step.name} ${step.approver}），进入执行`)
  notify(`合同 ${c.id} 全级审批通过`, 'approval', '/contract', '合同进入执行，可拆批计划')
  return { ok: true, final: true, step: step.name }
}

/** 审批驳回：当前层级驳回 → 回草稿，后续层级取消（重新提交审批后重走全链） */
export function rejectContract(c, reason) {
  const step = (c.approvalChain || []).find((s) => s.status === 'pending')
  if (!step) return { error: `合同 ${c.id} 无待审批层级` }
  step.status = 'rejected'
  step.approver = operator.name
  step.comment = `驳回：${reason}`
  step.time = dayjs().format('YYYY-MM-DD HH:mm')
  for (const s of c.approvalChain || []) if (s.status === 'waiting') s.status = 'cancelled'
  c.status = 'draft'
  c.approval = { approver: operator.name, time: step.time, comment: `驳回：${reason}` }
  logAction('合同管理', '合同审批', `合同 ${c.id} ${step.name}驳回：${reason}`, 'fail')
  notify(`合同 ${c.id} 审批被驳回`, 'approval', '/contract', `${step.name}驳回：${reason}`)
  return { ok: true, step: step.name }
}

/* ===== 合同全生命周期（变更 / 延期 / 提前终止 / 归档） ===== */

function pushChange(c, reason, content) {
  c.changes = c.changes || []
  c.changes.push({ time: dayjs().format('YYYY-MM-DD HH:mm'), operator: operator.name, reason, content })
}

/** 合同变更：调整数量/单价/截止日期，记录变更历史 */
export function changeContract(c, fields, reason) {
  const changes = []
  if (fields.quantity != null && fields.quantity !== c.quantity) {
    changes.push(`数量 ${c.quantity}→${fields.quantity} 吨`)
    c.quantity = fields.quantity
  }
  if (fields.unitPrice != null && fields.unitPrice !== c.unitPrice) {
    changes.push(`单价 ${c.unitPrice}→${fields.unitPrice} 元/吨`)
    c.unitPrice = fields.unitPrice
  }
  if (fields.endDate && fields.endDate !== c.endDate) {
    changes.push(`截止日期 ${c.endDate}→${fields.endDate}`)
    c.endDate = fields.endDate
  }
  c.amount = Math.round(c.quantity * c.unitPrice)
  if (!changes.length) return { changed: false }
  pushChange(c, reason, changes.join('；'))
  logAction('合同管理', '合同变更', `合同 ${c.id} 变更：${changes.join('；')}（${reason}）`)
  return { changed: true, changes }
}

/** 合同延期：延长截止日期，记录变更历史 */
export function extendContract(c, newDate, reason) {
  const old = c.endDate
  c.endDate = newDate
  pushChange(c, reason, `延期 ${old} → ${newDate}`)
  logAction('合同管理', '合同延期', `合同 ${c.id} 延期至 ${newDate}（${reason}）`)
}

/** 提前终止：executing → terminated
 *  口径：待执行计划批次取消；已调度/执行中计划及在途车次继续完成运输并正常结算（已发生业务照常履约），
 *  终止后不可再新建计划（新建计划页仅列执行中合同）与下发调度单（createDispatches 守卫拦截） */
export function terminateContract(c, reason, settleNow = true) {
  c.status = 'terminated'
  pushChange(c, reason, `提前终止（${reason}）`)
  for (const p of db.plans.filter((x) => x.contractId === c.id && x.status === 'pending')) {
    p.status = 'cancelled'
  }
  let billNo = null
  if (settleNow) {
    const keys = settlementCandidates().filter((g) => g.contractId === c.id).map((g) => g.key)
    if (keys.length) {
      const created = generateSettlements(keys)
      billNo = created[0] ? created[0].billNo : null
    }
  }
  logAction('合同管理', '终止合同', `合同 ${c.id} 提前终止（${reason}）${billNo ? `，已完成车次生成提前结算单 ${billNo}` : ''}`)
  notify(`合同 ${c.id} 提前终止`, 'approval', '/contract', reason)
  return billNo
}

/** 合同完结：executing → completed（手动关单）
 *  守卫：须执行中；未取消计划须全部完成（无待执行/已调度/执行中计划）
 *  适用：合同量含预留（拆批总量 < 合同量）时，计划全部完成也无法自动达 100%，由业务手动完结 */
export function completeContract(c) {
  if (c.status !== 'executing') return { error: `合同 ${c.id} 当前非"执行中"状态，无法完结` }
  const activePlans = db.plans.filter(
    (p) => p.contractId === c.id && p.status !== 'cancelled' && p.status !== 'completed'
  )
  if (activePlans.length) {
    return { error: `合同 ${c.id} 尚有 ${activePlans.length} 个未完结计划（待执行/执行中），无法完结` }
  }
  c.status = 'completed'
  c.progress = 100
  pushChange(c, '合同完结', '计划全部完成，手动完结合同')
  logAction('合同管理', '合同完结', `合同 ${c.id} 手动完结（计划全部完成，进度置 100%）`)
  notify(`合同 ${c.id} 已完结`, 'approval', '/contract', '计划全部完成，合同手动关单')
  return { ok: true }
}

/** 合同归档：completed → archived（只读存档） */
export function archiveContract(c) {
  c.status = 'archived'
  pushChange(c, '合同执行完毕', '归档')
  logAction('合同管理', '合同归档', `合同 ${c.id} 归档`)
}

/** 开具发票：结算单 not-issued → issued，生成发票记录（号码按种子确定性派生）
 *  状态守卫：仅"未开票"账单可开具，防止重复开票（与发票管理页 issueInvoiceRow 同口径） */
export function issueInvoice(s) {
  if (s.invoiceStatus !== 'not-issued') {
    return { error: `账单 ${s.billNo} 当前开票状态非"未开票"，无法重复开具发票` }
  }
  const fpSeq = db.invoices.length + 1
  const invoiceNo = genInvoiceNo(s.id + '-' + fpSeq)
  db.invoices.push({
    id: `FP-${String(fpSeq).padStart(4, '0')}`,
    settlementId: s.id,
    invoiceNo,
    type: '增值税专用发票',
    amount: s.totalAmount,
    issueDate: dayjs().format('YYYY-MM-DD'),
    status: 'issued',
    remark: ''
  })
  s.invoiceStatus = 'issued'
  logAction('发票管理', '开具发票', `账单 ${s.billNo} 开具发票 ${invoiceNo}，金额 ${formatMoney(s.totalAmount)}`)
  notify(`账单 ${s.billNo} 已开票`, 'settlement', '/settlement', `发票号码 ${invoiceNo}`)
  return invoiceNo
}

/** 发票开具（发票管理页：待开具 → 已开具，号码按 结算单ID-发票ID 确定性派生） */
export function issueInvoiceRow(inv) {
  if (inv.status !== 'pending') return { error: `发票 ${inv.id} 当前非"待开具"状态，无法开具` }
  inv.invoiceNo = inv.invoiceNo || genInvoiceNo(inv.settlementId + '-' + inv.id)
  inv.issueDate = dayjs().format('YYYY-MM-DD')
  inv.status = 'issued'
  const s = db.settlements.find((x) => x.id === inv.settlementId)
  if (s) s.invoiceStatus = 'issued'
  logAction('发票管理', '开具发票', `发票 ${inv.invoiceNo}（账单 ${s ? s.billNo : '-'}）开具，金额 ${formatMoney(inv.amount)}`)
  return { ok: true, invoiceNo: inv.invoiceNo }
}

/** 发票红冲（发票管理页：已开具 → 已红冲，须填红冲原因） */
export function redFlushInvoiceRow(inv, reason) {
  if (inv.status !== 'issued') return { error: `发票 ${inv.id} 当前非"已开具"状态，无法红冲` }
  inv.status = 'red-flushed'
  inv.remark = reason || inv.remark || ''
  const s = db.settlements.find((x) => x.id === inv.settlementId)
  if (s) s.invoiceStatus = 'not-issued'
  logAction('发票管理', '发票红冲', `发票 ${inv.invoiceNo} 红冲：${reason || '未填写原因'}`)
  return { ok: true }
}

/* ===== 数据导入（G7：Excel/CSV → 客户/商品/车辆，flow 统一守卫+去重+审计） ===== */

/** 客户导入：按客户名称去重（已存在跳过）；必填：客户名称 */
export function importCustomers(rows) {
  const created = []
  const skipped = []
  const errors = []
  rows.forEach((row, i) => {
    const name = String(row.name || '').trim()
    if (!name) {
      errors.push({ row: i + 1, reason: '客户名称不能为空' })
      return
    }
    if (db.customers.some((c) => c.name === name)) {
      skipped.push(name)
      return
    }
    const level = ['A', 'B', 'C'].includes(row.level) ? row.level : 'C'
    db.customers.push({
      id: `CUS${String(db.customers.length + 1).padStart(3, '0')}`,
      name,
      type: { 发货方: 'shipper', 收货方: 'consignee', 双向客户: 'both' }[row.type] || 'shipper',
      region: String(row.region || '').trim() || '其他',
      address: '',
      level,
      contact: String(row.contact || '').trim() || '-',
      phone: String(row.phone || '').trim() || '-',
      creditLimit: Number(row.creditLimit) > 0 ? Math.round(Number(row.creditLimit)) : level === 'A' ? 5000000 : level === 'B' ? 2000000 : 500000,
      totalBusiness: 0,
      joinDate: dayjs().format('YYYY-MM-DD'),
      status: 'active',
      remark: '导入'
    })
    created.push(name)
  })
  if (created.length || skipped.length || errors.length) {
    logAction('客户管理', '数据导入', `导入客户 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`)
    notify('客户数据导入完成', 'system', '/customer', `导入 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`)
  }
  return { created, skipped, errors }
}

/** 商品导入：按商品名称去重（已存在跳过）；必填：商品名称 */
export function importCommodities(rows) {
  const created = []
  const skipped = []
  const errors = []
  rows.forEach((row, i) => {
    const name = String(row.name || '').trim()
    if (!name) {
      errors.push({ row: i + 1, reason: '商品名称不能为空' })
      return
    }
    if (db.commodities.some((c) => c.name === name)) {
      skipped.push(name)
      return
    }
    db.commodities.push({
      id: `CM${String(db.commodities.length + 1).padStart(3, '0')}`,
      name,
      category: String(row.category || '').trim() || '煤炭',
      unit: String(row.unit || '').trim() || '吨',
      density: Number(row.density) > 0 ? Number(row.density) : 1,
      price: Number(row.price) > 0 ? Math.round(Number(row.price)) : 0,
      indicators: [{ name: '质量要求', value: '按合同约定' }],
      status: 'active',
      totalVolume: 0,
      remark: '导入'
    })
    created.push(name)
  })
  if (created.length || skipped.length || errors.length) {
    logAction('商品管理', '数据导入', `导入商品 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`)
    notify('商品数据导入完成', 'system', '/commodity', `导入 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`)
  }
  return { created, skipped, errors }
}

/** 车辆导入：按车牌去重（已存在跳过）；必填：车牌号；新导入车辆默认空闲、年检一年有效 */
export function importVehicles(rows) {
  const created = []
  const skipped = []
  const errors = []
  rows.forEach((row, i) => {
    const plate = String(row.plate || '').trim()
    if (!plate) {
      errors.push({ row: i + 1, reason: '车牌号不能为空' })
      return
    }
    if (db.vehicles.some((v) => v.plate === plate)) {
      skipped.push(plate)
      return
    }
    db.vehicles.push({
      id: `V${String(db.vehicles.length + 1).padStart(3, '0')}`,
      plate,
      type: String(row.type || '').trim() || '重型半挂车',
      capacity: Number(row.capacity) > 0 ? Number(row.capacity) : 35,
      owner: row.owner === '自有' ? '自有' : '外协',
      fuelType: String(row.fuelType || '').trim() || '柴油',
      status: 'idle',
      purchaseDate: dayjs().format('YYYY-MM-DD'),
      nextInspection: dayjs().add(365, 'day').format('YYYY-MM-DD'),
      mileage: 0,
      monthlyCost: 0,
      remark: '导入'
    })
    created.push(plate)
  })
  if (created.length || skipped.length || errors.length) {
    logAction('车辆管理', '数据导入', `导入车辆 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`)
    notify('车辆数据导入完成', 'system', '/vehicle', `导入 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`)
  }
  return { created, skipped, errors }
}

/* ===== 银行对账核销（G8：银行流水 → 账单核销，收款闭环） ===== */

/** 手动核销：待核销银行流水核销至指定账单（写收款流水，超未付余额拦截）
 *  守卫：流水须待核销；流水金额不可超过账单未付余额 */
export function matchBankRecord(b, s) {
  if (!b) return { error: '请选择银行流水' }
  if (b.status !== 'unmatched') return { error: `银行流水 ${b.id} 已核销，不能重复核销` }
  if (!s) return { error: '请选择核销账单' }
  const unpaid = s.totalAmount - s.paidAmount
  if (b.amount > unpaid) {
    return { error: `银行流水金额 ${formatMoney(b.amount)} 超过账单 ${s.billNo} 未付余额 ${formatMoney(unpaid)}` }
  }
  const real = recordPayment(s, b.amount, '银行转账')
  b.status = 'matched'
  b.settlementId = s.id
  b.matchTime = dayjs().format('YYYY-MM-DD HH:mm')
  b.matchBy = operator.name
  logAction('结算管理', '银行核销', `银行流水 ${b.id}（${b.counterparty} ${formatMoney(b.amount)}）核销至账单 ${s.billNo}`)
  return { ok: true, real }
}

/** 自动核销：待核销流水中，对手方+金额与账单（已结算/逾期）未付余额精确一致者自动核销
 *  口径：金额精确匹配（容差 0.01 元），避免误核销；其余流水保留待人工处理 */
export function autoMatchBank() {
  const matched = []
  for (const b of db.bankRecords.filter((x) => x.status === 'unmatched')) {
    const c = db.customers.find((x) => x.name === b.counterparty)
    const s = db.settlements.find(
      (x) =>
        (x.status === 'settled' || x.status === 'overdue') &&
        x.customerId === c?.id &&
        Math.abs(x.totalAmount - x.paidAmount - b.amount) < 0.01
    )
    if (!s) continue
    const r = matchBankRecord(b, s)
    if (r && !r.error) matched.push(b)
  }
  if (matched.length) logAction('结算管理', '自动核销', `自动核销完成，${matched.length} 笔银行流水已核销`)
  return matched
}

/** 启动时全量校准：计划/合同进度与调度实际执行对齐 */
export function recalcAll() {
  // 多式联运口径校准：调度单补运输方式；铁路/水运/管道按运输单元执行，不绑定车辆/司机
  for (const d of db.dispatches) {
    if (!d.mode) d.mode = contractOf(d.contractId)?.mode || '公路'
    if (!isRoadMode(d.mode)) {
      d.vehicleId = null
      d.driverId = null
      if (!d.unitNo) d.unitNo = unitNoOf(d.mode, d.id)
    }
  }
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
