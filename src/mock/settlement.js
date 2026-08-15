import { db, rng, randInt, NOW } from './base'
import dayjs from 'dayjs'

/**
 * 结算单：按合同月度汇总
 * 状态：settled 12 / reconciling 8 / pending 7 / overdue 3
 */
const settleContracts = db.contracts.filter((c) => c.status === 'executing' || c.status === 'completed')

db.settlements = Array.from({ length: 30 }, (_, i) => {
  const contract = settleContracts[i % settleContracts.length]
  const status = i < 12 ? 'settled' : i < 20 ? 'reconciling' : i < 27 ? 'pending' : 'overdue'
  const month = dayjs(NOW).subtract(randInt(0, 5), 'month').format('YYYY-MM')
  const dispatchCount = randInt(20, 200)
  const totalQuantity = Math.round(dispatchCount * 35)
  const freight = Math.round(totalQuantity * contract.unitPrice)
  const loadingFee = Math.round(totalQuantity * 8)
  const unloadingFee = Math.round(totalQuantity * 6)
  const tollFee = randInt(5000, 50000)
  const surcharge = randInt(0, 20000)
  const totalAmount = freight + loadingFee + unloadingFee + tollFee + surcharge
  const paidAmount =
    status === 'settled' ? totalAmount : status === 'reconciling' ? Math.round(totalAmount * 0.5) : 0

  return {
    id: `JS-${String(i + 1).padStart(4, '0')}`,
    billNo: `BL-${month.replace('-', '')}-${String(i + 1).padStart(3, '0')}`,
    contractId: contract.id,
    customerId: contract.shipperId,
    period: month,
    dispatchCount,
    totalQuantity,
    freight,
    loadingFee,
    unloadingFee,
    tollFee,
    surcharge,
    totalAmount,
    paidAmount,
    status,
    settleDate: status === 'settled' ? dayjs(NOW).subtract(randInt(1, 60), 'day').format('YYYY-MM-DD') : null,
    invoiceStatus: status === 'settled' ? (rng() < 0.8 ? 'issued' : 'pending') : 'not-issued',
    remark: ''
  }
})

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
