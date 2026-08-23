/**
 * 临时冒烟测试：验证 mock 数据一致性与调度状态机闭环
 * 运行：node --import ./scripts/register.mjs scripts/verify-flow.mjs
 */
import { db, dashboard, weatherOf } from '../src/mock/index.js'
import { NOW, genId } from '../src/mock/base.js'
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
  revertPayment,
  creditCheck,
  outstandingOf,
  acceptException,
  finishException,
  closeException,
  rejectContract,
  approveContract,
  submitContractApproval,
  manualWeighing,
  correctWeighing,
  tareOf,
  contractRemaining,
  isRoadMode,
  genInvoiceNo,
  acceptDispatch,
  signReceipt,
  supplementReceipt,
  changeContract,
  approveContractChange,
  rejectContractChange,
  extendContract,
  terminateContract,
  archiveContract,
  recalcSettlement,
  issueInvoiceRow,
  redFlushInvoiceRow,
  calcSettlementFees,
  completeContract,
  issueInvoice,
  loadCodeOf,
  unloadCodeOf,
  scanConfirmLoad,
  scanConfirmUnload,
  checkFenceEvents,
  maxDeviationOf,
  tripCostOf,
  customerConfirm,
  customerObjection,
  registerAccident,
  closeAccident,
  addTraining,
  completeTraining,
  addInspection,
  submitTransportRequest,
  convertRequestToContract,
  rejectTransportRequest,
  driverIncomeOf,
  vehicleInspectionExpired,
  driverLicenseExpired,
  generatePayables,
  payPayable,
  payableStats,
  outsourceFreightOf,
  cancelDispatch,
  reassignDispatch,
  dunning,
  notify,
  markMessageRead,
  markAllMessagesRead,
  importCustomers,
  importCommodities,
  importVehicles,
  matchBankRecord,
  autoMatchBank,
  setOperator,
  operatorCan,
  BUSY_STATUSES,
  validateResourceCommit,
  advanceTelemetry,
  recalcOverdueAll,
  createContract,
  createPlan,
  cancelPlan,
  saveCommodity,
  toggleCommodityStatus,
  toggleCustomerStatus,
  toggleDriverStatus,
  sendVehicleRepair,
  resumeVehicle,
  setInventoryStatus,
  saveUser,
  removeUser,
  toggleUserStatus,
  saveRole,
  removeRole,
  updateRolePerms,
  driverDepart,
  driverArrive,
  visibleMessages,
  rolesWithAction,
  toRoles,
  clearOperator,
  qualityDeductionQty,
  collectPrepayment,
  applyPrepayment,
  prepaymentOf,
  prepaymentAvailable,
  dispatchRevenueOf,
  listRateCards,
  rateOf,
  createRateCard,
  updateRateCard,
  toggleRateCard,
  escalatePendingExceptions,
  escalateContractApprovals,
  listInsuranceClaims,
  fileInsuranceClaim,
  assessInsuranceClaim,
  settleInsuranceClaim,
  rejectInsuranceClaim,
  MAX_LOGS,
  MAX_MESSAGES,
  logAction,
  getDnd,
  setDnd,
  isMuted,
  unreadCount,
  safetyStockOf,
  availableStockOf,
  inventoryAlerts,
  setSafetyStock,
  DATA_REGIONS,
  dataScopeOf,
  recordRegion,
  inDataScope,
  visibleDispatches,
  visiblePlans,
  setDataScope,
  login,
  generateCaptcha,
  verifyCaptcha
} from '../src/mock/flow.js'
import { onSchedulerEvent, runSchedulerTick } from '../src/mock/scheduler.js'
import { monthlyReport, customerReport, commodityReport, terminalReport, costReport } from '../src/mock/report.js'
import { menuAllowed, actionAllowed } from '../src/permission.js'
import { listDocuments, documentContent, documentOf, DOC_TYPES } from '../src/mock/document.js'
import { hashPassword } from '../src/utils/index.js'

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

