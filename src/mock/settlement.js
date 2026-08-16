import { db, rng, randInt, pick, NOW } from './base'
import { buildReconciliation, calcSettlementFees } from './flow'
import dayjs from 'dayjs'

/**
 * 结算单：按合同汇总已完成车次，按磅结算（出磅净重），损耗/异常损失扣减
 * 状态：pending 待对账 / reconciling 对账中 / settled 已结算 / overdue 逾期（超账期未付清）
 * 车次通过 settled/settlementId 标记已入账单，避免重复结算（见 flow.generateSettlements）
 */
const settleContracts = db.contracts.filter((c) => c.status === 'executing' || c.status === 'completed')

db.settlements = []
let sSeq = 0
for (const contract of settleContracts) {
  const done = db.dispatches.filter((d) => d.contractId === contract.id && d.status === 'completed')
  if (!done.length) continue
  sSeq += 1
  const period = dayjs(NOW).subtract(randInt(0, 2), 'month').format('YYYY-MM')
  const fees = calcSettlementFees(contract, done)
  const tollFee = randInt(2000, 20000)
  const surcharge = randInt(0, 8000)
  const totalAmount = fees.freight + fees.loadingFee + fees.unloadingFee + tollFee + surcharge - fees.lossDeduction - fees.exceptionLoss

  // 状态按规则生成：待对账/对账中（流程态）→ 已结算；超账期未付清 → 逾期
  const r = rng()
  let status
  let settleDate = null
  let paidAmount = 0
  if (r < 0.4) {
    status = 'pending'
  } else if (r < 0.65) {
    status = 'reconciling'
    paidAmount = Math.round(totalAmount * 0.5) // 预付 50%
  } else {
    settleDate = dayjs(NOW).subtract(randInt(1, 60), 'day').format('YYYY-MM-DD')
    if (dayjs(settleDate).add(contract.paymentDays, 'day').isBefore(NOW)) {
      status = 'overdue'
      paidAmount = rng() < 0.5 ? 0 : Math.round(totalAmount * 0.5)
    } else {
      status = 'settled'
      paidAmount = totalAmount
    }
  }

  const s = {
    id: `JS-${String(sSeq).padStart(4, '0')}`,
    billNo: `BL-${period.replace('-', '')}-${String(sSeq).padStart(3, '0')}`,
    contractId: contract.id,
    customerId: contract.shipperId,
    period,
    dispatchCount: done.length,
    ...fees,
    tollFee,
    surcharge,
    totalAmount,
    paidAmount,
    status,
    settleDate,
    invoiceStatus: status === 'settled' ? (rng() < 0.8 ? 'issued' : 'pending') : 'not-issued',
    reconciliation: null,
    remark: ''
  }
  db.settlements.push(s)
  // 标记车次已入账单，防止"生成结算单"重复聚合
  for (const d of done) {
    d.settled = true
    d.settlementId = s.id
  }
}

// 保证客户门户演示：晋能（CUS001）至少一张"对账中"账单，可演示"确认对账"
// （确定性种子下随机状态未必命中 CUS001，故兜底将一张"待对账"账单转为"对账中"）
if (!db.settlements.some((s) => s.customerId === 'CUS001' && s.status === 'reconciling')) {
  const target = db.settlements.find((s) => s.customerId === 'CUS001' && s.status === 'pending')
  if (target) {
    target.status = 'reconciling'
    target.paidAmount = Math.round(target.totalAmount * 0.5) // 预付 50%，与对账中口径一致
  }
}

// 非待对账账单预生成对账比对结果（待对账的由用户在详情页发起）
for (const s of db.settlements) {
  if (s.status === 'pending') continue
  buildReconciliation(
    s,
    s.settleDate
      ? `${s.settleDate} 10:00`
      : dayjs(NOW).subtract(randInt(1, 5), 'day').format('YYYY-MM-DD HH:mm')
  )
}

/** 收款流水：已结算账单 预付+尾款 两笔；对账中账单一笔预付 */
db.payments = []
let paySeq = 0
function pushPay(s, amount, payTime, method, remark) {
  paySeq += 1
  db.payments.push({
    id: `SK-${String(paySeq).padStart(4, '0')}`,
    settlementId: s.id,
    amount,
    payTime,
    method,
    remark
  })
}
for (const s of db.settlements) {
  if (!s.paidAmount) continue
  if (s.status === 'settled') {
    const half = Math.round(s.paidAmount / 2)
    pushPay(s, half, `${s.settleDate} 10:00`, pick(['银行转账', '承兑汇票']), '预付')
    pushPay(s, s.paidAmount - half, dayjs(NOW).subtract(randInt(1, 15), 'day').format('YYYY-MM-DD HH:mm'), pick(['银行转账', '支票']), '尾款')
  } else {
    pushPay(s, s.paidAmount, dayjs(NOW).subtract(randInt(1, 10), 'day').format('YYYY-MM-DD HH:mm'), pick(['银行转账', '承兑汇票']), '预付')
  }
}

/** 发票 */
db.invoices = []
let fpSeq = 0
for (const s of db.settlements) {
  if (s.invoiceStatus === 'not-issued') continue
  fpSeq += 1
  const issued = s.invoiceStatus === 'issued'
  db.invoices.push({
    id: `FP-${String(fpSeq).padStart(4, '0')}`,
    settlementId: s.id,
    invoiceNo: issued ? '2410' + String(randInt(100000000000, 999999999999)) : '',
    type: rng() < 0.7 ? '增值税专用发票' : '增值税普通发票',
    amount: s.totalAmount,
    issueDate: issued ? (s.settleDate || dayjs(NOW).format('YYYY-MM-DD')) : null,
    status: issued ? (rng() < 0.9 ? 'issued' : 'red-flushed') : 'pending',
    remark: ''
  })
}
