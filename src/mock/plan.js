import { db, rng, randInt, NOW } from './base'
import dayjs from 'dayjs'

/**
 * 运输计划：合同拆分为若干批次（每批 3-8 车，单车 30-40 吨）
 * 状态与日期联动：未来=pending，近七天=dispatched/intransit，更早=completed
 * 进度不在此处写死，由 flow.js 按调度单实际执行回卷
 */
const executable = db.contracts.filter((c) => c.status === 'executing' || c.status === 'completed')

db.plans = Array.from({ length: 60 }, (_, i) => {
  const contract = executable[i % executable.length]
  const daysAgo = randInt(-10, 25) // -10 ~ 25 天前
  const planDate = dayjs(NOW).subtract(daysAgo, 'day')

  let status
  if (daysAgo < 0) status = 'pending'
  else if (daysAgo <= 7) status = rng() < 0.5 ? 'dispatched' : 'intransit'
  else status = rng() < 0.93 ? 'completed' : 'cancelled'

  return {
    id: `YH-${String(i + 1).padStart(4, '0')}`,
    contractId: contract.id,
    commodityId: contract.commodityId,
    quantity: randInt(3, 8) * 35,
    loadTerminalId: contract.loadTerminalId,
    unloadTerminalId: contract.unloadTerminalId,
    mode: contract.mode,
    planDate: planDate.format('YYYY-MM-DD'),
    unitPrice: contract.unitPrice,
    status,
    progress: 0,
    remark: ''
  }
})

/** 回填合同计划量：按已拆批总量上浮 10-30%，保证合同进度口径与执行数据一致 */
for (const c of executable) {
  const total = db.plans.filter((p) => p.contractId === c.id).reduce((s, p) => s + p.quantity, 0)
  if (!total) continue
  c.quantity = Math.ceil((total * (1.1 + rng() * 0.2)) / 35) * 35
  c.amount = Math.round(c.quantity * c.unitPrice)
}
