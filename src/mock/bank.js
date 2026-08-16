import { db, NOW } from './base'
import { mulberry32 } from '@/utils'
import dayjs from 'dayjs'

/**
 * 银行流水（G8 收款核销）：银行侧到账流水，与收款流水（db.payments）对账
 * - 已登记收款的银行转账 → matched（对账基线，核销历史）
 * - 客户已转账但平台未登记的到账 → unmatched（自动/手动核销演示）
 * 独立随机源，不扰动全局种子序列
 */
const brng = mulberry32(20260817)
const bRandInt = (min, max) => Math.floor(brng() * (max - min + 1)) + min

db.bankRecords = []
let bSeq = 0
function pushBank(record) {
  bSeq += 1
  record.id = `YH-${String(bSeq).padStart(4, '0')}`
  db.bankRecords.push(record)
}

// 1) 已核销：每笔银行转账收款对应一条银行流水
for (const p of db.payments) {
  if (p.method !== '银行转账') continue
  const s = db.settlements.find((x) => x.id === p.settlementId)
  const c = db.customers.find((x) => x.id === s?.customerId)
  pushBank({
    accountNo: '6222 **** **** 8899',
    counterparty: c ? c.name : '-',
    amount: p.amount,
    time: p.payTime,
    summary: `运费付款 ${s ? s.billNo : ''}`,
    status: 'matched',
    settlementId: p.settlementId,
    matchTime: p.payTime,
    matchBy: '系统'
  })
}

// 2) 待核销：部分逾期账单已有银行到账但平台未登记（自动核销演示：金额=未付余额，精确匹配）
//    首张逾期账单必命中，保证自动核销演示可复现；其余按随机概率
const overdueWithUnpaid = db.settlements.filter((x) => x.status === 'overdue' && x.totalAmount - x.paidAmount > 0)
overdueWithUnpaid.forEach((s, i) => {
  if (i > 0 && brng() >= 0.6) return
  const c = db.customers.find((x) => x.id === s.customerId)
  pushBank({
    accountNo: '6222 **** **** 8899',
    counterparty: c ? c.name : '-',
    amount: s.totalAmount - s.paidAmount,
    time: dayjs(NOW).subtract(bRandInt(1, 10), 'day').format('YYYY-MM-DD HH:mm'),
    summary: `运费付款 ${s.billNo}`,
    status: 'unmatched',
    settlementId: null,
    matchTime: null,
    matchBy: ''
  })
})

// 3) 待核销：一笔其他往来（质量保证金），金额不匹配任何账单未付余额 → 人工审核口径
pushBank({
  accountNo: '6222 **** **** 8899',
  counterparty: db.customers[bRandInt(0, 5)].name,
  amount: bRandInt(5, 20) * 10000,
  time: dayjs(NOW).subtract(bRandInt(1, 5), 'day').format('YYYY-MM-DD HH:mm'),
  summary: '质量保证金',
  status: 'unmatched',
  settlementId: null,
  matchTime: null,
  matchBy: ''
})
