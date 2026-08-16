/**
 * 临时冒烟测试：验证 mock 数据一致性与调度状态机闭环
 * 运行：node --import ./scripts/register.mjs scripts/verify-flow.mjs
 */
import { db, dashboard, weatherOf } from '../src/mock/index.js'
import { NOW } from '../src/mock/base.js'
import dayjs from 'dayjs'
import {
  confirmLoad,
  depart,
  arrive,
  confirmUnload,
  reportException,
  resumeDispatch,
  createDispatches,
  settlementCandidates,
  generateSettlements,
  startReconcile,
  confirmSettle,
  recordPayment,
  creditCheck,
  outstandingOf,
  acceptException,
  finishException,
  closeException,
  rejectContract,
  approveContract,
  manualWeighing,
  tareOf,
  contractRemaining,
  isRoadMode,
  genInvoiceNo,
  acceptDispatch,
  signReceipt,
  changeContract,
  extendContract,
  terminateContract,
  archiveContract
} from '../src/mock/flow.js'
import { monthlyReport, customerReport, commodityReport, terminalReport } from '../src/mock/report.js'
import { menuAllowed } from '../src/permission.js'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) {
    pass++
    console.log('  ✓', name)
  } else {
    fail++
    console.log('  ✗', name)
  }
}

console.log('== 1. 预置数据一致性 ==')
const plansWithDispatches = db.plans.filter((p) => db.dispatches.some((d) => d.planId === p.id))
check(
  '计划状态与车次状态一致（全完成→completed，否则→intransit/dispatched）',
  plansWithDispatches.every((p) => {
    const ds = db.dispatches.filter((d) => d.planId === p.id)
    if (ds.every((d) => d.status === 'completed')) return p.status === 'completed'
    return p.status === 'intransit' || p.status === 'dispatched'
  })
)
check(
  '执行中合同进度 = 实际完成运量/合同量',
  db.contracts
    .filter((c) => c.status === 'executing')
    .every((c) => {
      const done = db.dispatches
        .filter((d) => d.contractId === c.id && d.status === 'completed')
        .reduce((s, d) => s + d.quantity, 0)
      return c.progress === Math.min(100, Math.round((done / c.quantity) * 100))
    })
)
check(
  '结算单运量 = 该合同已完成车次出磅净重之和（按磅结算）',
  db.settlements.every((s) => {
    const done = db.dispatches.filter((d) => d.contractId === s.contractId && d.status === 'completed')
    const expect = +done
      .reduce((sum, d) => {
        const w = db.weighings.find((x) => x.dispatchId === d.id && x.type === '出磅')
        return sum + (w ? w.net : d.quantity)
      }, 0)
      .toFixed(2)
    return s.totalQuantity === expect
  })
)
check(
  '结算单金额恒等式（运费+杂费-损耗扣减-异常损失）',
  db.settlements.every(
    (s) =>
      s.totalAmount ===
      s.freight + s.loadingFee + s.unloadingFee + s.tollFee + s.surcharge - s.lossDeduction - s.exceptionLoss
  )
)
check(
  '收款流水与账单已付金额一致',
  db.settlements.every((s) => {
    const sum = db.payments.filter((p) => p.settlementId === s.id).reduce((a, p) => a + p.amount, 0)
    return sum === s.paidAmount
  })
)
check(
  '逾期账单 = 超账期且未付清',
  db.settlements.every((s) => {
    if (s.status !== 'overdue') return true
    return !!s.settleDate && s.totalAmount - s.paidAmount > 0
  })
)
check('异常车次数量 >= 7（异常模块可演示）', db.dispatches.filter((d) => d.status === 'exception').length >= 7)
check('单车运量在 30-40 吨区间', db.dispatches.every((d) => d.quantity >= 30 && d.quantity <= 40))
check('调度单数量合理（200-500）', db.dispatches.length >= 200 && db.dispatches.length <= 500)

