import { db, NOW, ROUTES } from './base'
import dayjs from 'dayjs'
import { mulberry32, round } from '@/utils'

/**
 * 客户运输需求（客户门户发起 → 销售转为合同草稿）
 * 状态：pending(待处理) / converted(已转合同) / rejected(已驳回)
 * 独立随机源（与 driver.js 评分同口径），不消耗全局种子序列，避免扰动下游模块数据
 */
const rrng = mulberry32(20260816)
const randInt = (min, max) => Math.floor(rrng() * (max - min + 1)) + min
const pick = (arr) => arr[Math.floor(rrng() * arr.length)]

const shippers = db.customers.filter((c) => c.type === 'shipper' || c.type === 'both')
const consignees = db.customers.filter((c) => c.type === 'consignee' || c.type === 'both')

function makeRequest(seq, fields) {
  return {
    id: `YS-${String(seq).padStart(4, '0')}`,
    customerId: '',
    consigneeId: '',
    commodityId: '',
    quantity: 0,
    loadTerminalId: '',
    unloadTerminalId: '',
    mode: '公路',
    expectDate: dayjs(NOW).add(14, 'day').format('YYYY-MM-DD'),
    unitPrice: 0, // 客户期望单价（参考值，可为 0）
    remark: '',
    status: 'pending',
    createTime: dayjs(NOW).subtract(randInt(1, 10), 'day').format('YYYY-MM-DD HH:mm'),
    contractId: null,
    rejectReason: '',
    ...fields
  }
}

/** 随机待处理需求（线路/发货方/商品按线路派生） */
function randomRequest(seq) {
  const route = ROUTES[randInt(0, ROUTES.length - 1)]
  const shipper = shippers[randInt(0, shippers.length - 1)]
  return makeRequest(seq, {
    customerId: shipper.id,
    consigneeId: pick(consignees).id,
    commodityId: pick(route.commodityIds),
    quantity: randInt(8, 30) * 35,
    loadTerminalId: route.from,
    unloadTerminalId: route.to,
    unitPrice: round(18 + route.distance * 0.1, 1),
    expectDate: dayjs(NOW).add(randInt(3, 30), 'day').format('YYYY-MM-DD')
  })
}

db.transportRequests = []
// 1 条已转换需求：关联既有草稿合同（演示"需求→合同"闭环，字段与合同对齐）
const draftContract = db.contracts.find((c) => c.status === 'draft')
if (draftContract) {
  db.transportRequests.push(
    makeRequest(db.transportRequests.length + 1, {
      customerId: draftContract.shipperId,
      consigneeId: draftContract.consigneeId,
      commodityId: draftContract.commodityId,
      quantity: draftContract.quantity,
      loadTerminalId: draftContract.loadTerminalId,
      unloadTerminalId: draftContract.unloadTerminalId,
      mode: draftContract.mode,
      expectDate: draftContract.startDate,
      unitPrice: draftContract.unitPrice,
      remark: '门户需求转合同生成',
      status: 'converted',
      createTime: dayjs(NOW).subtract(12, 'day').format('YYYY-MM-DD HH:mm'),
      contractId: draftContract.id
    })
  )
}
// 3 条待处理 + 1 条已驳回
db.transportRequests.push(randomRequest(db.transportRequests.length + 1))
db.transportRequests.push(randomRequest(db.transportRequests.length + 1))
const rejected = randomRequest(db.transportRequests.length + 1)
rejected.status = 'rejected'
rejected.rejectReason = '需求时段运力不足，请错峰后重新提交'
db.transportRequests.push(rejected)