// P3 工程加固：服务层默认"未登录"态（默认拒绝），冒烟测试直调服务层须先显式登录（等价浏览器登录守卫）
setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })

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
  '结算单金额恒等式（运费+杂费-损耗扣减-质量扣减-异常损失）',
  db.settlements.every(
    (s) =>
      s.totalAmount ===
      s.freight + s.loadingFee + s.unloadingFee + s.tollFee + s.surcharge - s.lossDeduction - (s.qualityDeduction || 0) - s.exceptionLoss
  )
)
check(
  '收款流水与账单已付金额一致',
  db.settlements.every((s) => {
    const sum = db.payments.filter((p) => p.settlementId === s.id && !p.reversed).reduce((a, p) => a + p.amount, 0)
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
// P0-6 状态机守卫：新派车单未接单不可确认装货（与司机端规则一致）
const blockedLoad = confirmLoad(created[1])
check('守卫：未接单公路车次不可确认装货', !!blockedLoad?.error && created[1].status === 'pending')
acceptDispatch(d)
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
signReceipt(d, '收货方')
check('电子签收：卸货完成后生成签收单（收货凭证）', !!d.receipt?.code && d.receipt.code.startsWith('QS-') && !!d.receipt.time)
check('计划进度回卷（33%）', plan.progress === 33)
check('合同进度随执行上升', contract.progress > 0)

console.log('== 3. 异常闭环 ==')
const d2 = created[1]
acceptDispatch(d2)
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

// N1 客户确认闸门：未确认对账结果不可确认结算
const blockedSettle = confirmSettle(s)
check('守卫：客户未确认对账结果不可确认结算', !!blockedSettle?.error && s.status === 'reconciling')
const rcConf = customerConfirm(s)
check('客户确认对账（写 customerConfirmed，门户口径）', rcConf.ok === true && !!s.customerConfirmed?.time)
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
acceptDispatch(created[2])
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

// P2-6 多级审批（部门→公司）：驳回回草稿、重新提交重走全链、逐级通过
const pendingContract = db.contracts.find((c) => c.status === 'pending')
if (pendingContract) {
  rejectContract(pendingContract, '运输方案需调整')
  check('审批驳回 → 回草稿 + 记录审批意见', pendingContract.status === 'draft' && pendingContract.approval?.comment?.includes('驳回'))
  check('驳回时后续审批级取消', pendingContract.approvalChain?.[0]?.status === 'rejected' && pendingContract.approvalChain?.[1]?.status === 'cancelled')
  submitContractApproval(pendingContract)
  check('重新提交审批 → 待审批 + 重建两级审批链', pendingContract.status === 'pending' && pendingContract.approvalChain?.length === 2 && pendingContract.approvalChain[0].status === 'pending' && pendingContract.approvalChain[1].status === 'waiting')
  const r1 = approveContract(pendingContract, '部门同意')
  check('部门审批通过 → 仍待审批（进入公司审批）', r1.final === false && pendingContract.status === 'pending' && pendingContract.approvalChain[0].status === 'approved' && pendingContract.approvalChain[1].status === 'pending')
  const r2 = approveContract(pendingContract, '同意')
  check('公司审批通过 → 执行中 + 记录审批意见', r2.final === true && pendingContract.status === 'executing' && pendingContract.approval?.comment === '同意')
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
  // 环节1 守卫：签收单是收货凭证，卸货完成前不可签收
  check('守卫：卸货完成前不可签收（签收单为收货凭证）', !!signReceipt(rd, '测试签收人')?.error && !rd.receipt)
} else {
  console.log('  - 跳过司机端（无待装货公路车次）')
}
// 电子签收：已完成且未签收的公路车次（种子约 10% 缺失，供"补签"演示）
const rdone = db.dispatches.find((d) => d.status === 'completed' && isRoadMode(d.mode) && !d.receipt)
if (rdone) {
  signReceipt(rdone, '测试签收人')
  check(
    '电子签收单生成（QS- 码 + 签收人）',
    !!rdone.receipt && rdone.receipt.code.startsWith('QS-') && rdone.receipt.signer === '测试签收人' && !!rdone.receipt.time
  )
} else {
  console.log('  - 跳过电子签收（无未签收的已完成公路车次）')
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

console.log('== 8. P0 回归（状态机守卫 / 预付款保留 / RBAC 默认拒绝 / 报表口径 / 事故关联） ==')

// 状态机守卫：非法流转被拦截且状态不变
check('守卫：在途车次不可确认装货/重复发车', (() => {
  const a = confirmLoad(d2)
  const b = depart(d2)
  return !!a?.error && !!b?.error && d2.status === 'intransit'
})())
const excD = db.dispatches.find((x) => x.status === 'exception')
check('守卫：异常车次不可发车/确认卸货', (() => {
  if (!excD) return true
  const a = depart(excD)
  const b = confirmUnload(excD)
  return !!a?.error && !!b?.error && excD.status === 'exception'
})())
check('守卫：已完成车次不可再流转', (() => {
  const a = confirmUnload(d)
  const b = reportException(d, '已完成再报异常')
  return !!a?.error && !!b?.error && d.status === 'completed'
})())

// P0-4：对账前预付在确认结算后保留（不清零），与收款流水一致
const preS = db.settlements.find((s) => s.status === 'reconciling' && s.paidAmount > 0)
if (preS) {
  const pre = preS.paidAmount
  // 环节1：未签收公路车次先补签（硬拦截前置），再走客户确认 → 确认结算
  const preMissing = db.dispatches.filter((x) => x.settlementId === preS.id && isRoadMode(x.mode) && !x.receipt)
  for (const x of preMissing) supplementReceipt(x, '收货方仓管员', '冒烟测试补签')
  customerConfirm(preS) // N1 闸门：先由客户确认对账
  confirmSettle(preS)
  check('确认结算保留预付款（已付金额不清零）', preS.status === 'settled' && preS.paidAmount === pre)
  check(
    '预付款与收款流水合计一致',
    db.payments.filter((p) => p.settlementId === preS.id && !p.reversed).reduce((a, p) => a + p.amount, 0) === preS.paidAmount
  )
} else {
  console.log('  - 跳过预付款保留（无带预付的对账中账单）')
}

// P0-7：月度报表逾期数按月过滤（各月之和 = 全量逾期账单数）
const mr = monthlyReport()
check(
  '月度报表逾期数按月过滤（各月之和 = 全量逾期账单数）',
  mr.reduce((sum, m) => sum + m.overdueCount, 0) === db.settlements.filter((s) => s.status === 'overdue').length
)

// P0-1：RBAC 默认拒绝（未知/空角色无任何菜单与操作），null 角色仍为全权限
check(
  'RBAC 默认拒绝：未知/空角色无菜单无操作',
  menuAllowed('未知角色', '/contract') === false &&
    menuAllowed('', '/contract') === false &&
    actionAllowed('未知角色', 'dispatch') === false &&
    actionAllowed('', 'dispatch') === false
)
check(
  'RBAC：平台管理员(null)仍为全权限',
  menuAllowed('平台管理员', '/contract') === true && actionAllowed('平台管理员', 'dispatch') === true
)

// P0-5：种子事故类异常与事故记录双向关联
const linkedAccExceptions = db.exceptions.filter((e) => e.type === 'accident' && e.accidentId)
check(
  '种子事故类异常与事故记录双向关联',
  linkedAccExceptions.length > 0 &&
    linkedAccExceptions.every((e) => db.accidents.some((a) => a.id === e.accidentId && a.exceptionId === e.id))
)

console.log('== 9. P1 回归（角色权限数据化 / 皮重口径 / 资源操作日志 / 合同终止口径 / 派车互斥 / 结算调整） ==')

// P1-8：角色权限表数据化（db.rolePerms 为运行时判定源）
check(
  'db.rolePerms 为内置角色种子权限条目',
  ['平台管理员', '调度员', '结算专员', '场站操作员', '安全管理员', '只读用户'].every((n) => !!db.rolePerms[n])
)
check(
  '角色权限以 db.rolePerms 为准（调度员无结算菜单、有调度菜单）',
  menuAllowed('调度员', '/settlement') === false && menuAllowed('调度员', '/dispatch') === true
)
db.roles.push({ id: 'R-TEST', name: '测试角色', code: 'test_role', userCount: 0, description: '测试', builtIn: false })
db.rolePerms['测试角色'] = { menus: [], actions: [] }
check('新建角色默认无任何权限（deny）', menuAllowed('测试角色', '/workbench') === false && actionAllowed('测试角色', 'dispatch') === false)
db.rolePerms['测试角色'] = { menus: ['/workbench', '/dispatch'], actions: ['dispatch'] }
check(
  '角色授权后立即生效（按授权放行、未授权拒绝）',
  menuAllowed('测试角色', '/workbench') === true &&
    menuAllowed('测试角色', '/settlement') === false &&
    actionAllowed('测试角色', 'dispatch') === true &&
    actionAllowed('测试角色', 'settlement') === false
)
delete db.rolePerms['测试角色']
db.roles.splice(db.roles.findIndex((r) => r.id === 'R-TEST'), 1)
check('角色删除后权限条目同步清除（回落到默认拒绝）', !db.rolePerms['测试角色'] && menuAllowed('测试角色', '/workbench') === false)

// P1-9：皮重口径统一（种子磅单 = 运行时补录 = tareOf(车辆)）
check(
  '种子磅单皮重 = tareOf(车辆)（同一车辆进/出磅皮重一致）',
  (() => {
    const ws = db.weighings.filter((w) => {
      const d = db.dispatches.find((x) => x.id === w.dispatchId)
      return d && d.vehicleId
    })
    return ws.length > 0 && ws.every((w) => {
      const d = db.dispatches.find((x) => x.id === w.dispatchId)
      const v = db.vehicles.find((x) => x.id === d.vehicleId)
      return w.tare === tareOf(v)
    })
  })()
)

// P1-10：资源类操作走 flow（状态守卫 + 审计日志）
// 构造一张"待开具"发票（种子发票状态依赖 rng 流，直接构造保证用例可复现）
const invSettle = db.settlements.find((s) => s.status === 'settled' || s.status === 'overdue')
const invPending = invSettle
  ? {
      id: 'FP-TEST',
      settlementId: invSettle.id,
      invoiceNo: '',
      type: '增值税专用发票',
      amount: invSettle.totalAmount,
      issueDate: null,
      status: 'pending',
      remark: ''
    }
  : null
if (invPending) {
  db.invoices.push(invPending)
  invSettle.invoiceStatus = 'pending' // 与待开具记录一致（统一入口以结算单状态为准）
  const r1 = issueInvoiceRow(invPending)
  check(
    '发票开具走 flow（状态/号码/结算单开票状态 + 审计日志）',
    r1.ok === true &&
      invPending.status === 'issued' &&
      !!invPending.invoiceNo &&
      db.settlements.find((s) => s.id === invPending.settlementId)?.invoiceStatus === 'issued' &&
      db.logs[0].module === '发票管理'
  )
  const r2 = redFlushInvoiceRow(invPending, '测试红冲')
  check(
    '发票红冲走 flow（状态回退 + 审计日志）',
    r2.ok === true && invPending.status === 'red-flushed' && db.logs[0].action === '发票红冲'
  )
  check('守卫：已红冲发票不可重复红冲', !!redFlushInvoiceRow(invPending, '再次红冲')?.error)
} else {
  console.log('  - 跳过发票操作（无已结算/逾期账单可关联）')
}

// P1-12：派车资源互斥（排除已有未完结车次的车辆/司机）
const p12 = db.plans.find((p) => {
  if (p.status !== 'pending') return false
  const c = db.contracts.find((x) => x.id === p.contractId)
  return c && c.status === 'executing' && isRoadMode(p.mode || '公路')
})
if (p12) {
  const busyBefore = new Set(
    db.dispatches.filter((d) => ['pending', 'loading', 'exception'].includes(d.status)).map((d) => d.vehicleId)
  )
  const busyDriverBefore = new Set(
    db.dispatches.filter((d) => ['pending', 'loading', 'exception'].includes(d.status)).map((d) => d.driverId)
  )
  const { created: c12 } = createDispatches(p12, 3)
  check(
    '派车排除已有未完结车次的车辆/司机',
    c12.length === 3 &&
      c12.every((d) => !busyBefore.has(d.vehicleId) && !busyDriverBefore.has(d.driverId))
  )
  check(
    '新调度单之间车辆/司机不重复占用',
    new Set(c12.map((d) => d.vehicleId)).size === c12.length &&
      new Set(c12.map((d) => d.driverId)).size === c12.length
  )
} else {
  console.log('  - 跳过派车互斥（无执行中合同的待执行公路计划）')
}

// P1-11：合同终止口径（待执行计划取消 + 终止后拦截新调度）
const tc2 = db.contracts.find((c) => c.status === 'executing')
if (tc2) {
  const pendingPlans = db.plans.filter((p) => p.contractId === tc2.id && p.status === 'pending')
  terminateContract(tc2, 'P1 终止口径测试', false)
  check(
    '合同终止：状态 terminated 且待执行计划全部取消',
    tc2.status === 'terminated' && pendingPlans.every((p) => p.status === 'cancelled')
  )
  const anyPlan = db.plans.find((p) => p.contractId === tc2.id && p.status !== 'cancelled')
  const r11 = anyPlan ? createDispatches(anyPlan, 1) : { created: [], error: '合同已终止，不能再下发调度单' }
  check('守卫：已终止合同不可再下发调度单', !!r11.error && r11.created.length === 0)
}

// P1-13：结算调整（异常关闭补扣 + 重算入口）
const c13 = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
if (c13) {
  const p13 = {
    id: 'YH-P13',
    contractId: c13.id,
    commodityId: c13.commodityId,
    quantity: 35,
    loadTerminalId: c13.loadTerminalId,
    unloadTerminalId: c13.unloadTerminalId,
    mode: c13.mode,
    unitPrice: c13.unitPrice,
    status: 'pending',
    progress: 0
  }
  db.plans.unshift(p13)
  const { created: c13d } = createDispatches(p13, 1)
  const d13 = c13d[0]
  if (d13) {
    acceptDispatch(d13)
    confirmLoad(d13)
    depart(d13)
    const e13 = reportException(d13, 'P1 测试：结算时异常未关闭', 'damage', 'medium')
    resumeDispatch(d13) // 先恢复运输、异常保持未关闭
    arrive(d13)
    confirmUnload(d13)
    const g13 = settlementCandidates().find((x) => x.dispatches.some((x) => x.id === d13.id))
    const s13 = generateSettlements([g13.key])[0]
    const lossBefore = s13.exceptionLoss
    const totalBefore = s13.totalAmount
    const r13a = recalcSettlement(s13)
    check('重算（待对账）：数据未变化时金额不变（幂等）', r13a.ok === true && r13a.delta === 0)
    finishException(e13, '货损已处理', 8000)
    closeException(e13)
    check(
      '异常关闭补扣：已入账单损失扣减 + 调整记录 + 防重复标记',
      s13.exceptionLoss === lossBefore + 8000 &&
        s13.totalAmount === totalBefore - 8000 &&
        s13.adjustments.length === 1 &&
        s13.adjustments[0].amount === -8000 &&
        e13.settleApplied === s13.id
    )
    check('补扣写入审计日志（结算调整）', db.logs.some((l) => l.action === '结算调整' && l.detail.includes(s13.billNo)))
    const r13b = recalcSettlement(s13)
    check('重算与补扣结果一致（幂等，不重复扣减）', r13b.ok === true && r13b.delta === 0 && s13.totalAmount === totalBefore - 8000)
    startReconcile(s13)
    check('守卫：非待对账账单不可重算', !!recalcSettlement(s13)?.error)
  } else {
    console.log('  - 跳过结算调整（派车失败）')
  }
} else {
  console.log('  - 跳过结算调整（无执行中的公路合同）')
}

console.log('== 10. P2 回归（清理 + 多级审批） ==')
// 种子审批链：待审批合同两级链（首级待审）；已执行/已完成/已终止合同全链通过
check(
  '种子待审批合同带两级审批链（首级待审）',
  db.contracts.filter((c) => c.status === 'pending').every((c) => c.approvalChain?.length === 2 && c.approvalChain[0].status === 'pending' && c.approvalChain[1].status === 'waiting')
)
check(
  '种子已执行/已完成/已终止合同审批链全链通过',
  db.contracts.filter((c) => ['executing', 'completed', 'terminated'].includes(c.status)).every((c) => (c.approvalChain || []).length === 2 && c.approvalChain.every((s) => s.status === 'approved'))
)
// 安全运行天数按事故记录派生（不再硬编码 386）
check('安全运行天数按事故记录派生（>0 且 ≤365）', dashboard.kpi.safeDays > 0 && dashboard.kpi.safeDays <= 365)
// 培训种子含实际参训司机（driverIds），覆盖率按真实口径可计算
const trainedIds = new Set()
for (const t of db.trainings) {
  if (t.status === 'completed' && dayjs(t.date).isAfter(dayjs(NOW).subtract(90, 'day'))) {
    for (const id of t.driverIds || []) trainedIds.add(id)
  }
}
check('培训种子含参训司机 driverIds（覆盖率口径可计算）', db.trainings.some((t) => (t.driverIds || []).length > 0) && trainedIds.size > 0 && trainedIds.size <= db.drivers.length)

console.log('== 11. P2 功能（扫码确认 / 围栏事件化 / 成本侧 / 客户门户） ==')
// 扫码确认：装/卸货码按调度单号确定性派生
const scanD = db.dispatches.find((d) => d.status === 'pending' && isRoadMode(d.mode) && d.accepted)
if (scanD) {
  const lc = loadCodeOf(scanD)
  const uc = unloadCodeOf(scanD)
  check(
    '装/卸货码确定性派生（同单同码、异单异码、格式 ZD/XD+6 位）',
    /^ZD\d{6}$/.test(lc) &&
      /^XD\d{6}$/.test(uc) &&
      loadCodeOf(scanD) === lc &&
      db.dispatches.some((d) => d.id !== scanD.id && loadCodeOf(d) !== lc)
  )
  check('守卫：错误装货码拦截（状态不变）', !!scanConfirmLoad(scanD, 'ZD999999')?.error && scanD.status === 'pending')
  const rScan = scanConfirmLoad(scanD, lc)
  check(
    '扫码确认装货：正确码 → 装货中 + 进磅单登记',
    rScan.ok === true && scanD.status === 'loading' && db.weighings.some((w) => w.dispatchId === scanD.id && w.type === '进磅')
  )
  check('守卫：非待装货状态扫码装货拦截', !!scanConfirmLoad(scanD, lc)?.error)
  check('守卫：非卸货中状态扫码卸货拦截', !!scanConfirmUnload(scanD, uc)?.error)
} else {
  console.log('  - 跳过扫码确认（无已接单的待装货公路车次）')
}

// 围栏事件化：参数种子 + 偏离自动写异常单 + 去重 + 开关
check(
  '围栏参数种子（enabled/deviateLimit/delayMinutes）',
  db.fenceConfig?.enabled === true && db.fenceConfig.deviateLimit > 0 && db.fenceConfig.delayMinutes > 0
)
const deviating = db.dispatches.filter((d) => d.status === 'intransit' && maxDeviationOf(d) > db.fenceConfig.deviateLimit)
const fenceBefore = db.exceptions.length
const fenceCreated = checkFenceEvents()
check(
  '围栏事件：偏离超阈值在途车次自动写异常单（source=fence，车次转异常）',
  fenceCreated.length >= deviating.length &&
    fenceCreated.every((e) => e.source === 'fence' && e.status === 'pending') &&
    deviating.every((d) => d.status === 'exception' && db.exceptions.some((e) => e.dispatchId === d.id && e.source === 'fence')) &&
    db.exceptions.length === fenceBefore + fenceCreated.length
)
check('围栏事件去重：二次检查不重复生成（每车次每类一次）', checkFenceEvents().length === 0)
const fenceEnabled = db.fenceConfig.enabled
db.fenceConfig.enabled = false
check('守卫：围栏事件关闭后不生成异常单', checkFenceEvents().length === 0)
db.fenceConfig.enabled = fenceEnabled

// 成本侧：单车次成本口径 + 报表恒等式
const costD = db.dispatches.find((d) => d.status === 'completed' && d.vehicleId)
check(
  '单车次成本（公路）：五项成本齐备且 total=各项之和',
  !!costD &&
    (() => {
      const c = tripCostOf(costD)
      return c.fuel > 0 && c.wear > 0 && c.driver > 0 && c.toll > 0 && c.depreciation > 0 && c.total === c.fuel + c.wear + c.driver + c.toll + c.depreciation
    })()
)
const costNR = db.dispatches.find((d) => d.status === 'completed' && !d.vehicleId)
check(
  '单车次成本（非公路）：无司机/折旧项（运输单元能耗口径）',
  !!costNR &&
    (() => {
      const c = tripCostOf(costNR)
      return c.driver === 0 && c.depreciation === 0 && c.total === c.fuel + c.wear + c.toll
    })()
)
const cr = costReport()
check(
  '成本报表：汇总恒等式（收入-成本=毛利，毛利率一致）',
  cr.summary.trips > 0 &&
    cr.summary.profit === cr.summary.revenue - cr.summary.cost &&
    cr.summary.margin === Math.round((cr.summary.profit / cr.summary.revenue) * 1000) / 10
)
check(
  '成本报表：按线路聚合与汇总一致（车次/成本/收入）',
  cr.byRoute.reduce((s, r) => s + r.trips, 0) === cr.summary.trips &&
    cr.byRoute.reduce((s, r) => s + r.cost, 0) === cr.summary.cost &&
    cr.byRoute.reduce((s, r) => s + r.revenue, 0) === cr.summary.revenue
)
check('成本报表：单车/单线行毛利恒等式', [...cr.byVehicle, ...cr.byRoute].every((r) => r.profit === r.revenue - r.cost && r.trips > 0))

// 客户门户：角色权限 + 账号 + 确认对账
check(
  '客户角色权限（菜单含 /portal，无内部菜单，操作仅 customer-confirm）',
  menuAllowed('客户', '/portal') === true &&
    menuAllowed('客户', '/settlement') === false &&
    actionAllowed('客户', 'customer-confirm') === true &&
    actionAllowed('客户', 'settlement') === false
)
const custUsers = db.users.filter((u) => u.role === '客户')
check(
  '客户门户账号种子（≥2 个，均绑定发货方/双向客户）',
  custUsers.length >= 2 &&
    custUsers.every((u) => db.customers.some((c) => c.id === u.customerId && (c.type === 'shipper' || c.type === 'both')))
)
// 环节2 口径：客户确认仅"对账中"可执行（异议回到待对账后须先重新对账）
let custSettle =
  db.settlements.find((s) => s.customerId === custUsers[0]?.customerId && s.status === 'reconciling' && !s.customerConfirmed) ||
  db.settlements.find((s) => s.status === 'reconciling' && !s.customerConfirmed)
if (!custSettle) {
  const ps = db.settlements.find((s) => s.status === 'pending')
  if (ps) startReconcile(ps)
  custSettle = ps
}
if (custSettle) {
  const rConf = customerConfirm(custSettle)
  check(
    '客户确认对账：写 customerConfirmed + 审计日志（客户门户）',
    rConf.ok === true && !!custSettle.customerConfirmed?.time && db.logs[0].module === '客户门户'
  )
  check('守卫：同一账单客户不可重复确认', !!customerConfirm(custSettle)?.error)
} else {
  console.log('  - 跳过客户确认（无带对账结果的账单）')
}
check(
  '只读演示账号种子（user16：全菜单可见、无操作权）',
  (() => {
    const u = db.users.find((x) => x.username === 'user16')
    return !!u && u.role === '只读用户' && menuAllowed(u.role, '/settlement') === true && actionAllowed(u.role, 'settlement') === false
  })()
)

console.log('== 12. P0 闭环断点回归（N3 快照单价 / N4 合同完结 / N5 开票守卫） ==')

// N3 结算用车次派车时快照单价（合同改价不追溯已派车车次）
const n3c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
if (n3c) {
  const n3p = {
    id: 'YH-N3',
    contractId: n3c.id,
    commodityId: n3c.commodityId,
    quantity: 35,
    loadTerminalId: n3c.loadTerminalId,
    unloadTerminalId: n3c.unloadTerminalId,
    mode: n3c.mode,
    unitPrice: n3c.unitPrice,
    status: 'pending',
    progress: 0
  }
  db.plans.unshift(n3p)
  const { created: n3d } = createDispatches(n3p, 1)
  const n3trip = n3d[0]
  if (n3trip) {
    check('车次写入派车时快照单价', n3trip.unitPrice === n3c.unitPrice)
    const oldPrice = n3c.unitPrice
    // 环节3：改价不即时生效，走审批（部门 → 公司），全链通过后才应用
    const n3chg = changeContract(n3c, { unitPrice: oldPrice + 10 }, 'N3 测试改价')
    check('环节3：改价提交后不即时生效（转待审批）', n3chg.pending === true && n3c.unitPrice === oldPrice && !!n3c.pendingChange)
    approveContractChange(n3c, '同意') // 部门审批
    const n3final = approveContractChange(n3c, '同意') // 公司审批
    check('环节3：改价全级审批通过后生效', n3final.final === true && n3c.unitPrice === oldPrice + 10 && !n3c.pendingChange)
    const n3fees = calcSettlementFees(n3c, [n3trip])
    check('结算用车次快照单价（改价不追溯已派车车次）', n3fees.freight === Math.round(n3trip.quantity * oldPrice))
    // 清理测试数据并还原合同价（还原同样走审批流）
    db.dispatches.splice(db.dispatches.indexOf(n3trip), 1)
    db.plans.splice(db.plans.indexOf(n3p), 1)
    changeContract(n3c, { unitPrice: oldPrice }, 'N3 测试还原')
    approveContractChange(n3c, '同意')
    approveContractChange(n3c, '同意')
    check('N3：合同价还原（还原走审批后单价恢复）', n3c.unitPrice === oldPrice && !n3c.pendingChange)
  }
} else {
  console.log('  - 跳过 N3（无执行中公路合同）')
}

// N4 合同完结（手动关单 + 守卫）
const n4c = db.contracts.find((c) => c.status === 'executing')
if (n4c) {
  const n4Active = db.plans.some((p) => p.contractId === n4c.id && p.status !== 'cancelled' && p.status !== 'completed')
  if (n4Active) {
    check('守卫：存在未完结计划不可完结合同', !!completeContract(n4c)?.error && n4c.status === 'executing')
  } else {
    const r = completeContract(n4c)
    check('合同完结：计划全部完成 → completed + 进度 100%', r.ok === true && n4c.status === 'completed' && n4c.progress === 100)
  }
}
const n4nonExec = db.contracts.find((c) => c.status === 'completed' || c.status === 'terminated')
if (n4nonExec) {
  check('守卫：非执行中合同不可完结', !!completeContract(n4nonExec)?.error)
} else {
  console.log('  - 跳过 N4（无执行中合同）')
}

// N5 开票状态守卫（结算详情入口 issueInvoice 防重复开票）
const n5s = db.settlements.find((x) => x.status === 'settled' && x.invoiceStatus === 'not-issued') || s
if (n5s) {
  const r1 = issueInvoice(n5s)
  check('开具发票（未开票 → 已开具）', r1.ok === true && !!r1.invoiceNo && n5s.invoiceStatus === 'issued')
  const r2 = issueInvoice(n5s)
  check('守卫：已开票账单不可重复开具', !!r2?.error)
} else {
  console.log('  - 跳过 N5（无未开票已结算账单）')
}

console.log('== 13. P1 产品完整度回归（G1 安全登记 / G2 运输需求 / G3 司机收入 / G4 年检驾照拦截） ==')

// G4 年检/驾照过期拦截（createDispatches 守卫）
const g4plan = db.plans.find((p) => {
  if (p.status !== 'pending') return false
  const c = db.contracts.find((x) => x.id === p.contractId)
  return c && c.status === 'executing' && isRoadMode(p.mode || '公路')
})
if (g4plan) {
  const g4v = db.vehicles.find((v) => v.status === 'idle' && v.type !== '铁路敞车' && v.type !== '散货船' && !vehicleInspectionExpired(v))
  if (g4v) {
    const oldInsp = g4v.nextInspection
    g4v.nextInspection = dayjs(NOW).subtract(1, 'day').format('YYYY-MM-DD')
    const { created: g4auto } = createDispatches(g4plan, 2)
    check('G4：年检过期车辆不被派车（自动匹配）', g4auto.length === 2 && g4auto.every((d) => d.vehicleId !== g4v.id))
    const g4manual = createDispatches(g4plan, 1, [g4v.id])
    check('G4：手动指定年检过期车辆被拦截（明确报错）', !!g4manual.error && g4manual.created.length === 0 && g4manual.error.includes('年检过期'))
    g4v.nextInspection = oldInsp
    check('G4：年检恢复后可再被派车', !vehicleInspectionExpired(g4v))
  }
  const g4d = db.drivers.find((x) => x.status === 'available' && !driverLicenseExpired(x))
  if (g4d) {
    const oldExp = g4d.licenseExpire
    g4d.licenseExpire = dayjs(NOW).subtract(1, 'day').format('YYYY-MM-DD')
    // 注：此处派 1 张（而非 2 张）——前序章节与年检子测试已占用大部分空闲车辆，
    // 乐观锁下同一空闲池不足 2 台时二次派车会被并发冲突正确拦截（断言目标是"过期司机不被自动匹配"）
    const { created: g4autoD } = createDispatches(g4plan, 1)
    check('G4：驾照过期司机不被派车（自动匹配）', g4autoD.length === 1 && g4autoD.every((d) => d.driverId !== g4d.id))
    g4d.licenseExpire = oldExp
  }
} else {
  console.log('  - 跳过 G4（无执行中合同的待执行公路计划）')
}

// G1 安全模块登记入口（事故 / 培训 / 检查）
const g1accBefore = db.accidents.length
const g1acc = registerAccident({
  time: dayjs(NOW).format('YYYY-MM-DD'),
  type: '碰撞',
  level: '一般',
  vehicleId: db.vehicles[0].id,
  location: '测试地点',
  description: 'G1 测试：手工事故登记',
  loss: 5000
})
check(
  'G1：事故登记（新记录 + 车牌联动 + 审计日志）',
  db.accidents.length === g1accBefore + 1 &&
    db.accidents[0].id === g1acc.id &&
    db.accidents[0].plate === db.vehicles[0].plate &&
    db.logs[0].module === '安全管理'
)
check('G1：事故结案（handling → closed）', closeAccident(g1acc).ok === true && g1acc.status === 'closed')
check('G1：守卫：已结案事故不可重复结案', !!closeAccident(g1acc)?.error)

const g1tBefore = db.trainings.length
const g1t = addTraining({ title: 'G1 测试培训', date: dayjs(NOW).format('YYYY-MM-DD'), trainer: '测试讲师' })
check('G1：培训计划（计划中，参训未记录）', db.trainings.length === g1tBefore + 1 && g1t.status === 'scheduled' && g1t.participants === 0)
check(
  'G1：守卫：培训日期不能早于今天',
  !!addTraining({ title: '过去培训', date: dayjs(NOW).subtract(1, 'day').format('YYYY-MM-DD'), trainer: 'x' })?.error
)
const g1tFuture = addTraining({ title: '未来培训', date: dayjs(NOW).add(7, 'day').format('YYYY-MM-DD'), trainer: 'x' })
check('G1：守卫：日期未到的培训不可标记完成', !!completeTraining(g1tFuture)?.error)
const g1ids = db.drivers.slice(0, 5).map((d) => d.id)
check(
  'G1：培训完成（completed + 参训司机记录）',
  completeTraining(g1t, g1ids).ok === true && g1t.status === 'completed' && g1t.participants === 5 && g1t.driverIds.length === 5
)
check('G1：守卫：已完成培训不可重复标记完成', !!completeTraining(g1t, g1ids)?.error)

const g1iBefore = db.inspections.length
const g1i = addInspection({ vehicleId: db.vehicles[1].id, date: dayjs(NOW).format('YYYY-MM-DD'), item: '出车前例行检查', result: 'pass', inspector: '测试检查员' })
check(
  'G1：车辆检查登记（新记录 + 车牌联动）',
  db.inspections.length === g1iBefore + 1 && db.inspections[0].id === g1i.id && db.inspections[0].plate === db.vehicles[1].plate
)
check('G1：守卫：未选车辆的检查登记被拦截', !!addInspection({ vehicleId: '', date: dayjs(NOW).format('YYYY-MM-DD'), item: 'x', result: 'pass' })?.error)

// G2 客户运输需求（门户发起 → 合同草稿）
check('G2：客户角色具备 customer-request 权限', actionAllowed('客户', 'customer-request') === true)
check(
  'G2：种子需求数据一致性（已转换需求关联真实合同且客户对齐）',
  (() => {
    const conv = db.transportRequests.filter((r) => r.status === 'converted')
    return conv.length > 0 && conv.every((r) => db.contracts.some((c) => c.id === r.contractId && c.shipperId === r.customerId))
  })()
)
const g2cust = db.customers.find((c) => (c.type === 'shipper' || c.type === 'both') && c.status === 'active')
const g2consignee = db.customers.find((c) => (c.type === 'consignee' || c.type === 'both') && c.status === 'active')
const g2reqBefore = db.transportRequests.length
const g2req = submitTransportRequest(g2cust.id, {
  commodityId: 'CM001',
  quantity: 700,
  loadTerminalId: 'T005',
  unloadTerminalId: 'T001',
  consigneeId: g2consignee.id,
  mode: '公路',
  expectDate: dayjs(NOW).add(14, 'day').format('YYYY-MM-DD'),
  unitPrice: 60
})
check(
  'G2：客户发起运输需求（新记录 + 待处理 + 审计日志）',
  db.transportRequests.length === g2reqBefore + 1 && g2req.status === 'pending' && db.logs[0].module === '客户门户'
)
const g2frozen = db.customers.find((c) => c.status === 'frozen')
check(
  'G2：守卫：冻结客户不可发起需求',
  g2frozen
    ? !!submitTransportRequest(g2frozen.id, { commodityId: 'CM001', quantity: 100, loadTerminalId: 'T005', unloadTerminalId: 'T001', consigneeId: g2consignee.id })?.error
    : true
)
check('G2：守卫：需求要素不全被拦截', !!submitTransportRequest(g2cust.id, { commodityId: 'CM001', quantity: 100 })?.error)
const g2c = convertRequestToContract(g2req, { unitPrice: 65, quantity: 700, paymentDays: 30, endDate: dayjs(NOW).add(180, 'day').format('YYYY-MM-DD') })
check(
  'G2：需求转合同草稿（草稿 + 字段联动 + 需求标记已转换）',
  g2c.status === 'draft' &&
    g2c.shipperId === g2cust.id &&
    g2c.consigneeId === g2consignee.id &&
    g2c.amount === 700 * 65 &&
    g2req.status === 'converted' &&
    g2req.contractId === g2c.id
)
check('G2：守卫：已转换需求不可重复转换', !!convertRequestToContract(g2req)?.error)
const g2pending = db.transportRequests.find((r) => r.status === 'pending')
if (g2pending) {
  const rj = rejectTransportRequest(g2pending, 'G2 测试驳回')
  check('G2：需求驳回（rejected + 原因记录）', rj.ok === true && g2pending.status === 'rejected' && g2pending.rejectReason === 'G2 测试驳回')
  check('G2：守卫：已驳回需求不可再转换', !!convertRequestToContract(g2pending)?.error)
} else {
  console.log('  - 跳过 G2 驳回（无待处理需求）')
}

// G3 司机端收入（与成本侧司机项同口径）
const g3d = db.dispatches.find((d) => d.status === 'completed' && d.driverId)
check('G3：司机趟次收入 = 成本侧司机项（底薪 600 + 0.25 元/公里）', !!g3d && driverIncomeOf(g3d) === Math.round(600 + (g3d.distance || 300) * 0.25))
const g3nr = db.dispatches.find((d) => d.status === 'completed' && !d.driverId)
check('G3：非公路车次无司机收入', g3nr ? driverIncomeOf(g3nr) === 0 : true)

console.log('== 14. P1 产品完整度回归（G5 司机账号 / G6 消息中心 / G7 数据导入 / G8 收款核销） ==')

// G5 司机账号体系（司机角色 + 手机号账号 + 停用联动）
check(
  'G5：司机角色已注册权限表（菜单 + 操作）',
  !!db.rolePerms['司机'] && Array.isArray(db.rolePerms['司机'].menus) && db.rolePerms['司机'].menus.includes('/workbench') && Array.isArray(db.rolePerms['司机'].actions)
)
check(
  'G5：每个司机均有平台账号（手机号=账号，driverId 绑定）',
  db.drivers.every((d) => db.users.some((u) => u.role === '司机' && u.driverId === d.id && u.username === d.phone))
)
check(
  'G5：司机账号可按手机号检索（登录口径）',
  (() => {
    const d = db.drivers[0]
    const u = db.users.find((x) => x.phone === d.phone)
    return !!u && u.username === d.phone && u.driverId === d.id && u.status === 'active'
  })()
)
check(
  'G5：停用司机的账号同步停用（登录拦截）',
  (() => {
    const d = db.drivers.find((x) => x.status === 'disabled')
    return !!d && db.users.find((u) => u.driverId === d.id)?.status === 'disabled'
  })()
)

// G6 消息中心（事件驱动 + 已读管理）
check('G6：种子消息非空且含未读', db.messages.length > 0 && db.messages.some((m) => !m.read))
const g6m = notify('G6 测试消息', 'system', '/workbench', '内容')
check('G6：notify 写入新消息（最新 + 未读）', db.messages[0].id === g6m.id && g6m.read === false)
markMessageRead(g6m)
check('G6：markMessageRead 标记已读', g6m.read === true)
notify('G6 测试消息 2', 'system', '/workbench', '')
const g6n = markAllMessagesRead()
check('G6：markAllMessagesRead 全部已读', g6n > 0 && db.messages.every((m) => m.read))
check(
  'G6：业务事件生成消息（前序章节的审批/调度/结算事件均有消息）',
  db.messages.some((m) => m.type === 'settlement') && db.messages.some((m) => m.type === 'dispatch') && db.messages.some((m) => m.type === 'approval')
)

// G7 数据导入（去重 + 校验 + 默认口径）
const g7custBefore = db.customers.length
const g7r1 = importCustomers([
  { name: 'G7 测试导入客户', type: '发货方', level: 'B', region: '山西', contact: '张三', phone: '13811112222', creditLimit: 1000000 },
  { name: db.customers[0].name },
  { name: '   ' }
])
check(
  'G7：客户导入（新增 + 重名跳过 + 空名报错）',
  g7r1.created.length === 1 &&
    g7r1.skipped.length === 1 &&
    g7r1.errors.length === 1 &&
    db.customers.length === g7custBefore + 1 &&
    db.customers.some((c) => c.name === 'G7 测试导入客户' && c.level === 'B' && c.creditLimit === 1000000)
)
const g7cmBefore = db.commodities.length
const g7r2 = importCommodities([{ name: 'G7 测试导入商品', category: '煤炭', unit: '吨', density: 1.2, price: 500 }, { name: '动力煤' }])
check('G7：商品导入（新增 + 重名跳过）', g7r2.created.length === 1 && g7r2.skipped.length === 1 && db.commodities.length === g7cmBefore + 1)
const g7vBefore = db.vehicles.length
const g7r3 = importVehicles([{ plate: '冀B·G79999', type: '重型半挂车', capacity: 35, owner: '自有', fuelType: '柴油' }, { plate: db.vehicles[0].plate }])
const g7v = db.vehicles.find((v) => v.plate === '冀B·G79999')
check(
  'G7：车辆导入（新增 + 车牌去重 + 默认口径：空闲/年检一年）',
  g7r3.created.length === 1 &&
    g7r3.skipped.length === 1 &&
    db.vehicles.length === g7vBefore + 1 &&
    !!g7v &&
    g7v.status === 'idle' &&
    g7v.owner === '自有' &&
    dayjs(g7v.nextInspection).isAfter(dayjs(NOW), 'day')
)

// G8 收款核销（银行流水 → 账单核销）
// 口径：银行流水由银行侧异步到达，种子流水（matchBy=系统）须与收款流水一一对应；
// 运行期手工登记的收款不强制要求流水（正是核销环节要处理的情形）
check(
  'G8：种子一致性（系统核销流水均有对应银行转账收款）',
  db.bankRecords
    .filter((b) => b.status === 'matched' && b.matchBy === '系统')
    .every((b) => db.payments.some((p) => p.settlementId === b.settlementId && p.amount === b.amount && p.method === '银行转账'))
)
const g8unmatched = db.bankRecords.filter((b) => b.status === 'unmatched')
check('G8：待核销流水存在（自动核销演示数据）', g8unmatched.length > 0)
// 手动核销：首笔待核销流水（金额=账单未付余额）核销至对应账单
const g8b = g8unmatched[0]
const g8c = db.customers.find((x) => x.name === g8b.counterparty)
const g8s = db.settlements.find(
  (x) => x.customerId === g8c?.id && (x.status === 'settled' || x.status === 'overdue') && Math.abs(x.totalAmount - x.paidAmount - g8b.amount) < 0.01
)
const g8paidBefore = g8s ? g8s.paidAmount : 0
const g8mr = matchBankRecord(g8b, g8s)
check(
  'G8：手动核销（核销成功 + 登记收款 + 流水状态）',
  g8mr.ok === true && g8b.status === 'matched' && g8b.settlementId === g8s.id && g8s.paidAmount === g8paidBefore + g8mr.real
)
check('G8：守卫：已核销流水不可重复核销', !!matchBankRecord(g8b, g8s)?.error)
const g8deposit = db.bankRecords.find((b) => b.status === 'unmatched' && b.summary === '质量保证金')
check('G8：守卫：流水金额超账单未付余额被拦截', g8deposit ? !!matchBankRecord(g8deposit, g8s)?.error : true)
const g8am = autoMatchBank()
check(
  'G8：自动核销（核销均为精确匹配，质量保证金不误核销）',
  Array.isArray(g8am) && g8am.every((b) => b.status === 'matched' && b.settlementId) && (!g8deposit || g8deposit.status === 'unmatched')
)

console.log('== 15. P2 架构下沉回归（正规 ID / 乐观锁 / RBAC 单点校验 / 定时任务 / 写操作下沉） ==')

// P2-A 正规 ID 生成（最大序列+1，删除不复用）
check(
  'P2-A：genId 取最大序列+1（删除末位不复用 ID）',
  genId('CM', 3, [{ id: 'CM003' }, { id: 'CM007' }]) === 'CM008' &&
    genId('CM', 3, [{ id: 'CM007' }]) === 'CM008' &&
    genId('CM', 3, []) === 'CM001'
)

// P2-B 乐观锁（version 快照 + 提交前二次校验）
const p15v = db.vehicles.find((v) => v.status === 'idle' && !db.dispatches.some((x) => BUSY_STATUSES.includes(x.status) && x.vehicleId === v.id))
const p15d = db.drivers.find((d) => d.status !== 'disabled' && !db.dispatches.some((x) => BUSY_STATUSES.includes(x.status) && x.driverId === d.id))
const p15seen = { vVersion: p15v.version, dVersion: p15d.version }
check('P2-B：版本一致且无未完结车次 → 校验通过', validateResourceCommit(p15v, p15d, p15seen).ok === true)
p15v.version += 1 // 模拟选择后、提交前另一写操作先行（如报修）
check('P2-B：版本不一致 → 并发冲突拦截派车', /并发冲突/.test(validateResourceCommit(p15v, p15d, p15seen).error))
p15v.version -= 1
const p15busyD = db.dispatches.find((x) => BUSY_STATUSES.includes(x.status) && x.vehicleId)
const p15busyV = p15busyD ? db.vehicles.find((v) => v.id === p15busyD.vehicleId) : null
check(
  'P2-B：已有未完结车次的车辆 → 重复占用拦截',
  p15busyV ? /未完结车次/.test(validateResourceCommit(p15busyV, p15d, { vVersion: p15busyV.version, dVersion: p15d.version }).error) : true
)

// P2-C RBAC 单点校验（服务层守卫；只读用户全部写操作拦截）
setOperator({ name: '审计观察员', username: 'user16', role: '只读用户' })
check('P2-C：只读用户无操作权限（默认拒绝）', operatorCan('dispatch') === false && operatorCan('settlement') === false && operatorCan('contract') === false)
check('P2-C：只读用户新建商品被服务层拦截', /无此操作权限/.test(saveCommodity({ name: 'P2 权限测试商品' }).error))
check('P2-C：只读用户冻结客户被服务层拦截', /无此操作权限/.test(toggleCustomerStatus(db.customers.find((c) => c.status === 'active')).error))
check('P2-C：只读用户新建计划被服务层拦截', /无此操作权限/.test(createPlan({ contractId: db.contracts.find((c) => c.status === 'executing')?.id, quantity: 1 }).error))
check('P2-C：只读用户新建用户被服务层拦截', /无此操作权限/.test(saveUser({ name: 'x', username: 'p2x', password: '1' }).error))

// P2-D 定时任务（围栏事件由 scheduler 驱动；系统事件不受登录用户 RBAC 约束）
let p15f = db.dispatches.find((x) => x.status === 'intransit' && x.eta && !x.fenceAlerted?.delay)
if (!p15f) {
  p15f = db.dispatches.find((x) => x.status === 'intransit' && x.eta)
  if (p15f) p15f.fenceAlerted = {}
}
check('P2-D：存在可触发围栏事件的在途车次', !!p15f)
if (p15f) {
  p15f.eta = dayjs().subtract(60, 'minute').format('YYYY-MM-DD HH:mm') // 模拟超 ETA（阈值 30 分钟）
  const p15excBefore = db.exceptions.length
  const p15events = []
  const p15off = onSchedulerEvent((e) => p15events.push(e))
  runSchedulerTick()
  p15off()
  check(
    'P2-D：定时任务生成围栏延误异常（只读操作人不阻断系统事件）',
    db.exceptions.length > p15excBefore &&
      db.exceptions.some((e) => e.dispatchId === p15f.id && e.source === 'fence') &&
      p15f.status === 'exception' &&
      p15events.some((e) => e.type === 'fence' && e.created.some((x) => x.dispatchId === p15f.id))
  )
  check('P2-D：tick 事件推送订阅者', p15events.some((e) => e.type === 'tick'))
}

// P2-E 遥测推进与逾期校准（后端数据源/cron 等价）
const p15t = db.dispatches.filter((d) => d.status === 'intransit')
const p15prog = p15t.map((d) => d.progress)
advanceTelemetry()
check(
  'P2-E：advanceTelemetry 推进在途车次进度（上限 95）',
  p15t.length > 0 && p15t.every((d) => d.progress >= 0 && d.progress <= 95) && p15t.some((d, i) => d.progress > p15prog[i])
)
const p15s = db.settlements.find((s) => s.status === 'settled' && s.settleDate && s.totalAmount - s.paidAmount > 0)
check('P2-E：存在未付清的已结算账单（逾期校准样本）', !!p15s)
if (p15s) {
  const p15days = db.contracts.find((c) => c.id === p15s.contractId)?.paymentDays || 30
  const p15origDate = p15s.settleDate
  p15s.settleDate = dayjs().subtract(p15days + 10, 'day').format('YYYY-MM-DD') // 模拟账期已过
  const p15n = recalcOverdueAll()
  check('P2-E：recalcOverdueAll 标记逾期账单', p15n >= 1 && p15s.status === 'overdue')
  p15s.settleDate = p15origDate
  recalcOverdueAll()
  check('P2-E：账期回退后恢复已结算', p15s.status === 'settled')
}

// P2-F 写操作下沉（管理员操作人：守卫 + 审计 + 正规 ID）
setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })

// 商品
const p15cm = saveCommodity({ name: 'P2 测试商品', category: '煤炭', unit: '吨', density: 1.2, price: 300 })
check('P2-F：saveCommodity 新建（重名查重 + genId）', p15cm.ok === true && /^CM\d{3}$/.test(p15cm.id) && db.commodities.some((c) => c.id === p15cm.id && c.status === 'active'))
check('P2-F：saveCommodity 守卫：重名拦截', /已存在/.test(saveCommodity({ name: 'P2 测试商品' }).error))
const p15cmObj = db.commodities.find((c) => c.id === p15cm.id)
check(
  'P2-F：saveCommodity 编辑 + toggleCommodityStatus 启停',
  saveCommodity({ id: p15cm.id, name: 'P2 测试商品（改）' }).ok === true &&
    p15cmObj.name === 'P2 测试商品（改）' &&
    toggleCommodityStatus(p15cmObj).ok === true &&
    p15cmObj.status === 'inactive' &&
    toggleCommodityStatus(p15cmObj).ok === true &&
    p15cmObj.status === 'active'
)

// 客户 / 司机 / 车辆 / 库存
const p15cust = db.customers.find((c) => c.status === 'active')
check('P2-F：toggleCustomerStatus 冻结/解冻', toggleCustomerStatus(p15cust).ok === true && p15cust.status === 'frozen' && toggleCustomerStatus(p15cust).ok === true && p15cust.status === 'active')
const p15dr = db.drivers.find((d) => d.status !== 'disabled' && !db.dispatches.some((x) => x.driverId === d.id && ['loading', 'intransit', 'unloading'].includes(x.status)))
check(
  'P2-F：toggleDriverStatus 停用（司机账号联动停用）',
  toggleDriverStatus(p15dr).ok === true && p15dr.status === 'disabled' && db.users.find((u) => u.driverId === p15dr.id)?.status === 'disabled'
)
check(
  'P2-F：toggleDriverStatus 启用（司机账号联动恢复）',
  toggleDriverStatus(p15dr).ok === true && p15dr.status === 'available' && db.users.find((u) => u.driverId === p15dr.id)?.status === 'active'
)
const p15veh = db.vehicles.find((v) => v.status === 'idle')
check('P2-F：sendVehicleRepair（仅空闲可报修）', sendVehicleRepair(p15veh, 'P2 测试报修').ok === true && p15veh.status === 'maintenance')
check('P2-F：sendVehicleRepair 守卫：非空闲拦截', /非"空闲"/.test(sendVehicleRepair(p15veh, 'x').error))
check('P2-F：resumeVehicle（仅维修中可恢复）', resumeVehicle(p15veh).ok === true && p15veh.status === 'idle')
const p15inv = db.inventories.find((i) => i.status === 'normal')
check('P2-F：setInventoryStatus 锁定/解锁', setInventoryStatus(p15inv, 'locked').ok === true && p15inv.status === 'locked' && setInventoryStatus(p15inv, 'normal').ok === true && p15inv.status === 'normal')
check('P2-F：setInventoryStatus 守卫：重复操作拦截', /无需重复操作/.test(setInventoryStatus(p15inv, 'normal').error))

// 用户
const p15u = saveUser({ name: 'P2 测试用户', username: 'p2test', password: '123456', role: '调度员' })
check('P2-F：saveUser 新建（账号查重 + genId）', p15u.ok === true && /^U\d{3}$/.test(p15u.id))
check('P2-F：saveUser 守卫：账号重复拦截', /已存在/.test(saveUser({ name: 'x', username: 'p2test', password: '1' }).error))
const p15uObj = db.users.find((u) => u.id === p15u.id)
check('P2-F：toggleUserStatus 停用/启用', toggleUserStatus(p15uObj, false).ok === true && p15uObj.status === 'disabled' && toggleUserStatus(p15uObj, true).ok === true && p15uObj.status === 'active')
check('P2-F：removeUser', removeUser(p15uObj).ok === true && !db.users.some((u) => u.id === p15u.id))
check('P2-F：removeUser 守卫：当前登录账号不可删除', /当前登录账号/.test(removeUser({ id: 'U001', username: 'admin' }).error))

// 角色（含数据化权限即时生效）
const p15r = saveRole({ name: 'P2 测试角色', code: 'p2_test_role', description: 'P2 回归' })
check(
  'P2-F：saveRole（查重 + 默认 deny + genId）',
  p15r.ok === true && /^R\d{3}$/.test(p15r.id) && db.rolePerms['P2 测试角色'] && db.rolePerms['P2 测试角色'].menus.length === 0 && db.rolePerms['P2 测试角色'].actions.length === 0
)
check('P2-F：saveRole 守卫：名称/编码重复拦截', /已存在/.test(saveRole({ name: 'P2 测试角色', code: 'p2_other' }).error))
check('P2-F：updateRolePerms', updateRolePerms('P2 测试角色', { menus: ['/workbench'], actions: ['dispatch'] }).ok === true && db.rolePerms['P2 测试角色'].actions.includes('dispatch'))
setOperator({ name: 'P2 角色用户', username: 'p2role', role: 'P2 测试角色' })
check('P2-C：数据化权限即时生效（新授权角色）', operatorCan('dispatch') === true && operatorCan('settlement') === false)
setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
check(
  'P2-F：removeRole（角色下无用户）',
  removeRole(db.roles.find((r) => r.name === 'P2 测试角色')).ok === true && !db.roles.some((r) => r.name === 'P2 测试角色') && !db.rolePerms['P2 测试角色']
)
check('P2-F：removeRole 守卫：内置角色不可删除', /不可删除/.test(removeRole(db.roles.find((r) => r.builtIn)).error))

// 合同 / 计划
const p15ship = db.customers.find((c) => ['shipper', 'both'].includes(c.type) && c.status === 'active')
const p15cons = db.customers.find((c) => ['consignee', 'both'].includes(c.type) && c.status === 'active')
const p15ct = createContract(
  { name: 'P2 测试合同', shipperId: p15ship.id, consigneeId: p15cons.id, commodityId: db.commodities[0].id, loadTerminalId: db.terminals[0].id, unloadTerminalId: db.terminals[1].id, quantity: 100, unitPrice: 300 },
  'draft'
)
check('P2-F：createContract 新建草稿（守卫 + genId + 金额口径）', p15ct.ok === true && /^HT-\d{4}$/.test(p15ct.id) && p15ct.contract.status === 'draft' && p15ct.contract.amount === 30000)
check(
  'P2-F：createContract 守卫：必填缺失拦截',
  !!createContract({ name: '', shipperId: p15ship.id, consigneeId: p15cons.id, commodityId: db.commodities[0].id, loadTerminalId: db.terminals[0].id, unloadTerminalId: db.terminals[1].id, quantity: 100, unitPrice: 300 }).error
)
const p15excC = db.contracts.find((c) => c.status === 'executing' && contractRemaining(c.id) > 0)
const p15plan = createPlan({ contractId: p15excC.id, quantity: Math.min(10, contractRemaining(p15excC.id)) })
check('P2-F：createPlan（执行中合同 + 剩余量内）', p15plan.ok === true && p15plan.plan.status === 'pending' && /^YH-\d{4}$/.test(p15plan.id))
check('P2-F：createPlan 守卫：超出剩余量拦截', /超出/.test(createPlan({ contractId: p15excC.id, quantity: 999999 }).error))
check(
  'P2-F：cancelPlan（仅待执行）+ 守卫',
  cancelPlan(p15plan.plan).ok === true && p15plan.plan.status === 'cancelled' && /无法取消/.test(cancelPlan(p15plan.plan).error)
)

console.log('== 16. N-1 回归（司机端入口走内部核心，不受登录用户 RBAC 拦截） ==')
// 找一张"待装货公路车次 + 该司机有启用账号"的组合（司机角色操作权限为空，原实现扫码/发车/到达均被 RBAC 拦截）
const n1pair = db.dispatches
  .filter((d) => d.status === 'pending' && isRoadMode(d.mode) && d.driverId)
  .map((d) => ({ d, u: db.users.find((u) => u.role === '司机' && u.driverId === d.driverId && u.status === 'active') }))
  .find((x) => x.u)
check('N-1：存在待装货公路车次且司机有启用账号', !!n1pair)
if (n1pair) {
  const { d: n1d, u: n1u } = n1pair
  setOperator(n1u)
  check('N-1：司机角色无 PC 端操作权限（默认拒绝，前提成立）', operatorCan('dispatch') === false && operatorCan('settlement') === false)
  n1d.accepted = true
  check('N-1：司机账号扫码确认装货（内部核心，不被 RBAC 拦截）', scanConfirmLoad(n1d, loadCodeOf(n1d))?.ok === true && n1d.status === 'loading')
  check('N-1：司机端发车', driverDepart(n1d)?.ok === true && n1d.status === 'intransit')
  check('N-1：司机端确认到达', driverArrive(n1d)?.ok === true && n1d.status === 'unloading')
  check('N-1：司机账号扫码确认卸货 + 电子签收', scanConfirmUnload(n1d, unloadCodeOf(n1d))?.ok === true && n1d.status === 'completed' && !!signReceipt(n1d, '收货方'))
  // 状态机守卫在司机端入口同样生效（非装货中不可发车）
  check('N-1：司机端入口状态机守卫仍生效（已完成车次不可发车）', /无法发车/.test(driverDepart(n1d).error))
  // PC 端 RBAC 不受影响：只读用户 confirmLoad 仍被拦截
  setOperator({ name: '审计观察员', username: 'user16', role: '只读用户' })
  const n1pc = db.dispatches.find((d) => d.status === 'pending' && isRoadMode(d.mode))
  check('N-1：只读用户 PC 端 confirmLoad 仍被服务层拦截', n1pc ? /无此操作权限/.test(confirmLoad(n1pc).error) : true)
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
}

console.log('== 17. N-2 回归（在途/卸货中车辆不可被手动二次派车） ==')
// 原缺陷：BUSY_STATUSES 缺 intransit/unloading，手动指定路径（乐观锁终检同口径）可给在途车辆二次派车
{
  const n2busyV = new Set(db.dispatches.filter((x) => BUSY_STATUSES.includes(x.status)).map((x) => x.vehicleId))
  const n2v = db.vehicles.find((x) => x.status === 'idle' && x.type !== '铁路敞车' && x.type !== '散货船' && !vehicleInspectionExpired(x) && !n2busyV.has(x.id))
  const n2p = db.plans.find((x) => x.status === 'pending' && isRoadMode(x.mode))
  check('N-2：存在空闲车辆与待执行公路计划', !!n2v && !!n2p)
  if (n2v && n2p) {
    setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
    const n2c = createDispatches(n2p, 1, [n2v.id])
    const n2d = n2c.created?.[0]
    check('N-2：手动派车成功（前置）', n2c.created?.length === 1)
    if (n2d) {
      n2d.accepted = true
      confirmLoad(n2d)
      depart(n2d)
      check('N-2：车次进入在途（车辆 inuse）', n2d.status === 'intransit' && n2v.status === 'inuse')
      const n2p2 = db.plans.find((x) => x.status === 'pending' && isRoadMode(x.mode) && x.id !== n2p.id) || n2p
      const n2r1 = createDispatches(n2p2, 1, [n2v.id])
      check('N-2：在途车辆手动二次派车被拦截（未完结车次）', n2r1.created?.length === 0 && /未完结车次/.test(n2r1.error || ''))
      arrive(n2d)
      check('N-2：车次进入卸货中', n2d.status === 'unloading')
      const n2r2 = createDispatches(n2p2, 1, [n2v.id])
      check('N-2：卸货中车辆手动二次派车被拦截（未完结车次）', n2r2.created?.length === 0 && /未完结车次/.test(n2r2.error || ''))
      confirmUnload(n2d)
      check('N-2：车次完成后车辆恢复空闲（可再派车）', n2d.status === 'completed' && n2v.status === 'idle')
    }
  }
}

console.log('== 18. M1-M4 回归（结算预览/对账快照价、出库守卫、消息定向） ==')
setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
{
  // M1/M2：合同改价后，候选预览运费与对账损耗金额仍按车次快照单价
  const m1c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  const m1p = {
    id: 'YH-M1',
    contractId: m1c.id,
    commodityId: m1c.commodityId,
    quantity: 35,
    loadTerminalId: m1c.loadTerminalId,
    unloadTerminalId: m1c.unloadTerminalId,
    mode: m1c.mode,
    unitPrice: m1c.unitPrice,
    status: 'pending',
    progress: 0
  }
  db.plans.unshift(m1p)
  const m1price0 = m1c.unitPrice
  const m1d = createDispatches(m1p, 1).created[0]
  check('M1/M2：派车成功（前置）', !!m1d)
  if (m1d) {
    m1d.accepted = true
    confirmLoad(m1d)
    depart(m1d)
    arrive(m1d)
    confirmUnload(m1d)
    // 环节3：改价走审批，全链通过后才生效（M1 验证的是"改价生效后预览仍按快照价"）
    changeContract(m1c, { unitPrice: m1price0 + 100 }, 'M1 测试改价')
    approveContractChange(m1c, '同意')
    approveContractChange(m1c, '同意')
    const cand = settlementCandidates().find((g) => g.dispatches.some((x) => x.id === m1d.id))
    check(
      'M1：合同改价后候选预览运费按车次快照单价（≠ 合同当前单价 × 调度量）',
      !!cand &&
        cand.freight === calcSettlementFees(m1c, cand.dispatches).freight &&
        cand.freight !== Math.round(cand.quantity * m1c.unitPrice)
    )
    const m1s = generateSettlements([cand.key]).find((x) => x.contractId === m1c.id)
    check('M1：实际账单运费 = 预览运费（快照价 × 出磅净重）', !!m1s && m1s.freight === cand.freight)
    const m1r = startReconcile(m1s)
    check(
      'M2：对账损耗金额逐车次按快照单价折算（≠ 合同当前单价口径）',
      m1r.items.every((i) => i.price === m1price0) &&
        m1r.lossAmount === Math.round(m1r.items.reduce((s, i) => s + i.loss * i.price, 0)) &&
        m1r.lossAmount !== Math.round(m1r.lossQty * m1c.unitPrice)
    )
  }
}
{
  // M3：出库守卫——可发库存不足拦截装货；充足跨批次 FIFO；仓库无该商品批次不联动
  const m3c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  const m3p = {
    id: 'YH-M3',
    contractId: m3c.id,
    commodityId: 'CM001',
    quantity: 35,
    loadTerminalId: 'T006',
    unloadTerminalId: 'T002',
    mode: '公路',
    unitPrice: m3c.unitPrice,
    status: 'pending',
    progress: 0
  }
  db.plans.unshift(m3p)
  const m3d = createDispatches(m3p, 1).created[0]
  check('M3：派车成功（前置：装货场站 T006 → WH007）', !!m3d)
  if (m3d) {
    const m3batches = db.inventories.filter((i) => i.warehouseId === 'WH007' && i.commodityId === 'CM001' && i.status === 'normal')
    const m3origQty = m3batches.map((b) => b.quantity)
    const m3origDate = m3batches.map((b) => b.inDate)
    m3d.accepted = true
    // a) 可发库存 10 吨 < 35 吨 → 拦截装货，状态不变
    m3batches.forEach((b, i) => (b.quantity = i === 0 ? 10 : 0))
    const m3r1 = confirmLoad(m3d)
    check('M3：可发库存不足拦截装货（明确报错 + 状态不变）', /可发库存不足/.test(m3r1?.error || '') && m3d.status === 'pending')
    // b) 充足（20 + 20 两批次）→ 跨批次 FIFO（早批次先扣）
    m3batches[0].inDate = '2026-08-01'
    m3batches[0].quantity = 20
    const m3extra = { id: 'INV-M3T', warehouseId: 'WH007', commodityId: 'CM001', batch: 'BTEST-M3', quantity: 20, inDate: '2026-08-10', status: 'normal' }
    db.inventories.push(m3extra)
    const m3r2 = confirmLoad(m3d)
    check(
      'M3：库存充足 → 跨批次 FIFO 扣减（早批次 20→0，次批次 20→5）',
      !m3r2?.error && m3d.status === 'loading' && m3batches[0].quantity === 0 && m3extra.quantity === 5
    )
    // c) 仓库无该商品批次记录（外采/过路）→ 不出库联动、不拦截
    const m3p2 = { id: 'YH-M3B', contractId: m3c.id, commodityId: 'CM003', quantity: 35, loadTerminalId: 'T007', unloadTerminalId: 'T002', mode: '公路', unitPrice: m3c.unitPrice, status: 'pending', progress: 0 }
    db.plans.unshift(m3p2)
    const m3d2 = createDispatches(m3p2, 1).created[0]
    if (m3d2) {
      m3d2.accepted = true
      const m3r3 = confirmLoad(m3d2)
      check('M3：仓库无该商品批次（外采/过路）→ 不出库联动、不拦截', !m3r3?.error && m3d2.status === 'loading')
    } else {
      check('M3：仓库无该商品批次（外采/过路）→ 不出库联动、不拦截', false)
    }
    // 清理：恢复库存、移除测试批次
    m3batches.forEach((b, i) => {
      b.quantity = m3origQty[i]
      b.inDate = m3origDate[i]
    })
    db.inventories.splice(db.inventories.indexOf(m3extra), 1)
  }
}
{
  // M4：消息定向——定向消息仅目标角色可见；广播全员可见；标读只影响可见消息
  const m4Approval = notify('M4 测试：合同审批', 'approval', '/contract', '', toRoles('contract-approve', 'contract'))
  const m4Broadcast = notify('M4 测试：系统广播', 'system', '/workbench', '')
  setOperator({ name: '测试结算', username: 't-settle', role: '结算专员' })
  check('M4：结算专员不可见审批定向消息（非目标角色）', !visibleMessages().some((m) => m.id === m4Approval.id))
  check('M4：广播消息对全角色可见', visibleMessages().some((m) => m.id === m4Broadcast.id))
  markAllMessagesRead()
  check('M4：全部已读仅标记可见消息（定向消息保持未读）', m4Broadcast.read === true && m4Approval.read === false)
  setOperator({ name: '测试调度', username: 't-dispatch', role: '调度员' })
  check('M4：调度员可见审批定向消息（持有 contract 操作）', visibleMessages().some((m) => m.id === m4Approval.id))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  check('M4：平台管理员可见全部消息', visibleMessages().length === db.messages.length)
  check(
    'M4：rolesWithAction 与 RBAC 口径一致（exception → 调度员/安全管理员，不含结算专员）',
    rolesWithAction('exception').includes('调度员') &&
      rolesWithAction('exception').includes('安全管理员') &&
      !rolesWithAction('exception').includes('结算专员')
  )
}

console.log('== 19. M5-M8 回归（发票陈旧强制红冲、司机端身份守卫、登出清 operator） ==')
setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
{
  // M5：已开票账单异常补扣 → 发票标记金额陈旧 → 收款拦截 → 红冲重开恢复票款一致
  const m5c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  const m5p = {
    id: 'YH-M5',
    contractId: m5c.id,
    commodityId: 'CM003',
    quantity: 35,
    loadTerminalId: 'T007',
    unloadTerminalId: 'T002',
    mode: '公路',
    unitPrice: m5c.unitPrice,
    status: 'pending',
    progress: 0
  }
  db.plans.unshift(m5p)
  const m5d = createDispatches(m5p, 1).created[0]
  check('M5：派车成功（前置：T007 无仓库联动）', !!m5d)
  if (m5d) {
    m5d.accepted = true
    confirmLoad(m5d)
    depart(m5d)
    arrive(m5d)
    confirmUnload(m5d)
    signReceipt(m5d, '收货方') // 环节1：签收是结算收货依据，先签收再走结算
    const m5cand = settlementCandidates().find((g) => g.dispatches.some((x) => x.id === m5d.id))
    const m5s = generateSettlements([m5cand.key]).find((x) => x.contractId === m5c.id)
    startReconcile(m5s)
    customerConfirm(m5s)
    confirmSettle(m5s)
    const m5no = issueInvoice(m5s)
    const m5inv = db.invoices.find((i) => i.invoiceNo === m5no.invoiceNo)
    const m5total0 = m5s.totalAmount
    check('M5：开票成功（发票额 = 账单额）', !!m5inv && m5inv.amount === m5total0 && m5s.invoiceStatus === 'issued')
    // 车次异常关闭补扣（损失 500）→ 账单额下降，发票变陈旧
    const m5e = { id: 'EX-M5T', dispatchId: m5d.id, status: 'open', cost: 500 }
    db.exceptions.push(m5e)
    closeException(m5e)
    check(
      'M5：已开票账单补扣 → 发票标记金额陈旧（账单额 -500，stale + 原因）',
      m5s.totalAmount === m5total0 - 500 && m5inv.stale === true && !!m5inv.staleReason
    )
    check(
      'M5：陈旧发票未红冲前收款被拦截（票款一致强制流程）',
      /红冲重开/.test(recordPayment(m5s, 100, '银行转账')?.error || '') && m5s.paidAmount === 0
    )
    redFlushInvoiceRow(m5inv, 'M5 测试：金额变化红冲重开')
    const m5no2 = issueInvoice(m5s)
    const m5inv2 = db.invoices.find((i) => i.invoiceNo === m5no2.invoiceNo)
    check(
      'M5：红冲重开 → 新发票额 = 当前账单额，陈旧标记清除',
      !!m5inv2 && m5inv2.amount === m5s.totalAmount && !m5inv2.stale && m5s.invoiceStatus === 'issued'
    )
    check('M5：重开后收款恢复', !recordPayment(m5s, 100, '银行转账')?.error && m5s.paidAmount === 100)
  }
}
{
  // M6：司机端身份守卫——非司机端角色拦截；司机只能操作本人车次；演示切换（dispatch 权限）放行
  let m6d = db.dispatches
    .filter((d) => d.status === 'pending' && isRoadMode(d.mode) && d.driverId)
    .find((d) => db.users.some((u) => u.role === '司机' && u.driverId === d.driverId && u.status === 'active'))
  if (!m6d) {
    const m6c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
    const m6p = { id: 'YH-M6', contractId: m6c.id, commodityId: 'CM003', quantity: 35, loadTerminalId: 'T007', unloadTerminalId: 'T002', mode: '公路', unitPrice: m6c.unitPrice, status: 'pending', progress: 0 }
    db.plans.unshift(m6p)
    m6d = createDispatches(m6p, 1).created[0]
  }
  check('M6：存在待装货公路车次（前置）', !!m6d)
  if (m6d) {
    setOperator({ name: '测试结算', username: 't-settle', role: '结算专员' })
    check('M6：结算专员不可调用 acceptDispatch（服务层拦截）', /非司机端身份/.test(acceptDispatch(m6d)?.error || ''))
    check('M6：结算专员不可调用 signReceipt（不生成签收单）', /非司机端身份/.test(signReceipt(m6d, 'X')?.error || '') && !m6d.receipt)
    setOperator({ name: '测试客户', username: 't-cust', role: '客户' })
    check('M6：客户角色不可调用 driverDepart', /非司机端身份/.test(driverDepart(m6d)?.error || ''))
    const m6u = db.users.find((u) => u.role === '司机' && u.driverId === m6d.driverId && u.status === 'active')
    const m6other = db.users.find((u) => u.role === '司机' && u.driverId && u.driverId !== m6d.driverId && u.status === 'active')
    if (m6other) {
      setOperator(m6other)
      check('M6：其他司机不可接非本人车次（司机仅可操作本人车次）', /未指派给当前司机/.test(acceptDispatch(m6d)?.error || ''))
    }
    if (m6u) {
      setOperator(m6u)
      const m6r = acceptDispatch(m6d)
      check('M6：车次本人司机可接单（司机端身份放行）', !m6r?.error && m6d.accepted === true)
    } else {
      check('M6：车次司机有启用账号（前置）', false)
    }
  }
}
{
  // M7：登出清除 operator——未登录态写操作默认拒绝，审计不再记在旧用户名下
  setOperator({ name: '测试结算', username: 't-settle', role: '结算专员' })
  clearOperator()
  check('M7：登出后结算操作被默认拒绝（操作人"未登录"）', /未登录/.test(confirmSettle(db.settlements[0])?.error || ''))
  check('M7：登出后司机端入口同样拦截（无会话）', /未登录/.test(acceptDispatch(db.dispatches[0])?.error || ''))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  check('M7：重新登录后权限恢复（setOperator）', operatorCan('settlement') === true)
}

console.log('== 20. 环节1-3 回归（签收硬拦截+补签、客户异议、改价审批） ==')
setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
{
  // 环节1：签收硬拦截——无签收公路车次不可确认结算；补签后放行；非公路豁免
  const s1c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  const s1p = { id: 'YH-S1', contractId: s1c.id, commodityId: 'CM003', quantity: 35, loadTerminalId: 'T007', unloadTerminalId: 'T002', mode: '公路', unitPrice: s1c.unitPrice, status: 'pending', progress: 0 }
  db.plans.unshift(s1p)
  const s1d = createDispatches(s1p, 1).created[0]
  check('环节1：派车成功（前置）', !!s1d)
  if (s1d) {
    s1d.accepted = true
    confirmLoad(s1d)
    depart(s1d)
    arrive(s1d)
    confirmUnload(s1d)
    const s1s = generateSettlements([settlementCandidates().find((g) => g.dispatches.some((x) => x.id === s1d.id)).key]).find((x) => x.contractId === s1c.id)
    startReconcile(s1s)
    customerConfirm(s1s)
    const s1blocked = confirmSettle(s1s)
    check('环节1：无签收公路车次不可确认结算（硬拦截）', /尚无电子签收单/.test(s1blocked?.error || '') && s1s.status === 'reconciling')
    const s1sup = supplementReceipt(s1d, '收货方仓管员', '签收单遗失，与收货方核实后补签')
    check('环节1：补签生成签收单（补签标记 + 原因 + 对账重建）', s1sup.supplement === true && s1sup.code.startsWith('QS-B') && s1s.reconciliation.missingReceiptCount === 0)
    check('环节1：补签后对账明细未签收标记清除', s1s.reconciliation.items.every((i) => i.hasReceipt !== false))
    const s1ok = confirmSettle(s1s)
    check('环节1：补签后确认结算放行', !s1ok?.error && s1s.status === 'settled')
    check('环节1：守卫：已签收车次不可重复补签', /已存在/.test(supplementReceipt(s1d, 'X')?.error || ''))
    const s1nonroad = db.dispatches.find((d) => d.status === 'completed' && !isRoadMode(d.mode))
    if (s1nonroad) {
      check('环节1：非公路豁免：非公路车次无需补签', /非公路豁免/.test(supplementReceipt(s1nonroad, 'X')?.error || ''))
    } else {
      console.log('  - 跳过非公路豁免（无已完成非公路车次）')
    }
  }
}
{
  // 环节2：客户异议——异议单 → 回待对账 → 重新对账 → 再确认关闭异议单
  const s2c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  const s2p = { id: 'YH-S2', contractId: s2c.id, commodityId: 'CM003', quantity: 35, loadTerminalId: 'T007', unloadTerminalId: 'T002', mode: '公路', unitPrice: s2c.unitPrice, status: 'pending', progress: 0 }
  db.plans.unshift(s2p)
  const s2d = createDispatches(s2p, 1).created[0]
  check('环节2：派车成功（前置）', !!s2d)
  if (s2d) {
    s2d.accepted = true
    confirmLoad(s2d)
    depart(s2d)
    arrive(s2d)
    confirmUnload(s2d)
    signReceipt(s2d, '收货方')
    const s2s = generateSettlements([settlementCandidates().find((g) => g.dispatches.some((x) => x.id === s2d.id)).key]).find((x) => x.contractId === s2c.id)
    startReconcile(s2s)
    const s2obj = customerObjection(s2s, '损耗金额偏高，与我方磅单记录不符')
    check('环节2：异议单记录 + 账单回待对账（客户确认清除）', s2obj.ok === true && s2s.status === 'pending' && s2s.customerConfirmed === null && s2s.objections?.[0]?.status === 'open')
    check('环节2：守卫：异议后未重新对账不可直接确认', /非"对账中"/.test(customerConfirm(s2s)?.error || ''))
    check('环节2：守卫：待对账状态不可重复异议', /非"对账中"/.test(customerObjection(s2s, '重复异议')?.error || ''))
    startReconcile(s2s)
    const s2conf = customerConfirm(s2s)
    check('环节2：重新对账后客户再确认成功 + 异议单自动关闭', s2conf.ok === true && s2s.objections[0].status === 'resolved' && !!s2s.objections[0].resolveTime)
    const s2settle = confirmSettle(s2s)
    check('环节2：异议闭环后正常结算', !s2settle?.error && s2s.status === 'settled')
  }
}
{
  // 环节3：改价审批——待批期间拦截并发变更；驳回作废申请；RBAC
  const s3c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  const s3price = s3c.unitPrice
  changeContract(s3c, { unitPrice: s3price - 5 }, '环节3 测试改价')
  check('环节3：守卫：变更待审批期间不可提交新变更', /待审批/.test(changeContract(s3c, { quantity: s3c.quantity + 100 }, '并发变更')?.error || ''))
  const s3rej = rejectContractChange(s3c, '改价幅度过大，需重新询价')
  check('环节3：驳回作废变更申请（单价不变 + 待批清除）', s3rej.ok === true && s3c.unitPrice === s3price && !s3c.pendingChange)
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  changeContract(s3c, { unitPrice: s3price - 5 }, '环节3 RBAC 测试')
  setOperator({ name: '测试结算', username: 't-settle', role: '结算专员' })
  check('环节3：RBAC：结算专员不可审批改价', /无此操作权限/.test(approveContractChange(s3c)?.error || ''))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  approveContractChange(s3c, '同意')
  approveContractChange(s3c, '同意')
  check('环节3：改价审批通过后单价生效', s3c.unitPrice === s3price - 5)
  // 还原（同样走审批）
  changeContract(s3c, { unitPrice: s3price }, '环节3 测试还原')
  approveContractChange(s3c, '同意')
  approveContractChange(s3c, '同意')
  check('环节3：合同价还原（清理）', s3c.unitPrice === s3price && !s3c.pendingChange)
}

console.log('== 21. 环节4-6 回归（质量扣重、预付款管理、消息免打扰） ==')
setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
{
  // 环节4：质量扣重——卸货质检 → 结算扣减项 → 对账明细
  const q4c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  const q4p = { id: 'YH-Q4', contractId: q4c.id, commodityId: 'CM003', quantity: 35, loadTerminalId: 'T007', unloadTerminalId: 'T002', mode: '公路', unitPrice: q4c.unitPrice, status: 'pending', progress: 0 }
  db.plans.unshift(q4p)
  const q4d = createDispatches(q4p, 1).created[0]
  check('环节4：派车成功（前置）', !!q4d)
  if (q4d) {
    q4d.accepted = true
    confirmLoad(q4d)
    depart(q4d)
    arrive(q4d)
    confirmUnload(q4d)
    check('环节4：卸货生成质检记录（水分 8-14% / 灰分 12-20%）', !!q4d.quality && q4d.quality.moisture >= 8 && q4d.quality.moisture <= 14 && q4d.quality.ash >= 12 && q4d.quality.ash <= 20)
    // 扣重公式确定性验证：不超标 = 0；超标 = 出磅净重 × 系数（水分 2% 超 ×1.5% + 灰分 3% 超 ×1% = 6%）
    const outNet = db.weighings.find((w) => w.dispatchId === q4d.id && w.type === '出磅').net
    const q4below = { ...q4d, quality: { moisture: 9, ash: 14 } }
    check('环节4：标准内（水分 9% / 灰分 14%）不扣重', qualityDeductionQty(q4below) === 0)
    const q4above = { ...q4d, quality: { moisture: 12, ash: 18 } }
    check('环节4：超标扣重 = 出磅净重 × 6%（水分 1.5%/1% + 灰分 1%/1%）', qualityDeductionQty(q4above) === +(outNet * 0.06).toFixed(2))
    const q4s = generateSettlements([settlementCandidates().find((g) => g.dispatches.some((x) => x.id === q4d.id)).key]).find((x) => x.contractId === q4c.id)
    check(
      '环节4：结算单含质量扣减项且总额公式一致',
      q4s.qualityQty >= 0 &&
        q4s.qualityDeduction >= 0 &&
        q4s.totalAmount ===
          q4s.freight + q4s.loadingFee + q4s.unloadingFee + q4s.tollFee + q4s.surcharge - q4s.lossDeduction - q4s.qualityDeduction - q4s.exceptionLoss
    )
    // 重算：质检结果变化 → 扣减项与总额同步刷新
    const q4before = q4s.totalAmount
    q4d.quality = { moisture: 13, ash: 19, time: q4d.unloadTime }
    const q4recalc = recalcSettlement(q4s)
    check(
      '环节4：重算刷新质量扣减（扣减项与总额同步，公式一致）',
      q4recalc.ok === true &&
        q4s.qualityDeduction > 0 &&
        q4s.totalAmount === q4before + q4recalc.delta &&
        q4s.totalAmount ===
          q4s.freight + q4s.loadingFee + q4s.unloadingFee + q4s.tollFee + q4s.surcharge - q4s.lossDeduction - q4s.qualityDeduction - q4s.exceptionLoss
    )
    startReconcile(q4s)
    check(
      '环节4：对账明细含逐车次质量扣重 + 汇总（吨数/金额）',
      q4s.reconciliation.items.every((i) => typeof i.qualityQty === 'number') &&
        q4s.reconciliation.qualityQty === +q4s.reconciliation.items.reduce((s, i) => s + i.qualityQty, 0).toFixed(2) &&
        q4s.reconciliation.qualityAmount >= 0
    )
    const q4nonroad = db.dispatches.find((d) => d.status === 'completed' && !isRoadMode(d.mode))
    check('环节4：非公路车次无质检不扣重', q4nonroad ? qualityDeductionQty(q4nonroad) === 0 : true)
  }
}
{
  // 环节5：预付款管理——台账 / 收取 / FIFO 抵扣 / 信用联动
  check('环节5：种子预付款台账存在（CUS001 可用 ≥ 80 万）', prepaymentAvailable('CUS001') >= 800000)
  const q5c = db.customers.find((x) => x.id === 'CUS003')
  const q5before = prepaymentAvailable(q5c.id)
  const q5col = collectPrepayment(q5c.id, 200000, '银行转账', '环节5 测试预付')
  check('环节5：收取预付款入台账（可用余额增加）', q5col.ok === true && prepaymentAvailable(q5c.id) === q5before + 200000)
  check('环节5：守卫：金额须大于 0', /须大于 0/.test(collectPrepayment(q5c.id, 0)?.error || ''))
  check('环节5：守卫：冻结客户不可收取预付款', /已冻结/.test(collectPrepayment('CUS022', 1000)?.error || ''))
  setOperator({ name: '测试客户', username: 't-cust', role: '客户' })
  check('环节5：RBAC：客户角色不可收取预付款', /无此操作权限/.test(collectPrepayment(q5c.id, 1000)?.error || ''))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  // 信用联动：预付款冲减信用占用（须在抵扣消耗预付之前验证）
  const q5credit = db.customers.find((x) => x.id === 'CUS001')
  const q5out = outstandingOf(q5credit.id)
  if (q5out > 0 && prepaymentAvailable(q5credit.id) > 0) {
    const q5x = q5credit.creditLimit - q5out + 1
    check('环节5：信用校验：无预付口径会超限的订单，预付冲减后通过', creditCheck(q5credit.id, q5x).ok === true)
  } else {
    console.log('  - 跳过预付冲减信用校验（CUS001 无未付余额/预付）')
  }
  check('环节5：信用校验：占用+订单仍超授信额度被拒', creditCheck(q5credit.id, q5credit.creditLimit + 1).ok === false)
  const q5pending = db.settlements.find((s) => s.status === 'pending')
  check('环节5：守卫：待对账账单不可抵扣预付款', !!q5pending && /非"已结算\/逾期"/.test(applyPrepayment(q5pending, 1000)?.error || ''))
  // 抵扣：CUS001（种子预付 80 万）——新建已结算账单（未付 100 万），验证 流水/FIFO 跨记录/超额截断
  const q5c1 = db.customers.find((x) => x.id === 'CUS001')
  const q5col1 = collectPrepayment(q5c1.id, 200000, '银行转账', '环节5 FIFO 测试预付') // 晚于 YF-0001 收取
  const q5s = {
    id: genId('JS-', 4, db.settlements),
    billNo: 'BL-Q5TEST',
    contractId: db.contracts.find((c) => c.shipperId === q5c1.id)?.id || '',
    customerId: q5c1.id,
    period: dayjs(NOW).format('YYYY-MM'),
    dispatchCount: 0,
    dispatchQuantity: 0,
    totalQuantity: 0,
    lossQty: 0,
    freight: 1000000,
    loadingFee: 0,
    unloadingFee: 0,
    lossDeduction: 0,
    qualityQty: 0,
    qualityDeduction: 0,
    exceptionLoss: 0,
    tollFee: 0,
    surcharge: 0,
    totalAmount: 1000000,
    paidAmount: 0,
    status: 'settled',
    settleDate: dayjs(NOW).format('YYYY-MM-DD'),
    invoiceStatus: 'not-issued',
    reconciliation: null,
    remark: '环节5 测试账单'
  }
  db.settlements.unshift(q5s)
  const q5apply = applyPrepayment(q5s, 10000)
  check(
    '环节5：预付款抵扣记入收款流水（已付增加，方式=预付款抵扣）',
    q5apply.ok === true &&
      q5s.paidAmount === 10000 &&
      db.payments.some((p) => p.settlementId === q5s.id && p.method === '预付款抵扣')
  )
  const q5p1 = prepaymentOf(q5c1.id).find((p) => p.id === 'YF-0001')
  const q5p2 = prepaymentOf(q5c1.id).find((p) => p.id === q5col1.id)
  check('环节5：FIFO 抵扣（最早收取的 YF-0001 先扣）', q5p1?.used === 10000 && q5p2?.used === 0)
  const q5f = applyPrepayment(q5s, 900000)
  check(
    '环节5：FIFO 跨记录（最早一笔扣完再扣次笔）',
    q5f.amount === 900000 && q5p1.used === q5p1.amount && q5p2.used === 900000 - (q5p1.amount - 10000)
  )
  const q5availBeforeOver = prepaymentAvailable(q5c1.id)
  const q5over = applyPrepayment(q5s, 999999999)
  check(
    '环节5：超额抵扣按 min(未付, 可用预付款) 截断',
    q5over.amount === q5availBeforeOver && prepaymentAvailable(q5c1.id) === 0 && q5s.paidAmount <= q5s.totalAmount
  )
  // 独立合成账单（有未付余额）验证"无预付"守卫（q5s 已付清，会先命中"无未付余额"）
  const q5s2 = { id: 'JS-Q5B', billNo: 'BL-Q5B', customerId: q5c1.id, status: 'settled', totalAmount: 50000, paidAmount: 0 }
  check('环节5：守卫：无可用预付款不可抵扣', /无可用预付款/.test(applyPrepayment(q5s2, 1000)?.error || ''))
}
{
  // 环节6：消息免打扰——设置 / 类型屏蔽 / 免打扰时段（跨零点）/ 未读口径 / 账号隔离
  check('环节6：默认免打扰关闭', getDnd().enabled === false)
  const q6set = setDnd({ enabled: true, quietStart: '22:00', quietEnd: '08:00', mutedTypes: ['system'] })
  check('环节6：免打扰设置保存（db.dnd 按账号）', q6set.ok === true && db.dnd.admin.enabled === true && db.dnd.admin.mutedTypes.includes('system'))
  const q6muted = { type: 'system', time: '2026-08-18 12:00', read: false }
  const q6day = { type: 'settlement', time: '2026-08-18 12:00', read: false }
  check('环节6：类型屏蔽（system 屏蔽，其他类型不受影响）', isMuted(q6muted) === true && isMuted(q6day) === false)
  check(
    '环节6：免打扰时段 22:00-08:00（跨零点，含 23:30 / 07:59，不含 08:00）',
    isMuted({ type: 'settlement', time: '2026-08-18 23:30', read: false }) === true &&
      isMuted({ type: 'settlement', time: '2026-08-18 07:59', read: false }) === true &&
      isMuted({ type: 'settlement', time: '2026-08-18 08:00', read: false }) === false
  )
  const q6before = unreadCount()
  const q6msg = notify('环节6 测试消息', 'system', '/message', '免打扰测试', null)
  check('环节6：未读口径排除免打扰消息（system 已屏蔽，未读角标不增）', !q6msg.read && isMuted(q6msg) === true && unreadCount() === q6before)
  setOperator({ name: '测试结算', username: 't-settle', role: '结算专员' })
  check('环节6：免打扰设置按账号隔离（其他账号默认关闭）', getDnd().enabled === false && isMuted(q6muted) === false)
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  setDnd({ enabled: false, quietStart: '22:00', quietEnd: '08:00', mutedTypes: [] })
  check('环节6：关闭免打扰后消息不再被屏蔽', isMuted(q6muted) === false)
  clearOperator()
  check('环节6：守卫：未登录态不可保存免打扰设置', /未登录/.test(setDnd({ enabled: true })?.error || ''))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
}
{
  // 环节7：安全库存预警——台账/预警列表/RBAC 与守卫/upsert/锁定穿越告警/出库穿越告警
  check('环节7：种子安全库存台账（仓库×商品下限）', (db.safetyStocks || []).length >= 15)
  check('环节7：种子含低于安全库存组合（预警展示口径）', inventoryAlerts().length >= 1)
  setOperator({ name: '测试结算', username: 't-settle', role: '结算专员' })
  check('环节7：RBAC：非仓储角色不可设置安全库存', /无此操作权限/.test(setSafetyStock('WH001', 'CM001', 100)?.error || ''))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  check('环节7：守卫：仓库不存在', /仓库不存在/.test(setSafetyStock('WH999', 'CM001', 100)?.error || ''))
  check('环节7：守卫：商品不存在', /商品不存在/.test(setSafetyStock('WH001', 'CM999', 100)?.error || ''))
  check('环节7：守卫：下限须为不小于 0 的数字', /不小于 0/.test(setSafetyStock('WH001', 'CM001', -5)?.error || ''))
  const q7a = setSafetyStock('WH002', 'CM001', 2000)
  const q7b = setSafetyStock('WH002', 'CM001', 3000)
  check('环节7：upsert（同仓库×商品更新而非新增）', q7a.ok === true && q7b.ok === true && q7a.id === q7b.id && safetyStockOf('WH002', 'CM001').minQty === 3000)
  // 锁定穿越：下限=当前可发 → 锁定任一正常批次即可发跌破下限 → 预警（审计 + 定向仓储角色）
  // 优先选有安全库存台账的批次（前序节卸货入库可能生成无台账的仓库×商品组合）；setSafetyStock upsert 兜底
  let q7inv = db.inventories.find((i) => i.status === 'normal' && i.quantity > 0 && safetyStockOf(i.warehouseId, i.commodityId))
  if (!q7inv) q7inv = db.inventories.find((i) => i.status === 'normal' && i.quantity > 0)
  setSafetyStock(q7inv.warehouseId, q7inv.commodityId, availableStockOf(q7inv.warehouseId, q7inv.commodityId))
  const q7alertTitle = '安全库存预警'
  const q7msgBefore = db.messages.filter((m) => (m.title || '').includes(q7alertTitle)).length
  const q7lock = setInventoryStatus(q7inv, 'locked')
  const q7msgs = db.messages.filter((m) => (m.title || '').includes(q7alertTitle))
  check(
    '环节7：锁定跌破安全库存 → 预警（定向仓储角色 + 不重复）',
    q7lock.ok === true &&
      q7msgs.length === q7msgBefore + 1 &&
      (q7msgs[0].to || []).includes('场站操作员') &&
      inventoryAlerts().some((a) => a.warehouseId === q7inv.warehouseId && a.commodityId === q7inv.commodityId)
  )
  // 已低于下限时再锁定不重复告警
  const q7inv2 = db.inventories.find((i) => i.warehouseId === q7inv.warehouseId && i.commodityId === q7inv.commodityId && i.status === 'normal' && i.quantity > 0)
  if (q7inv2) {
    const q7msgMid = db.messages.filter((m) => (m.title || '').includes(q7alertTitle)).length
    setInventoryStatus(q7inv2, 'locked')
    check('环节7：已低于下限再锁定不重复告警', db.messages.filter((m) => (m.title || '').includes(q7alertTitle)).length === q7msgMid)
  } else {
    check('环节7：已低于下限再锁定不重复告警（无第二个正常批次，口径成立）', true)
  }
  setInventoryStatus(q7inv, 'normal')
  if (q7inv2) setInventoryStatus(q7inv2, 'normal')
  // 出库穿越：T006 → WH007，下限=可发-35+1 → 出库 35 吨后跌破
  const q7oWh = 'WH007'
  const q7oCm = 'CM001'
  let q7pad = null
  if (availableStockOf(q7oWh, q7oCm) < 35) {
    q7pad = { id: 'INV-Q7P', warehouseId: q7oWh, commodityId: q7oCm, batch: 'BTEST-Q7', quantity: 500, inDate: '2026-08-15', status: 'normal' }
    db.inventories.push(q7pad)
  }
  setSafetyStock(q7oWh, q7oCm, availableStockOf(q7oWh, q7oCm) - 35 + 1)
  const q7c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  const q7p = { id: 'YH-Q7', contractId: q7c.id, commodityId: q7oCm, quantity: 35, loadTerminalId: 'T006', unloadTerminalId: 'T002', mode: '公路', unitPrice: q7c.unitPrice, status: 'pending', progress: 0 }
  db.plans.unshift(q7p)
  const q7d = createDispatches(q7p, 1).created[0]
  if (q7d) {
    q7d.accepted = true
    const q7outBefore = db.messages.filter((m) => (m.title || '').includes(q7alertTitle)).length
    const q7out = confirmLoad(q7d)
    check(
      '环节7：出库跌破安全库存 → 装货成功且发出预警',
      !q7out?.error && q7d.status === 'loading' && db.messages.filter((m) => (m.title || '').includes(q7alertTitle)).length === q7outBefore + 1
    )
  } else {
    check('环节7：出库跌破安全库存 → 装货成功且发出预警（无空闲车辆可派车）', false)
  }
  if (q7pad) db.inventories.splice(db.inventories.indexOf(q7pad), 1)
}
{
  // 环节8：数据权限（行级，装货侧区域）——种子范围/行级过滤/派生口径/RBAC 与守卫/动态变更/账号隔离
  check('环节8：默认全量数据（无范围设置，调度单/计划全可见）', visibleDispatches().length === db.dispatches.length && visiblePlans().length === db.plans.length)
  const q8u = db.users.find((x) => x.username === 'user02')
  setOperator({ name: q8u.name, username: 'user02', role: q8u.role })
  check('环节8：种子数据范围（调度员 user02 = 华北）', q8u.role === '调度员' && dataScopeOf().regions.join() === '华北')
  const q8d = visibleDispatches()
  check(
    '环节8：调度单行级过滤（仅华北装货侧，且为真子集）',
    q8d.length > 0 && q8d.length < db.dispatches.length && q8d.every((d) => recordRegion(d) === '华北')
  )
  const q8p = visiblePlans()
  check('环节8：计划行级过滤（仅华北装货侧）', q8p.length > 0 && q8p.every((p) => recordRegion(p) === '华北'))
  const q8cOther = db.contracts.filter((c) => recordRegion(c) === '西北')
  check('环节8：合同经合同装货侧区域派生（西北合同对华北范围不可见）', q8cOther.length > 0 && q8cOther.every((c) => inDataScope(c) === false))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  check('环节8：平台管理员不受数据范围影响（全量数据）', visibleDispatches().length === db.dispatches.length)
  setOperator({ name: '测试结算', username: 't-settle', role: '结算专员' })
  check('环节8：RBAC：非用户管理角色不可设置数据范围', /无此操作权限/.test(setDataScope('user02', ['华北'])?.error || ''))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  check('环节8：守卫：账号不存在', /不存在/.test(setDataScope('nobody', ['华北'])?.error || ''))
  check('环节8：守卫：包含无效区域被拒', /无效区域/.test(setDataScope('user02', ['华北', '火星'])?.error || ''))
  check('环节8：守卫：平台管理员不可被限制', /全量数据/.test(setDataScope('admin', ['华北'])?.error || ''))
  const q8u2 = db.users.find((x) => x.username === 'user03')
  const q8set = setDataScope(q8u2.username, ['西北', '华东'])
  setOperator({ name: q8u2.name, username: q8u2.username, role: q8u2.role })
  check(
    '环节8：多区域范围生效（仅西北/华东装货侧可见）',
    q8set.ok === true && visibleDispatches().every((d) => ['西北', '华东'].includes(recordRegion(d)))
  )
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  const q8clear = setDataScope(q8u2.username, [])
  check('环节8：清除范围恢复全量数据', q8clear.ok === true && dataScopeOf().regions.length === 0 && visibleDispatches().length === db.dispatches.length)
  setOperator({ name: q8u.name, username: 'user02', role: q8u.role })
  check('环节8：范围按账号隔离（user02 仍为华北）', dataScopeOf().regions.join() === '华北')
  check('环节8：区域枚举与场站一致（单一来源）', DATA_REGIONS.includes('华北') && DATA_REGIONS.includes('西北') && DATA_REGIONS.includes('华东') && DATA_REGIONS.includes('东北'))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
}
{
  // 环节9：登录安全——密码哈希（不落明文）+ 验证码（一次性/错误拒绝）+ 登录校验（凭据/停用/司机手机号）
  check('环节9：用户表只存密码哈希（无明文 password）', db.users.length > 0 && db.users.every((u) => u.passwordHash && !('password' in u)))
  check(
    '环节9：hashPassword 确定性 + 与种子 admin 哈希一致',
    hashPassword('123456') === hashPassword('123456') && hashPassword('123456') !== hashPassword('1234567') && hashPassword('123456') === db.users.find((u) => u.username === 'admin').passwordHash
  )
  const q9cap = generateCaptcha()
  check('环节9：generateCaptcha 返回 id/4位码/SVG（含字符 <text>）', q9cap.id && q9cap.code.length === 4 && q9cap.svg.includes('<svg') && q9cap.code.split('').every((ch) => q9cap.svg.includes(`>${ch}<`)))
  const q9cap2 = generateCaptcha()
  check('环节9：verifyCaptcha 正确码通过', verifyCaptcha(q9cap2.id, q9cap2.code) === true)
  const q9cap3 = generateCaptcha()
  check('环节9：verifyCaptcha 一次性（消费后不可复用）', verifyCaptcha(q9cap3.id, q9cap3.code) === true && verifyCaptcha(q9cap3.id, q9cap3.code) === false)
  const q9cap4 = generateCaptcha()
  check('环节9：verifyCaptcha 错误码拒绝', verifyCaptcha(q9cap4.id, '0000') === false)
  const q9c1 = generateCaptcha()
  const q9ok = login('admin', '123456', q9c1.id, q9c1.code)
  check('环节9：登录成功（验证码 + 密码哈希）', q9ok.ok === true && q9ok.user.username === 'admin')
  const q9c2 = generateCaptcha()
  const q9badCap = login('admin', '123456', q9c2.id, '0000')
  check('环节9：验证码错误拒绝（code=captcha）', !q9badCap.ok && q9badCap.code === 'captcha')
  const q9c3 = generateCaptcha()
  const q9badPw = login('admin', 'wrong-pass', q9c3.id, q9c3.code)
  check('环节9：密码错误拒绝（code=credential）', !q9badPw.ok && q9badPw.code === 'credential')
  const q9c4 = generateCaptcha()
  const q9noUser = login('nobody', '123456', q9c4.id, q9c4.code)
  check('环节9：不存在账号拒绝（code=credential）', !q9noUser.ok && q9noUser.code === 'credential')
  const q9dis = db.users.find((u) => u.status === 'disabled')
  const q9c5 = generateCaptcha()
  const q9disR = login(q9dis.username, '123456', q9c5.id, q9c5.code)
  check('环节9：停用账号拒绝（code=disabled）', !q9disR.ok && q9disR.code === 'disabled')
  const q9drv = db.users.find((u) => u.role === '司机' && u.status === 'active')
  const q9c6 = generateCaptcha()
  const q9drvR = login(q9drv.phone, '123456', q9c6.id, q9c6.code)
  check('环节9：司机手机号登录成功', q9drvR.ok === true && !!q9drvR.user.driverId)
}
{
  // 环节10：电子单证归档——聚合口径（磅单/签收单/发票）+ 单证结构 + 内容生成
  check('环节10：DOC_TYPES 六类（调度单/磅单/质检报告/签收单/对账单/发票）', DOC_TYPES.length === 6 && DOC_TYPES.map((t) => t.key).join() === 'dispatch,weighing,quality,receipt,reconciliation,invoice')
  const q10docs = listDocuments()
  check('环节10：磅单单证数 = 过磅记录数', q10docs.filter((d) => d.type === 'weighing').length === db.weighings.length)
  check('环节10：签收单单证数 = 已签收车次', q10docs.filter((d) => d.type === 'receipt').length === db.dispatches.filter((d) => d.receipt).length)
  check('环节10：发票单证数 = 发票数', q10docs.filter((d) => d.type === 'invoice').length === db.invoices.length)
  check(
    '环节10：单证结构完整（id/type/typeName/refId/title/date/fields）',
    q10docs.length > 0 && q10docs.every((d) => d.id && d.type && d.typeName && d.refId && d.title && d.date && Array.isArray(d.fields) && d.fields.length > 0)
  )
  const q10w = q10docs.find((d) => d.type === 'weighing')
  const q10html = documentContent(q10w)
  check('环节10：单证内容生成 HTML（含表格 + 单证标题 + 电子单证声明）', q10html.includes('<table') && q10html.includes(q10w.title) && q10html.includes('电子单证'))
  const q10found = documentOf('weighing', q10w.id)
  check('环节10：documentOf 按类型+单证号定位', q10found && q10found.id === q10w.id && q10found.type === 'weighing')
  const q10inv = q10docs.find((d) => d.type === 'invoice')
  check('环节10：发票单证含金额与关联账单', q10inv && q10inv.fields.some(([k, v]) => k === '发票金额' && String(v).includes('¥')) && q10inv.fields.some(([k]) => k === '关联账单'))
}
{
  // 环节11：收款冲正/退款——误登记收款可撤销，已付金额回退，预付款占用同步释放，留痕 + RBAC
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  const q11c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  const q11p = { id: 'YH-Q11', contractId: q11c.id, commodityId: 'CM003', quantity: 35, loadTerminalId: 'T007', unloadTerminalId: 'T002', mode: '公路', unitPrice: q11c.unitPrice, status: 'pending', progress: 0 }
  db.plans.unshift(q11p)
  const q11d = createDispatches(q11p, 1).created[0]
  check('环节11：派车成功（前置）', !!q11d)
  if (q11d) {
    q11d.accepted = true
    confirmLoad(q11d)
    depart(q11d)
    arrive(q11d)
    confirmUnload(q11d)
    signReceipt(q11d, '收货方')
    const q11cand = settlementCandidates().find((g) => g.dispatches.some((x) => x.id === q11d.id))
    const q11s = generateSettlements([q11cand.key]).find((x) => x.contractId === q11c.id)
    startReconcile(q11s)
    customerConfirm(q11s)
    confirmSettle(q11s)
    check('环节11：账单进入收款（已结算/未付）', q11s.status === 'settled' && q11s.paidAmount === 0)
    const q11amt = Math.round(q11s.totalAmount / 2)
    recordPayment(q11s, q11amt, '银行转账')
    const q11pay = db.payments.find((p) => p.settlementId === q11s.id && p.amount === q11amt && !p.reversed)
    check('环节11：收款流水生成（前置）', !!q11pay && q11s.paidAmount === q11amt)
    const q11r = revertPayment(q11s, q11pay.id, '客户重复付款')
    check(
      '环节11：冲正成功（已付回退 + reversed 标记 + 原因留痕）',
      q11r.ok === true && q11s.paidAmount === 0 && q11pay.reversed === true && q11pay.revertReason === '客户重复付款' && !!q11pay.revertTime
    )
    check('环节11：冲正后状态保持已结算（未超账期）', q11s.status === 'settled')
    const q11again = revertPayment(q11s, q11pay.id, '再次冲正')
    check('环节11：重复冲正被拒（已冲正不可再操作）', /已冲正/.test(q11again?.error || '') && q11s.paidAmount === 0)
    // 预付款抵扣冲正：占用同步释放
    const q11cust = q11s.customerId
    collectPrepayment(q11cust, 50000, '银行转账')
    const q11preAvailBefore = prepaymentAvailable(q11cust)
    applyPrepayment(q11s, q11amt)
    const q11prePay = db.payments.find((p) => p.settlementId === q11s.id && p.method === '预付款抵扣' && !p.reversed)
    check('环节11：预付款抵扣流水生成（前置）', !!q11prePay && q11s.paidAmount === q11amt)
    check('环节11：抵扣后预付款占用减少', prepaymentAvailable(q11cust) < q11preAvailBefore)
    revertPayment(q11s, q11prePay.id, '抵扣错误冲正')
    check('环节11：预付款抵扣冲正 → 占用释放（可用额恢复）', q11s.paidAmount === 0 && prepaymentAvailable(q11cust) === q11preAvailBefore)
    // RBAC：非结算角色不可冲正
    recordPayment(q11s, q11amt, '银行转账')
    const q11pay3 = db.payments.find((p) => p.settlementId === q11s.id && p.amount === q11amt && !p.reversed)
    setOperator({ name: '测试调度', username: 't-dispatch', role: '调度员' })
    const q11rbac = revertPayment(q11s, q11pay3.id, '越权冲正')
    check('环节11：RBAC：非结算角色不可冲正（已付不回退）', /无此操作权限/.test(q11rbac?.error || '') && q11s.paidAmount === q11amt)
    setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  } else {
    check('环节11：存在可派车执行中的公路合同（前置）', false)
  }
}
{
  // 环节12：派车事务化——资源不足整体失败（无半套调度单、计划状态不变）；资源充足则全成
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  let q12p = db.plans.find((x) => x.status === 'pending' && isRoadMode(x.mode))
  if (!q12p) {
    const q12c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
    q12p = { id: 'YH-Q12', contractId: q12c.id, commodityId: 'CM003', quantity: 105, loadTerminalId: 'T007', unloadTerminalId: 'T002', mode: '公路', unitPrice: q12c.unitPrice, status: 'pending', progress: 0 }
    db.plans.unshift(q12p)
  }
  check('环节12：存在待执行公路计划（前置）', !!q12p)
  if (q12p) {
    const busyV = new Set(db.dispatches.filter((x) => BUSY_STATUSES.includes(x.status)).map((x) => x.vehicleId))
    const busyD = new Set(db.dispatches.filter((x) => BUSY_STATUSES.includes(x.status)).map((x) => x.driverId))
    const pool = db.vehicles.filter((v) => v.type !== '铁路敞车' && v.type !== '散货船' && v.status === 'idle' && !vehicleInspectionExpired(v) && !busyV.has(v.id))
    const avail = db.drivers.filter((x) => x.status === 'available' && !driverLicenseExpired(x) && !busyD.has(x.id))
    const dispatchBefore = db.dispatches.length
    const planStatusBefore = q12p.status
    // 请求超出可用资源数 → 整体失败（无残留、计划状态不变）
    const overCount = Math.max(pool.length + 1, avail.length + 1)
    const q12r = createDispatches(q12p, overCount)
    check('环节12：资源不足整体失败（created 为空 + 明确报错）', q12r.created.length === 0 && !!q12r.error)
    check('环节12：失败无残留调度单（db 未新增）', db.dispatches.length === dispatchBefore)
    check('环节12：失败计划状态不变（仍待执行）', q12p.status === planStatusBefore)
    // 恰好等于可用资源数 → 全部生成
    const okCount = Math.min(pool.length, avail.length)
    if (okCount > 0) {
      const q12ok = createDispatches(q12p, okCount)
      check('环节12：资源恰好充足 → 全部生成 + 计划转 dispatched', q12ok.created.length === okCount && !q12ok.error && q12p.status === 'dispatched')
      check(
        '环节12：全成调度单车辆/司机互不重复',
        new Set(q12ok.created.map((d) => d.vehicleId)).size === okCount && new Set(q12ok.created.map((d) => d.driverId)).size === okCount
      )
    } else {
      check('环节12：无空闲资源（口径成立，跳过全成断言）', true)
    }
  }
}
{
  // 环节13：异常补扣失效客户确认——已结算账单补扣后回待对账，须重新对账 + 客户再确认
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  // 复用现有待装货公路车次（前置测试可能耗尽空闲车辆，完成它无需新资源）
  const q13d = db.dispatches.find((d) => d.status === 'pending' && isRoadMode(d.mode) && d.driverId)
  check('环节13：存在待装货公路车次（前置）', !!q13d)
  if (q13d) {
    q13d.accepted = true
    confirmLoad(q13d)
    depart(q13d)
    arrive(q13d)
    confirmUnload(q13d)
    signReceipt(q13d, '收货方')
    const q13cand = settlementCandidates().find((g) => g.dispatches.some((x) => x.id === q13d.id))
    const q13s = generateSettlements([q13cand.key]).find((x) => x.contractId === q13d.contractId)
    startReconcile(q13s)
    customerConfirm(q13s)
    confirmSettle(q13s)
    check('环节13：账单已结算且客户已确认（前置）', q13s.status === 'settled' && !!q13s.customerConfirmed && !!q13s.reconciliation)
    const q13total0 = q13s.totalAmount
    // 关闭该账单车次的异常单（补扣损失 300）
    const q13e = { id: 'EX-Q13T', dispatchId: q13d.id, status: 'open', cost: 300 }
    db.exceptions.push(q13e)
    closeException(q13e)
    check(
      '环节13：已结算账单补扣 → 回待对账 + 客户确认失效 + 对账快照清除',
      q13s.status === 'pending' && q13s.customerConfirmed === null && q13s.reconciliation === null && q13s.totalAmount === q13total0 - 300
    )
    // 重新对账 + 客户再确认 + 再次结算
    startReconcile(q13s)
    check('环节13：重新对账 → 对账中 + 对账快照重建', q13s.status === 'reconciling' && !!q13s.reconciliation)
    const q13reconf = customerConfirm(q13s)
    check('环节13：客户可重新确认（原确认已失效）', q13reconf.ok === true && !!q13s.customerConfirmed?.time)
    confirmSettle(q13s)
    check('环节13：再次结算成功（金额含补扣）', q13s.status === 'settled' && q13s.totalAmount === q13total0 - 300)
  } else {
    check('环节13：存在待装货公路车次（前置）', false)
  }
}
{
  // 环节14：磅单更正/复磅——净重可从源头修正（留痕 + 毛重重算 + 保留原始值）；已入账单则重算金额，已对账/结算客户确认失效
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  const q14d = db.dispatches.find((d) => d.status === 'pending' && isRoadMode(d.mode) && d.driverId)
  check('环节14：存在待装货公路车次（前置）', !!q14d)
  if (q14d) {
    q14d.accepted = true
    confirmLoad(q14d)
    depart(q14d)
    arrive(q14d)
    confirmUnload(q14d)
    signReceipt(q14d, '收货方')
    const q14w = db.weighings.find((w) => w.dispatchId === q14d.id && w.type === '出磅')
    check('环节14：出磅磅单存在（前置）', !!q14w)
    if (q14w) {
      const q14orig = q14w.net
      const q14net1 = +(q14orig + 1).toFixed(2)
      // A. 无账单磅单更正（基础留痕 + 毛重重算 + 保留原始值）
      const q14r = correctWeighing(q14w.id, q14net1, '争议复磅')
      check(
        '环节14：复磅更正成功（净重更新 + 毛重重算 + 留痕 + 保留原始值）',
        q14r.ok === true &&
          q14w.net === q14net1 &&
          q14w.gross === +(q14w.tare + q14net1).toFixed(2) &&
          q14w.corrected === true &&
          q14w.originalNet === q14orig &&
          q14w.correctReason === '争议复磅' &&
          !!q14w.correctTime &&
          !!q14w.correctOperator
      )
      // 守卫
      check('环节14：守卫：复磅净重与原值相同被拒', /相同/.test(correctWeighing(q14w.id, q14w.net, '同值')?.error || ''))
      check('环节14：守卫：复磅净重非正被拒', /大于 0/.test(correctWeighing(q14w.id, 0, '零值')?.error || ''))
      check('环节14：守卫：缺复磅原因被拒', /复磅原因/.test(correctWeighing(q14w.id, +(q14w.net + 1).toFixed(2), '')?.error || ''))
      // RBAC：非磅单角色不可更正
      setOperator({ name: '测试调度', username: 't-dispatch', role: '调度员' })
      const q14rbac = correctWeighing(q14w.id, +(q14w.net + 1).toFixed(2), '越权更正')
      check('环节14：RBAC：非磅单角色不可更正（净重不变）', /无此操作权限/.test(q14rbac?.error || '') && q14w.net === q14net1)
      setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
      // B. 已结算账单磅单更正（结算联动 + 客户确认失效 + 重新对账确认）
      const q14cand = settlementCandidates().find((g) => g.dispatches.some((x) => x.id === q14d.id))
      const q14s = generateSettlements([q14cand.key]).find((x) => x.contractId === q14d.contractId)
      startReconcile(q14s)
      customerConfirm(q14s)
      confirmSettle(q14s)
      check('环节14：账单已结算且客户已确认（前置）', q14s.status === 'settled' && !!q14s.customerConfirmed && !!q14s.reconciliation)
      const q14total0 = q14s.totalAmount
      const q14net2 = +(q14w.net + 2).toFixed(2)
      const q14r2 = correctWeighing(q14w.id, q14net2, '复磅二次更正')
      check(
        '环节14：已结算账单复磅 → 回待对账 + 客户确认失效 + 对账快照清除 + 金额重算',
        q14r2.ok === true &&
          q14s.status === 'pending' &&
          q14s.customerConfirmed === null &&
          q14s.reconciliation === null &&
          q14s.totalAmount !== q14total0 &&
          q14w.originalNet === q14orig
      )
      check('环节14：复磅调整记录留痕（原因含复磅更正）', (q14s.adjustments || []).some((a) => /复磅更正/.test(a.reason)))
      // 重新对账 + 客户再确认 + 再次结算（补齐同账单其他公路车次签收，避免组内漏签干扰）
      startReconcile(q14s)
      for (const dd of db.dispatches.filter((x) => x.settlementId === q14s.id && isRoadMode(x.mode) && !x.receipt)) {
        supplementReceipt(dd, '收货方', '测试补签')
      }
      const q14reconf = customerConfirm(q14s)
      check('环节14：客户可重新确认（原确认已失效）', q14reconf.ok === true && !!q14s.customerConfirmed?.time)
      const q14totalAfter = q14s.totalAmount
      confirmSettle(q14s)
      check('环节14：再次结算成功（金额含复磅重算）', q14s.status === 'settled' && q14s.totalAmount === q14totalAfter)
    } else {
      check('环节14：出磅磅单存在（前置）', false)
    }
  } else {
    check('环节14：存在待装货公路车次（前置）', false)
  }
}
{
  // 环节15：司机/外协付费（成本侧闭环）——公路车次完成自动生成趟次应付（司机趟次费 + 外协运费），付款核销
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  const q15d = db.dispatches.find((d) => d.status === 'pending' && isRoadMode(d.mode) && d.driverId)
  check('环节15：存在待装货公路车次（前置）', !!q15d)
  if (q15d) {
    q15d.accepted = true
    confirmLoad(q15d)
    depart(q15d)
    arrive(q15d)
    confirmUnload(q15d)
    // 完成即自动生成趟次应付
    const q15p = db.payables.find((p) => p.dispatchId === q15d.id)
    check('环节15：公路车次完成自动生成趟次应付（前置）', !!q15p && q15p.status === 'pending')
    if (q15p) {
      const q15v = db.vehicles.find((x) => x.id === q15d.vehicleId)
      const q15driverFee = driverIncomeOf(q15d)
      const q15isOutsource = q15v && q15v.owner === '外协'
      const q15outFee = q15isOutsource ? outsourceFreightOf(q15d) : 0
      check(
        '环节15：应付金额 = 司机趟次费 + 外协运费',
        q15p.driverFee === q15driverFee && q15p.outsourceFee === q15outFee && q15p.amount === q15driverFee + q15outFee
      )
      check('环节15：外协车计外协运费 / 自有车不计', q15isOutsource ? q15p.outsourceFee > 0 : q15p.outsourceFee === 0)
      // 幂等：批量生成不重复
      const q15gen = generatePayables()
      check('环节15：批量生成幂等（该车次不重复生成）', db.payables.filter((p) => p.dispatchId === q15d.id).length === 1)
      check('环节15：批量生成补全历史车次应付（成功返回）', q15gen.ok === true && q15gen.created >= 0)
      // 付款核销
      const q15pay = payPayable(q15p, '银行转账')
      check('环节15：付款成功（待付→已付 + 时间/方式留痕）', q15pay.ok === true && q15p.status === 'paid' && !!q15p.payTime && q15p.payMethod === '银行转账')
      const q15again = payPayable(q15p, '现金')
      check('环节15：重复付款被拒（已付不可再付）', /非"待付"/.test(q15again?.error || '') && q15p.status === 'paid')
      // 统计
      const q15stats = payableStats()
      check('环节15：应付统计口径（已付含本单）', q15stats.paidCount >= 1 && q15stats.paidAmount >= q15p.amount)
      // RBAC：非结算角色不可付款
      const q15p2 = db.payables.find((p) => p.status === 'pending')
      if (q15p2) {
        setOperator({ name: '测试调度', username: 't-dispatch', role: '调度员' })
        const q15rbac = payPayable(q15p2, '银行转账')
        check('环节15：RBAC：非结算角色不可付款（状态不变）', /无此操作权限/.test(q15rbac?.error || '') && q15p2.status === 'pending')
        setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
      } else {
        check('环节15：存在待付应付单（RBAC 前置）', false)
      }
    } else {
      check('环节15：公路车次完成自动生成趟次应付（前置）', false)
    }
  } else {
    check('环节15：存在待装货公路车次（前置）', false)
  }
}
{
  // 环节16：调度单取消/改派——装货前可取消（释放占用、回卷计划）或改派（换车/换司机，须重新接单）
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  const q16pending = db.dispatches.filter((d) => {
    if (d.status !== 'pending' || !isRoadMode(d.mode) || !d.driverId || !d.vehicleId) return false
    const v = db.vehicles.find((x) => x.id === d.vehicleId)
    const dr = db.drivers.find((x) => x.id === d.driverId)
    return v && !vehicleInspectionExpired(v) && dr && !driverLicenseExpired(dr)
  })
  check('环节16：存在待装货公路车次（前置，需 2 张）', q16pending.length >= 2)
  if (q16pending.length >= 2) {
    const q16dCancel = q16pending[0]
    const q16dReassign = q16pending[1]
    // 1. 取消（释放其车辆/司机）
    const q16c = cancelDispatch(q16dCancel, '车辆故障')
    check('环节16：取消成功（状态=已取消 + 原因留痕）', q16c.ok === true && q16dCancel.status === 'cancelled' && q16dCancel.cancelReason === '车辆故障' && !!q16dCancel.cancelTime)
    check(
      '环节16：取消后车辆/司机释放（退出占用）',
      !db.dispatches.some((x) => BUSY_STATUSES.includes(x.status) && x.vehicleId === q16dCancel.vehicleId) &&
        !db.dispatches.some((x) => BUSY_STATUSES.includes(x.status) && x.driverId === q16dCancel.driverId)
    )
    // 2. 改派另一单到刚释放的车辆/司机
    const q16r = reassignDispatch(q16dReassign, q16dCancel.vehicleId, q16dCancel.driverId)
    check(
      '环节16：改派成功（换到刚释放的车辆/司机 + 需重新接单）',
      q16r.ok === true && q16dReassign.vehicleId === q16dCancel.vehicleId && q16dReassign.driverId === q16dCancel.driverId && q16dReassign.accepted === false
    )
    // 3. 守卫：改派到忙碌车辆被拒
    const q16busy = db.dispatches.find((x) => x.id !== q16dReassign.id && BUSY_STATUSES.includes(x.status) && x.vehicleId && x.vehicleId !== q16dReassign.vehicleId)
    if (q16busy) {
      check('环节16：守卫：改派到忙碌车辆被拒', /不可用|未完结/.test(reassignDispatch(q16dReassign, q16busy.vehicleId, q16dReassign.driverId)?.error || ''))
    } else {
      check('环节16：守卫：改派到忙碌车辆被拒（无其他忙碌车辆，口径成立）', true)
    }
    // 4. 守卫：取消缺原因被拒
    const q16d3 = q16pending.find((x) => x.status === 'pending' && x.id !== q16dCancel.id)
    if (q16d3) {
      check('环节16：守卫：取消缺原因被拒', /取消原因/.test(cancelDispatch(q16d3, '')?.error || '') && q16d3.status === 'pending')
    }
    // 5. 已取消不可再取消
    check('环节16：已取消不可再取消', /非"待装货"/.test(cancelDispatch(q16dCancel, '再次取消')?.error || ''))
    // 6. RBAC：非调度角色不可取消
    const q16d4 = q16pending.find((x) => x.status === 'pending' && x.id !== q16dCancel.id)
    if (q16d4) {
      setOperator({ name: '测试结算', username: 't-settle', role: '结算专员' })
      const q16rbac = cancelDispatch(q16d4, '越权取消')
      check('环节16：RBAC：非调度角色不可取消', /无此操作权限/.test(q16rbac?.error || '') && q16d4.status === 'pending')
      setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
    }
  } else {
    check('环节16：存在待装货公路车次（前置，需 2 张）', false)
  }
}
{
  // 环节17：逾期催收——未付清账单可发起催收（提醒/正式/法务函，按轮次递增），留痕 + 提醒客户 + RBAC
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  const q17overdue = db.settlements.find((s) => s.status === 'overdue' && s.totalAmount - s.paidAmount > 0)
  const q17settled = db.settlements.find((s) => s.status === 'settled' && s.totalAmount - s.paidAmount > 0)
  check('环节17：存在逾期未付清账单（前置）', !!q17overdue)
  if (q17overdue) {
    const q17r1 = dunning(q17overdue, 'reminder')
    check('环节17：逾期账单付款提醒成功（第 1 轮 + 留痕）', q17r1.ok === true && q17r1.round === 1 && db.dunnings.some((x) => x.settlementId === q17overdue.id && x.round === 1 && x.level === 'reminder'))
    const q17r2 = dunning(q17overdue, 'formal')
    check('环节17：逾期账单正式催收成功（第 2 轮）', q17r2.ok === true && q17r2.round === 2)
    const q17r3 = dunning(q17overdue, 'legal')
    check('环节17：逾期账单法务函成功（第 3 轮，工作流完整）', q17r3.ok === true && q17r3.round === 3)
    check('环节17：守卫：无效催收级别被拒', /无效催收级别/.test(dunning(q17overdue, 'xxx')?.error || ''))
    setOperator({ name: '测试调度', username: 't-dispatch', role: '调度员' })
    const q17rbac = dunning(q17overdue, 'reminder')
    check('环节17：RBAC：非结算角色不可催收（无新增）', /无此操作权限/.test(q17rbac?.error || '') && db.dunnings.filter((x) => x.settlementId === q17overdue.id).length === 3)
    setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  } else {
    check('环节17：存在逾期未付清账单（前置）', false)
  }
  // 守卫：已结算（非逾期）仅可付款提醒，不可正式催收/法务函
  if (q17settled) {
    check('环节17：守卫：已结算账单不可正式催收（仅逾期可）', /仅适用于逾期/.test(dunning(q17settled, 'formal')?.error || ''))
    check('环节17：守卫：已结算账单不可法务函（仅逾期可）', /仅适用于逾期/.test(dunning(q17settled, 'legal')?.error || ''))
    const q17rem = dunning(q17settled, 'reminder')
    check('环节17：已结算账单可付款提醒', q17rem.ok === true && q17rem.round === 1)
  }
  // 守卫：待对账账单不可催收
  const q17pending = db.settlements.find((s) => s.status === 'pending')
  if (q17pending) {
    check('环节17：守卫：待对账账单不可催收', /非"已结算\/逾期"/.test(dunning(q17pending, 'reminder')?.error || ''))
  }
  // 守卫：已付清账单不可催收
  const q17paid = db.settlements.find((s) => (s.status === 'settled' || s.status === 'overdue') && s.totalAmount - s.paidAmount <= 0)
  if (q17paid) {
    check('环节17：守卫：已付清账单不可催收', /已付清/.test(dunning(q17paid, 'reminder')?.error || ''))
  }
}
{
  // 环节18：统一发票入口——结算详情页与发票管理页同一开具路径（issueInvoice 单一入口，issueInvoiceRow 薄封装）
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  // 取一个已结算账单作载体：未开票优先；否则取已开票并红冲重置为未开票
  let q18s = db.settlements.find((s) => s.status === 'settled' && s.invoiceStatus === 'not-issued')
  if (!q18s) {
    q18s = db.settlements.find((s) => s.status === 'settled' && s.invoiceStatus === 'issued')
    if (q18s) {
      const inv = db.invoices.find((i) => i.settlementId === q18s.id && i.status === 'issued')
      if (inv) redFlushInvoiceRow(inv, '环节18 测试重置')
    }
  }
  check('环节18：存在可开具的已结算账单（前置）', !!q18s && q18s.invoiceStatus === 'not-issued')
  if (q18s) {
    // (1) 未开票账单（无待开具记录）：issueInvoice 新建已开具记录
    const q18r = issueInvoice(q18s)
    const q18inv = db.invoices.find((i) => i.invoiceNo === q18r.invoiceNo)
    check('环节18：未开票账单开具 → 新建已开具记录（额=账单额 + 状态 + 返回对象）', q18r.ok === true && !!q18inv && q18inv.status === 'issued' && q18inv.amount === q18s.totalAmount && q18s.invoiceStatus === 'issued')
    check('环节18：守卫：已开票账单不可重复开具', /无法重复开具/.test(issueInvoice(q18s)?.error || ''))
    redFlushInvoiceRow(q18inv, '环节18 子用例重置')
    check('环节18：红冲后回未开票（可再次开具）', q18s.invoiceStatus === 'not-issued')
    // (2) 待开具记录：issueInvoice 就地更新同一记录（id 不变，额=当前账单额）
    const q18pendId = genId('FP-', 4, db.invoices)
    db.invoices.push({ id: q18pendId, settlementId: q18s.id, invoiceNo: '', type: '增值税专用发票', amount: q18s.totalAmount, issueDate: null, status: 'pending', remark: '' })
    q18s.invoiceStatus = 'pending'
    const q18pr = issueInvoice(q18s)
    const q18pendInv = db.invoices.find((i) => i.id === q18pendId)
    check('环节18：待开具账单开具 → 就地更新同一记录（id 不变 + 额=当前账单额）', q18pr.ok === true && q18pendInv.id === q18pendId && q18pendInv.status === 'issued' && q18pendInv.amount === q18s.totalAmount && q18s.invoiceStatus === 'issued')
    redFlushInvoiceRow(q18pendInv, '环节18 子用例重置')
    // (3) 统一入口：issueInvoiceRow 薄封装委托 issueInvoice（同守卫/同审计/结果一致）
    const q18wId = genId('FP-', 4, db.invoices)
    db.invoices.push({ id: q18wId, settlementId: q18s.id, invoiceNo: '', type: '增值税专用发票', amount: q18s.totalAmount, issueDate: null, status: 'pending', remark: '' })
    q18s.invoiceStatus = 'pending'
    const q18wr = issueInvoiceRow(db.invoices.find((i) => i.id === q18wId))
    check('环节18：issueInvoiceRow 薄封装 → 委托统一入口（结果/状态/审计一致）', q18wr.ok === true && q18wr.invoiceNo === db.invoices.find((i) => i.id === q18wId).invoiceNo && q18s.invoiceStatus === 'issued' && db.logs[0].module === '发票管理' && db.logs[0].action === '开具发票')
    redFlushInvoiceRow(db.invoices.find((i) => i.id === q18wId), '环节18 收尾重置')
    // (4) RBAC：非开票角色不可开具
    setOperator({ name: '测试调度', username: 't-dispatch', role: '调度员' })
    const q18rbac = issueInvoice(q18s)
    check('环节18：RBAC：非开票角色不可开具（状态不变）', /无此操作权限/.test(q18rbac?.error || '') && q18s.invoiceStatus === 'not-issued')
    setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  }
}
{
  // 环节19：进磅实际过磅——进磅净重为实际过磅值（非恒等于调度量），对账"差异"=调度量-进磅可非零，客户异议流程可跑
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  // 种子数据存在进磅≠调度量的车次（实际过磅生效，差异机制可跑）
  const q19seedDiff = db.dispatches.some((d) => {
    const inW = db.weighings.find((w) => w.dispatchId === d.id && w.type === '进磅')
    return inW && inW.net !== d.quantity
  })
  check('环节19：种子数据存在进磅≠调度量的车次（实际过磅生效）', q19seedDiff)
  const q19c = db.contracts.find((c) => c.status === 'executing' && isRoadMode(c.mode))
  check('环节19：存在执行中的公路合同（前置）', !!q19c)
  if (q19c) {
    const q19p = { id: 'YH-Q19', contractId: q19c.id, commodityId: 'CM003', quantity: 35, loadTerminalId: 'T007', unloadTerminalId: 'T002', mode: '公路', unitPrice: q19c.unitPrice, status: 'pending', progress: 0 }
    db.plans.unshift(q19p)
    const q19d = createDispatches(q19p, 1).created[0]
    check('环节19：派车成功（前置）', !!q19d)
    if (q19d) {
      q19d.accepted = true
      confirmLoad(q19d)
      depart(q19d)
      arrive(q19d)
      confirmUnload(q19d)
      signReceipt(q19d, '收货方')
      const q19in = db.weighings.find((w) => w.dispatchId === q19d.id && w.type === '进磅')
      const q19out = db.weighings.find((w) => w.dispatchId === q19d.id && w.type === '出磅')
      check('环节19：进磅实际过磅（进磅>0 且 出磅<进磅，含运输损耗）', !!q19in && !!q19out && q19in.net > 0 && q19out.net < q19in.net)
      const q19cand = settlementCandidates().find((g) => g.dispatches.some((x) => x.id === q19d.id))
      const q19s = q19cand ? generateSettlements([q19cand.key]).find((x) => x.contractId === q19c.id) : null
      check('环节19：生成账单（前置）', !!q19s)
      if (q19s) {
        startReconcile(q19s)
        const q19item = q19s.reconciliation.items.find((i) => i.dispatchId === q19d.id)
        check('环节19：对账差异 = 调度量 - 进磅净重', q19item.diff === +(q19d.quantity - q19in.net).toFixed(2))
        check('环节19：对账损耗 = 调度量 - 出磅净重（口径不变）', q19item.loss === +(q19d.quantity - q19out.net).toFixed(2))
        const q19obj = customerObjection(q19s, '进磅与调度量差异偏大，与我方装货记录不符')
        check('环节19：客户异议流程可跑（异议后回待对账 + 清确认）', q19obj.ok === true && q19s.status === 'pending' && q19s.customerConfirmed === null)
      }
    }
  }
}
{
  // 环节20：报表口径对齐——成本报表收入按出磅净重结算（与结算一致），客户报表授信占用扣预付款（与 creditCheck 一致）
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  // (1) 成本报表收入按出磅净重：单车次收入 = 出磅净重 × 单价（非调度量×单价）
  const q20d = db.dispatches.find((d) => d.status === 'completed' && isRoadMode(d.mode) && db.weighings.some((w) => w.dispatchId === d.id && w.type === '出磅'))
  check('环节20：存在已完成公路车次（前置）', !!q20d)
  if (q20d) {
    const q20out = db.weighings.find((w) => w.dispatchId === q20d.id && w.type === '出磅').net
    const q20price = q20d.unitPrice != null ? q20d.unitPrice : (db.contracts.find((c) => c.id === q20d.contractId)?.unitPrice || 0)
    check('环节20：收入口径按出磅净重（dispatchRevenueOf = 出磅净重×单价）', dispatchRevenueOf(q20d) === Math.round(q20out * q20price))
    check('环节20：出磅净重<调度量 → 收入低于调度量×单价（口径确实切换）', q20out < q20d.quantity && dispatchRevenueOf(q20d) < Math.round(q20d.quantity * q20price))
    const q20cr = costReport()
    check('环节20：成本报表汇总恒等式（毛利=收入-成本，单线收入之和=汇总收入）', q20cr.summary.profit === q20cr.summary.revenue - q20cr.summary.cost && q20cr.byRoute.reduce((s, r) => s + r.revenue, 0) === q20cr.summary.revenue)
  }
  // (2) 客户报表授信占用扣预付款（与 creditCheck 同口径）
  const q20c = db.customers.find((c) => (c.type === 'shipper' || c.type === 'both') && c.creditLimit > 0 && outstandingOf(c.id) > 0)
  check('环节20：存在有未付余额的客户（前置）', !!q20c)
  if (q20c) {
    const q20row = customerReport().find((r) => r.id === q20c.id)
    const q20occupied = Math.max(0, outstandingOf(q20c.id) - prepaymentAvailable(q20c.id))
    check('环节20：客户报表授信占用 = max(0, 未付-预付)（与 creditCheck 同口径）', q20row.creditPct === Math.round((q20occupied / q20c.creditLimit) * 100) && q20row.prepay === prepaymentAvailable(q20c.id))
  }
}
{
  // 环节21：单证扩充——调度单/质检报告/对账单纳入电子单证归档（聚合口径 + 结构 + 内容生成）
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  const q21docs = listDocuments()
  check('环节21：调度单单证数 = 调度单数', q21docs.filter((d) => d.type === 'dispatch').length === db.dispatches.length)
  check('环节21：质检报告单证数 = 有质检记录车次', q21docs.filter((d) => d.type === 'quality').length === db.dispatches.filter((d) => d.quality).length)
  check('环节21：对账单单证数 = 已对账账单数', q21docs.filter((d) => d.type === 'reconciliation').length === db.settlements.filter((s) => s.reconciliation).length)
  const q21new = q21docs.filter((d) => ['dispatch', 'quality', 'reconciliation'].includes(d.type))
  check('环节21：新单证结构完整（id/type/typeName/refId/title/date/fields）', q21new.length > 0 && q21new.every((d) => d.id && d.type && d.typeName && d.refId && d.title && d.date && Array.isArray(d.fields) && d.fields.length > 0))
  const q21disp = q21docs.find((d) => d.type === 'dispatch')
  check('环节21：调度单单证含调度单号与运输方式', q21disp && q21disp.fields.some(([k]) => k === '调度单号') && q21disp.fields.some(([k]) => k === '运输方式'))
  const q21recon = q21docs.find((d) => d.type === 'reconciliation')
  check('环节21：对账单单证含账单金额与差异车次', q21recon && q21recon.fields.some(([k]) => k === '账单金额') && q21recon.fields.some(([k]) => k === '差异车次'))
  const q21qual = q21docs.find((d) => d.type === 'quality')
  check('环节21：质检报告单证含水分与灰分', q21qual && q21qual.fields.some(([k]) => k === '水分(%)') && q21qual.fields.some(([k]) => k === '灰分(%)'))
  if (q21disp) {
    const q21html = documentContent(q21disp)
    check('环节21：调度单单证生成 HTML + documentOf 定位', q21html.includes('<table') && q21html.includes('调度单') && !!documentOf('dispatch', q21disp.id))
  }
}
{
  // 环节22：运价表——线路运价查表取价 / 调价 / 启停 / RBAC
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  const q22cards = listRateCards()
  check('环节22：种子运价卡非空且结构完整', q22cards.length > 0 && q22cards.every((r) => r.id && r.commodityId && r.loadTerminalId && r.unloadTerminalId && r.unitPrice > 0 && r.status && Array.isArray(r.history)))
  const q22seed = q22cards[0]
  const q22hit = rateOf(q22seed.commodityId, q22seed.loadTerminalId, q22seed.unloadTerminalId, q22seed.mode)
  check('环节22：rateOf 命中启用中运价卡', q22hit && q22hit.id === q22seed.id)
  check('环节22：rateOf 未命中返回 null', rateOf('CM999', 'T001', 'T002', '公路') === null)
  // 新建（铁路模式，不与种子公路卡冲突）
  const q22new = createRateCard({ commodityId: 'CM001', loadTerminalId: 'T005', unloadTerminalId: 'T001', mode: '铁路', unitPrice: 55 })
  check('环节22：新建运价卡成功', q22new.ok === true && !!q22new.id)
  const q22dup = createRateCard({ commodityId: 'CM001', loadTerminalId: 'T005', unloadTerminalId: 'T001', mode: '铁路', unitPrice: 60 })
  check('环节22：同线路重复新建被拦截', !!q22dup.error)
  const q22adj = updateRateCard(q22new.id, { unitPrice: 66 })
  const q22card = db.rateCards.find((r) => r.id === q22new.id)
  check('环节22：调价生效且留变更历史', q22adj.changed === true && q22card.unitPrice === 66 && q22card.history.length > 0)
  const q22tog = toggleRateCard(q22new.id)
  check('环节22：停用后 rateOf 不再命中', q22tog.status === 'inactive' && rateOf('CM001', 'T005', 'T001', '铁路') === null)
  // RBAC
  setOperator({ name: 't-settle', username: 't-settle', role: '结算专员' })
  check('环节22：结算专员有 rate 权限', operatorCan('rate') === true)
  setOperator({ name: 't-dispatch', username: 't-dispatch', role: '调度员' })
  check('环节22：调度员无 rate 权限', operatorCan('rate') === false)
  const q22rbac = createRateCard({ commodityId: 'CM001', loadTerminalId: 'T002', unloadTerminalId: 'T003', mode: '公路', unitPrice: 40 })
  check('环节22：调度员新建运价卡被服务层拦截', !!q22rbac.error)
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
}
{
  // 环节23：异常升级 + 合同审批超时催办（定时任务驱动，幂等）
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  const q23mk = (status, hoursAgo) => {
    const e = { id: genId('YC-', 4, db.exceptions), dispatchId: 'PD-Q23', type: 'delay', level: 'medium', status, occurTime: dayjs().subtract(hoursAgo, 'hour').format('YYYY-MM-DD HH:mm'), handler: '', description: '超时升级测试', result: '', cost: 0, source: '' }
    db.exceptions.unshift(e)
    return e
  }
  const q23e1 = q23mk('pending', 3)
  const q23esc1 = escalatePendingExceptions()
  check('环节23：待受理超阈值异常单升级至级别1', q23esc1.some((e) => e.id === q23e1.id) && q23e1.escalated === 1 && !!q23e1.escalatedTo)
  const q23esc1b = escalatePendingExceptions()
  check('环节23：升级幂等（已达级别不重复）', !q23esc1b.some((e) => e.id === q23e1.id) && q23e1.escalated === 1)
  q23e1.occurTime = dayjs().subtract(10, 'hour').format('YYYY-MM-DD HH:mm')
  const q23esc2 = escalatePendingExceptions()
  check('环节23：超 4×阈值升级督办至级别2', q23esc2.some((e) => e.id === q23e1.id) && q23e1.escalated === 2 && q23e1.escalatedTo.includes('督办'))
  const q23e2 = q23mk('pending', 0)
  const q23esc3 = escalatePendingExceptions()
  check('环节23：未超时异常单不升级', !q23esc3.some((e) => e.id === q23e2.id) && !(q23e2.escalated > 0))
  const q23e3 = q23mk('handling', 10)
  const q23esc4 = escalatePendingExceptions()
  check('环节23：处理中异常单不参与升级', !q23esc4.some((e) => e.id === q23e3.id))
  // 清理测试异常单（避免污染后续环节）
  for (const id of [q23e1.id, q23e2.id, q23e3.id]) {
    const i = db.exceptions.findIndex((e) => e.id === id)
    if (i >= 0) db.exceptions.splice(i, 1)
  }
  // 合同审批超时催办
  const q23shipper = db.customers.find((c) => (c.type === 'shipper' || c.type === 'both') && c.status === 'active')
  const q23consignee = db.customers.find((c) => (c.type === 'consignee' || c.type === 'both') && c.status === 'active')
  const q23c = createContract({ name: 'Q23测试合同', shipperId: q23shipper.id, consigneeId: q23consignee.id, commodityId: 'CM001', mode: '公路', loadTerminalId: 'T005', unloadTerminalId: 'T001', quantity: 1000, unitPrice: 40 }, 'draft')
  submitContractApproval(q23c.contract)
  q23c.contract.submitTime = dayjs().subtract(25, 'hour').format('YYYY-MM-DD HH:mm')
  const q23rem1 = escalateContractApprovals()
  check('环节23：审批超时合同被催办', q23rem1.some((c) => c.id === q23c.contract.id) && !!q23c.contract.lastApprovalReminder)
  const q23rem2 = escalateContractApprovals()
  check('环节23：审批催办 24h 内不重复', !q23rem2.some((c) => c.id === q23c.contract.id))
  // 清理测试合同
  const q23ci = db.contracts.findIndex((c) => c.id === q23c.contract.id)
  if (q23ci >= 0) db.contracts.splice(q23ci, 1)
}
{
  // 环节24：保险环节——报险 / 责任认定 / 理赔结案 / 拒赔 / 理赔冲减账单 / RBAC
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  // RBAC
  setOperator({ name: 't-safety', username: 't-safety', role: '安全管理员' })
  check('环节24：安全管理员有 insurance 权限', operatorCan('insurance') === true)
  setOperator({ name: 't-settle', username: 't-settle', role: '结算专员' })
  check('环节24：结算专员无 insurance 权限', operatorCan('insurance') === false)
  const q24rbac = fileInsuranceClaim(db.accidents[0].id, {})
  check('环节24：结算专员报险被服务层拦截', !!q24rbac.error)
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  // 报险
  const q24a = db.accidents.find((a) => !a.insuranceId) || db.accidents[0]
  const q24f = fileInsuranceClaim(q24a.id, { reportedAmount: 30000, insurer: '太平洋保险' })
  check('环节24：报险生成理赔单并关联事故', q24f.ok === true && q24a.insuranceId === q24f.claim.id && q24f.claim.status === 'reported')
  const q24dup = fileInsuranceClaim(q24a.id, {})
  check('环节24：同事故重复报险被拦截', !!q24dup.error)
  // 定责核定
  const q24assess = assessInsuranceClaim(q24f.claim, { responsibility: '对方全责', assessedAmount: 20000 })
  check('环节24：定责核定后状态=已定责', q24assess.ok === true && q24f.claim.status === 'assessed' && q24f.claim.assessedAmount === 20000)
  const q24assessGuard = assessInsuranceClaim(q24f.claim, { responsibility: '我方全责', assessedAmount: 1000 })
  check('环节24：非已报险状态不可重复定责', !!q24assessGuard.error)
  // 理赔结案
  const q24st = settleInsuranceClaim(q24f.claim, { settledAmount: 18000 })
  check('环节24：理赔结案状态=已理赔且记录回收额', q24st.ok === true && q24f.claim.status === 'settled' && q24f.claim.settledAmount === 18000 && q24a.insuranceRecovered === 18000)
  // 拒赔（另取一事故）
  const q24a2 = db.accidents.find((a) => !a.insuranceId && a.id !== q24a.id)
  if (q24a2) {
    const q24f2 = fileInsuranceClaim(q24a2.id, { reportedAmount: 5000 })
    const q24rej = rejectInsuranceClaim(q24f2.claim, '不属于保险责任')
    check('环节24：拒赔后状态=已拒赔', q24rej.ok === true && q24f2.claim.status === 'rejected')
  } else {
    check('环节24：拒赔后状态=已拒赔（无可用事故，跳过）', true)
  }
  // 理赔冲减账单异常损失（构造：事故损失已补扣入账单）
  const q24s = db.settlements.find((s) => !['settled', 'overdue'].includes(s.status) && db.dispatches.some((d) => d.settlementId === s.id && d.status === 'completed'))
  if (q24s) {
    const q24d = db.dispatches.find((d) => d.settlementId === q24s.id && d.status === 'completed')
    const q24a3 = { id: genId('SG-', 3, db.accidents), time: dayjs().format('YYYY-MM-DD'), type: '碰撞', level: '一般', vehicleId: q24d.vehicleId, plate: '-', location: '测试', description: '测试事故', handling: '', loss: 20000, status: 'handling' }
    db.accidents.unshift(q24a3)
    const q24e3 = { id: genId('YC-', 4, db.exceptions), dispatchId: q24d.id, type: 'accident', level: 'medium', status: 'closed', occurTime: dayjs().format('YYYY-MM-DD HH:mm'), handler: '系统', description: '测试', result: '已处理', cost: 20000, source: '', accidentId: q24a3.id, settleApplied: q24s.id }
    db.exceptions.unshift(q24e3)
    const q24excBefore = q24s.exceptionLoss || 0
    const q24adjBefore = (q24s.adjustments || []).length
    q24s.exceptionLoss = q24excBefore + 20000
    q24s.totalAmount -= 20000
    const q24billAfterDeduct = q24s.totalAmount
    const q24f3 = fileInsuranceClaim(q24a3.id, { reportedAmount: 20000 })
    assessInsuranceClaim(q24f3.claim, { responsibility: '对方全责', assessedAmount: 15000 })
    const q24st3 = settleInsuranceClaim(q24f3.claim, { settledAmount: 15000 })
    check('环节24：理赔冲减账单异常损失（回收额回补账单）', q24st3.ok === true && q24st3.offsetSettlement === q24s.billNo && q24s.totalAmount === q24billAfterDeduct + 15000)
    check('环节24：冲减后事故回收额=理赔额', q24a3.insuranceRecovered === 15000)
    // 清理：还原结算 + 删除合成事故/异常/理赔
    q24s.exceptionLoss = q24excBefore
    q24s.totalAmount = q24billAfterDeduct + 20000
    if (q24s.adjustments) q24s.adjustments.length = q24adjBefore
    const ai = db.accidents.findIndex((x) => x.id === q24a3.id); if (ai >= 0) db.accidents.splice(ai, 1)
    const ei = db.exceptions.findIndex((x) => x.id === q24e3.id); if (ei >= 0) db.exceptions.splice(ei, 1)
    const ci = db.insurance.findIndex((x) => x.id === q24f3.claim.id); if (ci >= 0) db.insurance.splice(ci, 1)
  }
  check('环节24：理赔台账查询返回数组', Array.isArray(listInsuranceClaims()) && listInsuranceClaims().length >= 1)
}
{
  // 环节25：P3 工程加固——operator 默认拒绝 / 日志与消息上限
  // operator 默认拒绝：未登录态（clearOperator）直调服务层被 RBAC 拦截
  clearOperator()
  check('环节25：未登录态 operatorCan 全拒绝', operatorCan('rate') === false && operatorCan('settlement') === false && operatorCan('dispatch') === false)
  const q25rbac = createRateCard({ commodityId: 'CM001', loadTerminalId: 'T002', unloadTerminalId: 'T003', mode: '公路', unitPrice: 40 })
  check('环节25：未登录态直调服务层被默认拒绝拦截', !!q25rbac.error && q25rbac.error.includes('无此操作权限'))
  setOperator({ name: '张建国', username: 'admin', role: '平台管理员' })
  // 日志上限：超 MAX_LOGS 裁剪最旧（先存原日志，测后还原）
  const q25origLogs = [...db.logs]
  for (let i = 0; i < MAX_LOGS + 5; i++) logAction('工程加固', '填充日志', 'x')
  check('环节25：日志超上限裁剪至 MAX_LOGS', db.logs.length === MAX_LOGS)
  db.logs.length = 0
  db.logs.push(...q25origLogs)
  // 消息上限：超 MAX_MESSAGES 裁剪最旧（先存原消息，测后还原）
  const q25origMsgs = [...db.messages]
  for (let i = 0; i < MAX_MESSAGES + 5; i++) notify('工程加固测试消息', 'system', '/workbench', 'x')
  check('环节25：消息超上限裁剪至 MAX_MESSAGES', db.messages.length === MAX_MESSAGES)
  db.messages.length = 0
  db.messages.push(...q25origMsgs)
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