console.log('== 2. 状态机全流程（新数据） ==')
// 取公路口径执行中合同（铁路/水运/管道按运输单元执行，无车辆司机）
const contract = db.contracts.find((c) => c.status === 'executing' && ['公路', '多式联运'].includes(c.mode))
const plan = {
  id: 'YH-TEST',
  contractId: contract.id,
  commodityId: contract.commodityId,
  quantity: 105,
  loadTerminalId: contract.loadTerminalId,
  unloadTerminalId: contract.unloadTerminalId,
  mode: contract.mode,
  unitPrice: contract.unitPrice,
  status: 'pending',
  progress: 0
}
db.plans.unshift(plan)
const { created, error } = createDispatches(plan, 3)
check('createDispatches 生成 3 张调度单', created.length === 3 && !error)
check('调度单数量按批次均摊（35 吨/车）', created.every((d) => d.quantity === 35))
check('计划状态 → dispatched', plan.status === 'dispatched')

const d = created[0]
const v = db.vehicles.find((x) => x.id === d.vehicleId)
const dr = db.drivers.find((x) => x.id === d.driverId)
confirmLoad(d)
check('确认装货 → loading + 进磅单', d.status === 'loading' && db.weighings.some((w) => w.dispatchId === d.id && w.type === '进磅'))
depart(d)
check('发车 → intransit + 车辆/司机占用', d.status === 'intransit' && v.status === 'inuse' && dr.status === 'onduty')
arrive(d)
check('到达 → unloading', d.status === 'unloading')
confirmUnload(d)
check(
  '确认卸货 → completed + 出磅单 + 资源释放',
  d.status === 'completed' &&
    db.weighings.some((w) => w.dispatchId === d.id && w.type === '出磅') &&
    v.status === 'idle' &&
    dr.status === 'available'
)
check('计划进度回卷（33%）', plan.progress === 33)
check('合同进度随执行上升', contract.progress > 0)

console.log('== 3. 异常闭环 ==')
const d2 = created[1]
confirmLoad(d2)
depart(d2)
reportException(d2, '测试异常')
check('上报异常 → exception + 异常单生成', d2.status === 'exception' && db.exceptions[0].dispatchId === d2.id)
resumeDispatch(d2)
check('异常恢复 → intransit', d2.status === 'intransit')

console.log('== 4. 结算闭环（P1-2 生成结算单 / P1-3 对账三方比对） ==')
check(
  '预置账单：车次均标记已入账单且状态一致',
  db.settlements.every((s) => {
    const ds = db.dispatches.filter((x) => x.settlementId === s.id)
    return ds.length === s.dispatchCount && ds.every((x) => x.settled && x.status === 'completed')
  })
)
const completedAll = db.dispatches.filter((x) => x.status === 'completed')
const candIds = new Set(settlementCandidates().flatMap((g) => g.dispatches.map((x) => x.id)))
check('已完成车次 = 已入账单 + 结算候选（无遗漏、无重复）', completedAll.every((x) => candIds.has(x.id) === !x.settled))
check(
  '非待对账账单已预生成对账结果且条数=车次',
  db.settlements
    .filter((s) => s.status !== 'pending')
    .every((s) => s.reconciliation && s.reconciliation.items.length === s.dispatchCount)
)

// 复用第 2 节完成的新车次 d，走 生成结算单 → 对账 → 结算 全流程
const g = settlementCandidates().find((x) => x.dispatches.some((x) => x.id === d.id))
check('新完成车次进入结算候选', !!g)
const s = generateSettlements([g.key]).find((x) => x.contractId === g.contractId)
check('生成结算单：车次/调度量与候选一致，结算量按磅扣减', s.dispatchCount === g.dispatchCount && s.dispatchQuantity === g.quantity && s.totalQuantity < s.dispatchQuantity)
check('车次标记已入账单（settled + settlementId）', d.settled === true && d.settlementId === s.id)
check('账单初始状态 待对账/未付款', s.status === 'pending' && s.paidAmount === 0)
check('生成后候选不再包含该车次（防重复结算）', !settlementCandidates().some((x) => x.dispatches.some((x) => x.id === d.id)))

const r = startReconcile(s)
check('发起对账 → 对账中 + 三方比对生成', s.status === 'reconciling' && r.items.length === s.dispatchCount)
const item = r.items.find((i) => i.dispatchId === d.id)
const outW = db.weighings.find((w) => w.dispatchId === d.id && w.type === '出磅')
check('比对项与磅单记录一致（结算量=出磅净重）', item.outNet === outW.net && item.settleQty === outW.net)
check('损耗=调度量-结算量 且进入汇总（按磅结算）', item.loss === +(d.quantity - outW.net).toFixed(2) && r.lossQty > 0 && r.lossAmount > 0)

