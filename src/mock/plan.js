import { db, rng, randInt, pick, NOW } from './base'
import dayjs from 'dayjs'

/**
 * 运输计划：合同拆分为若干批次
 * 状态与日期联动：未来=pending，近三天=dispatched/intransit，更早=completed
 */
const executable = db.contracts.filter((c) => c.status === 'executing' || c.status === 'completed')

db.plans = Array.from({ length: 90 }, (_, i) => {
  const contract = executable[i % executable.length]
  const daysAgo = randInt(-10, 25) // -10 ~ 25 天前
  const planDate = dayjs(NOW).subtract(daysAgo, 'day')

  let status
  if (daysAgo < 0) status = 'pending'
  else if (daysAgo <= 2) status = pick(['dispatched', 'intransit'])
  else status = rng() < 0.93 ? 'completed' : 'cancelled'

  return {
    id: `YH-${String(i + 1).padStart(4, '0')}`,
    contractId: contract.id,
    commodityId: contract.commodityId,
    quantity: randInt(4, 25) * 100,
    loadTerminalId: contract.loadTerminalId,
    unloadTerminalId: contract.unloadTerminalId,
    mode: contract.mode,
    planDate: planDate.format('YYYY-MM-DD'),
    unitPrice: contract.unitPrice,
    status,
    progress: status === 'completed' ? 100 : status === 'pending' ? 0 : randInt(20, 80),
    remark: ''
  }
})
