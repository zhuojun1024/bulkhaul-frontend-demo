import { db, rng, randInt, pick, NOW, ROUTES, randomPhone } from './base'
import dayjs from 'dayjs'
import { round } from '@/utils'

const shippers = db.customers.filter((c) => c.type === 'shipper' || c.type === 'both')
const consignees = db.customers.filter((c) => c.type === 'consignee' || c.type === 'both')

function modeOf(commodityId) {
  if (commodityId === 'CM013') return '管道'
  const r = rng()
  if (r < 0.6) return '公路'
  if (r < 0.8) return '铁路'
  if (r < 0.92) return '水运'
  return '多式联运'
}

db.contracts = Array.from({ length: 40 }, (_, i) => {
  const route = ROUTES[i % ROUTES.length]
  const commodityId = pick(route.commodityIds)
  const commodity = db.commodities.find((c) => c.id === commodityId)
  const shipper = shippers[i % shippers.length]
  const consignee = consignees[(i * 3) % consignees.length]
  const status =
    i < 15 ? 'executing' : i < 27 ? 'completed' : i < 33 ? 'pending' : i < 36 ? 'draft' : 'terminated'

  // 车次口径（单车 30-40 吨，每合同约 8-30 车）；执行中/已完成合同的计划量由 plan.js 按拆批总量回填
  const quantity = randInt(8, 30) * 35
  const unitPrice = round(20 + route.distance * 0.12 + rng() * 15, 1)
  const start =
    status === 'executing'
      ? dayjs(NOW).subtract(randInt(10, 80), 'day')
      : status === 'completed'
        ? dayjs(NOW).subtract(randInt(120, 300), 'day')
        : dayjs(NOW).add(randInt(1, 30), 'day')
  const end = start.add(randInt(90, 365), 'day')

  return {
    id: `HT-${String(i + 1).padStart(4, '0')}`,
    name: `${shipper.name}→${consignee.name} ${commodity.name}运输合同`,
    shipperId: shipper.id,
    consigneeId: consignee.id,
    commodityId,
    mode: modeOf(commodityId),
    loadTerminalId: route.from,
    unloadTerminalId: route.to,
    quantity,
    unitPrice,
    amount: Math.round(quantity * unitPrice),
    // 确定性派生（不消耗全局 rng，避免扰动下游种子数据的随机序列）
    paymentDays: [30, 45, 60][i % 3],
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
    signDate: start.subtract(7, 'day').format('YYYY-MM-DD'),
    status,
    progress: status === 'executing' ? randInt(15, 88) : status === 'completed' ? 100 : 0,
    contact: shipper.contact,
    phone: randomPhone(),
    remark: '按月度计划分批执行，运费按月结算。'
  }
})