confirmSettle(s)
check('确认结算 → 已结算 + 进入收款（未付）', s.status === 'settled' && s.paidAmount === 0 && !!s.settleDate)

console.log('== 5. 收款流水与信用校验（P1-5） ==')
const half = Math.round(s.totalAmount / 2)
recordPayment(s, half, '银行转账')
check('部分收款 → 已付更新 + 流水生成', s.paidAmount === half && db.payments.some((p) => p.settlementId === s.id && p.amount === half))
recordPayment(s, s.totalAmount, '支票')
check('超收按未付余额截断（付清）', s.paidAmount === s.totalAmount)
check('付清后状态保持已结算', s.status === 'settled')

// 逾期规则：结算日超账期且未付清 → 逾期；付清 → 回到已结算
s.settleDate = dayjs(NOW).subtract(90, 'day').format('YYYY-MM-DD')
s.paidAmount = 0
recordPayment(s, 1, '银行转账')
check('超账期未付清 → 逾期', s.status === 'overdue')
recordPayment(s, s.totalAmount - 1, '银行转账')
check('逾期账单付清 → 回到已结算', s.status === 'settled')

// 信用校验
const c1 = db.customers.find((c) => c.creditLimit)
const out = outstandingOf(c1.id)
check('信用校验：小额订单通过', creditCheck(c1.id, 1000).ok === true)
check('信用校验：超出授信额度的订单被拒', creditCheck(c1.id, c1.creditLimit + out + 1).ok === false)

console.log('== 6. 模块互联（P2） ==')
// P2-3 审计日志：状态变更动作实时写日志
const logBefore = db.logs.length
confirmLoad(created[2])
depart(created[2])
check('状态变更动作写入审计日志（含操作人/详情）', db.logs.length > logBefore && db.logs[0].user && !!db.logs[0].detail)
check('日志按时间倒序（新日志在最前）', db.logs[0].time >= db.logs[1].time)

// P2-1 仓储联动：装/卸货场站有仓库时出入库
const whDispatch = db.dispatches.find((d) => {
  const lt = db.terminals.find((t) => t.id === d.loadTerminalId)
  const ut = db.terminals.find((t) => t.id === d.unloadTerminalId)
  return d.status === 'pending' && lt?.warehouseId && ut?.warehouseId
})
if (whDispatch) {
  const lt = db.terminals.find((t) => t.id === whDispatch.loadTerminalId)
  const ut = db.terminals.find((t) => t.id === whDispatch.unloadTerminalId)
  const whOut = db.warehouses.find((w) => w.id === lt.warehouseId)
  const whIn = db.warehouses.find((w) => w.id === ut.warehouseId)
  const invBefore = db.inventories.length
  const usedOutBefore = whOut.used
  const usedInBefore = whIn.used
  confirmLoad(whDispatch)
  depart(whDispatch)
  arrive(whDispatch)
  confirmUnload(whDispatch)
  check('确认装货 → 装货场站仓库出库（占用减少）', whOut.used <= usedOutBefore)
  check('确认卸货 → 卸货场站仓库入库（新批次+占用增加）', db.inventories.length > invBefore && whIn.used >= usedInBefore)
} else {
  console.log('  - 跳过仓储联动（无两端带仓库的待装货车次）')
}

// P2-2 安全联动：事故类异常生成事故记录，结案更新车辆状态
const accDispatch = db.dispatches.find((d) => d.status === 'intransit' && d.loadTime)
const e = reportException(accDispatch, '测试事故：高速追尾', 'accident', 'high')
check('事故类异常生成事故记录（关联异常单）', !!e.accidentId && db.accidents.some((a) => a.id === e.accidentId && a.exceptionId === e.id))
acceptException(e, '测试安全员')
finishException(e, '保险理赔中', 20000)
const acc = db.accidents.find((a) => a.id === e.accidentId)
check('处置完成同步事故（处理/损失）', acc.handling === '保险理赔中' && acc.loss === 20000)
closeException(e)
check('关闭异常 → 事故结案', e.status === 'closed' && acc.status === 'closed')

// P2-6 审批驳回：必须带原因，回草稿
const pendingContract = db.contracts.find((c) => c.status === 'pending')
if (pendingContract) {
  rejectContract(pendingContract, '运输方案需调整')
  check('审批驳回 → 回草稿 + 记录审批意见', pendingContract.status === 'draft' && pendingContract.approval?.comment?.includes('驳回'))
  approveContract(pendingContract, '同意')
  check('审批通过 → 执行中 + 记录审批意见', pendingContract.status === 'executing' && pendingContract.approval?.comment === '同意')
} else {
  console.log('  - 跳过审批（无待审批合同）')
}

// P2-7 磅单补录 + 皮重按车辆派生（10-16t）
const mwDispatch = db.dispatches.find(
  (d) => ['公路', '多式联运'].includes(d.mode || '公路') && !db.weighings.some((w) => w.dispatchId === d.id && w.type === '进磅')
)
if (mwDispatch) {
  const r = manualWeighing(mwDispatch.id, '进磅', mwDispatch.quantity)
  check('磅单补录成功', r.ok === true && db.weighings.some((w) => w.dispatchId === mwDispatch.id && w.type === '进磅'))
  const dup = manualWeighing(mwDispatch.id, '进磅', 35)
  check('重复补录被拦截', !!dup.error)
}
const v1 = db.vehicles[0]
check('皮重按车辆派生且在 10-16t 区间', tareOf(v1) >= 10 && tareOf(v1) <= 16 && tareOf(v1) === tareOf(v1))
check('交互磅单皮重与预置口径一致（10-16t）', db.weighings.every((w) => w.tare >= 10 && w.tare <= 16))

console.log('== 7. P3 产品完整度 ==')

// P3-2 合同剩余可计划量
const rc = db.contracts.find((c) => c.status === 'executing')
if (rc) {
  const planned = db.plans
    .filter((p) => p.contractId === rc.id && p.status !== 'cancelled')
    .reduce((s, p) => s + p.quantity, 0)
  check(
    '合同剩余可计划量 = 合同总量 - 未取消计划量',
    contractRemaining(rc.id) === Math.max(0, rc.quantity - planned)
  )
}

// P3-4 多式联运：非公路方式按运输单元执行
const nonRoad = db.contracts.find((c) => c.status === 'executing' && !isRoadMode(c.mode))
if (nonRoad) {
  const p = {
    id: 'YH-TEST-NR',
    contractId: nonRoad.id,
    commodityId: nonRoad.commodityId,
    quantity: 2000,
    loadTerminalId: nonRoad.loadTerminalId,
    unloadTerminalId: nonRoad.unloadTerminalId,
    mode: nonRoad.mode,
    planDate: dayjs().format('YYYY-MM-DD'),
    unitPrice: nonRoad.unitPrice,
    status: 'pending',
    progress: 0,
    remark: '测试'
  }
  const { created, error } = createDispatches(p, 2)
  check(
    `非公路方式（${nonRoad.mode}）按运输单元派车成功`,
    !error && created.length === 2
  )
  check(
    '非公路车次无车辆/司机，带运输单元号',
    created.every((d) => d.vehicleId === null && d.driverId === null && !!d.unitNo && d.mode === nonRoad.mode)
  )
  for (const d of created) {
    confirmLoad(d)
    depart(d)
    arrive(d)
    confirmUnload(d)
  }
  check(
    '非公路车次全流程完成且不产生公路磅单',
    created.every((d) => d.status === 'completed' && !db.weighings.some((w) => w.dispatchId === d.id))
  )
  // 清理测试数据
  for (const d of created) db.dispatches.splice(db.dispatches.indexOf(d), 1)
  db.plans.splice(db.plans.indexOf(p), 1)
} else {
  console.log('  - 跳过多式联运（无执行中的非公路合同）')
}
check('manualWeighing 拦截非公路车次', (() => {
  const nr = db.dispatches.find((d) => !isRoadMode(d.mode || '公路'))
  return nr ? !!manualWeighing(nr.id, '进磅', 35).error : true
})())

// P3-5 司机端：接单 + 电子签收
const rd = db.dispatches.find((d) => d.status === 'pending' && d.driverId)
if (rd) {
  acceptDispatch(rd)
  check('司机接单标记 accepted', rd.accepted === true)
  signReceipt(rd, '测试签收人')
  check(
    '电子签收单生成（QS- 码 + 签收人）',
    !!rd.receipt && rd.receipt.code.startsWith('QS-') && rd.receipt.signer === '测试签收人' && !!rd.receipt.time
  )
} else {
  console.log('  - 跳过司机端（无待装货公路车次）')
}

// P3-7 合同生命周期：变更 / 延期 / 终止 / 归档
const ec = db.contracts.find((c) => c.status === 'executing')
if (ec) {
  const r1 = changeContract(ec, { quantity: ec.quantity + 1000 }, '需求增加')
  check(
    '合同变更重算金额并记录历史',
    r1.changed === true && ec.amount === Math.round(ec.quantity * ec.unitPrice) && (ec.changes || []).length > 0
  )
  const newEnd = dayjs().add(90, 'day').format('YYYY-MM-DD')
  extendContract(ec, newEnd, '工期顺延')
  check('合同延期更新截止日期并记录历史', ec.endDate === newEnd && (ec.changes || []).length > 1)
}
const tc = db.contracts.find((c) => c.status === 'executing' && c.id !== ec?.id)
if (tc) {
  const billNo = terminateContract(tc, '客户经营调整', false)
  check(
    '提前终止：状态 terminated 且待执行计划全部取消',
    tc.status === 'terminated' &&
      db.plans.filter((x) => x.contractId === tc.id && x.status === 'pending').length === 0 &&
      (typeof billNo === 'string' || billNo === null)
  )
}
const ac = db.contracts.find((c) => c.status === 'completed')
if (ac) {
  archiveContract(ac)
  check('合同归档：状态 archived 且记录历史', ac.status === 'archived' && (ac.changes || []).length > 0)
} else {
  console.log('  - 跳过归档（无已完成合同）')
}

// P3-8 KPI 口径
const kpi = dashboard.kpi
check('准时交付率在 0-100 区间', kpi.onTimeRate >= 0 && kpi.onTimeRate <= 100)
const usable = db.vehicles.filter((v) => v.status !== 'scrapped').length
const inuse = db.vehicles.filter((v) => v.status === 'inuse').length
check(
  '车辆利用率 = 运输中车辆 / 非报废车辆',
  kpi.utilization === (usable ? Math.round((inuse / usable) * 1000) / 10 : 0)
)

// P3-9 发票号确定性派生
const invNo = genInvoiceNo('SET-TEST-1')
check(
  '发票号确定性派生（16 位数字，2410 开头，与种子口径一致）',
  invNo === genInvoiceNo('SET-TEST-1') && /^\d{16}$/.test(invNo) && invNo.startsWith('2410')
)
check('不同结算单发票号不同', genInvoiceNo('SET-A') !== genInvoiceNo('SET-B'))

// P3-10 公告 / 天气数据源化
check('公告数据源化（db.announcements）', Array.isArray(db.announcements) && db.announcements.length >= 3)
const w1 = weatherOf('2026-08-16')
const w2 = weatherOf('2026-08-16')
check('天气按日期确定性派生', w1.city && w1.cond && w1.temp > 0 && w1.cond === w2.cond && w1.temp === w2.temp)

// P3-8 报表中心
check('月度报表覆盖近 6 个月', monthlyReport().length === 6)
check('客户报表含授信占用口径', customerReport().every((c) => typeof c.creditPct === 'number' && typeof c.outstanding === 'number'))
check('商品报表含磅单损耗率', commodityReport().every((c) => typeof c.lossRate === 'number'))
check('场站报表含装卸吞吐', terminalReport().every((t) => typeof t.loadTrips === 'number' && typeof t.unloadTrips === 'number'))

// RBAC：报表中心权限 + 路径一致性
check('报表中心权限：结算专员可访问、调度员不可访问', menuAllowed('结算专员', '/report') === true && menuAllowed('调度员', '/report') === false)
check('RBAC 路径与实际路由一致（调度员可访问 /contract）', menuAllowed('调度员', '/contract') === true)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
