import { db, rng, randInt, pick, NOW } from './base'
import dayjs from 'dayjs'

const warehouses = [
  { id: 'WH001', name: '秦皇岛港 1 号煤仓', type: '煤仓', address: '河北省秦皇岛市海港区', capacity: 80000, manager: '王站长' },
  { id: 'WH002', name: '秦皇岛港 2 号煤仓', type: '煤仓', address: '河北省秦皇岛市海港区', capacity: 80000, manager: '张站长' },
  { id: 'WH003', name: '黄骅港矿石堆场', type: '矿石仓', address: '河北省沧州市黄骅市', capacity: 120000, manager: '刘站长' },
  { id: 'WH004', name: '天津港粮食筒仓', type: '粮食仓', address: '天津市滨海新区', capacity: 60000, manager: '陈站长' },
  { id: 'WH005', name: '日照港散货堆场', type: '矿石仓', address: '山东省日照市东港区', capacity: 100000, manager: '杨站长' },
  { id: 'WH006', name: '兖州化工中转库', type: '化工库', address: '山东省济宁市兖州区', capacity: 20000, manager: '赵站长' },
  { id: 'WH007', name: '鄂尔多斯煤炭储备库', type: '煤仓', address: '内蒙古鄂尔多斯市东胜区', capacity: 150000, manager: '周站长' },
  { id: 'WH008', name: '神木煤炭储备库', type: '煤仓', address: '陕西省榆林市神木市', capacity: 130000, manager: '吴站长' }
]

db.warehouses = warehouses.map((w, i) => ({
  ...w,
  used: Math.round(w.capacity * (0.3 + rng() * 0.6)),
  phone: '138' + String(randInt(10000000, 99999999)),
  status: i === 5 ? 'maintenance' : 'operating',
  remark: ''
}))

/** 库存：仓库 × 商品 批次 */
const whCommodityMap = {
  WH001: ['CM001', 'CM002'],
  WH002: ['CM001'],
  WH003: ['CM004', 'CM005'],
  WH004: ['CM006', 'CM007', 'CM008'],
  WH005: ['CM004', 'CM012'],
  WH006: ['CM009', 'CM010'],
  WH007: ['CM001', 'CM003'],
  WH008: ['CM001', 'CM002']
}

let invSeq = 0
db.inventories = []
for (const wh of warehouses) {
  const commodityIds = whCommodityMap[wh.id]
  const batches = randInt(3, 5)
  for (let b = 0; b < batches; b++) {
    invSeq += 1
    const commodityId = pick(commodityIds)
    db.inventories.push({
      id: `INV-${String(invSeq).padStart(4, '0')}`,
      warehouseId: wh.id,
      commodityId,
      batch: `B${dayjs(NOW).subtract(randInt(1, 90), 'day').format('YYMMDD')}-${b + 1}`,
      quantity: randInt(500, 8000),
      inDate: dayjs(NOW).subtract(randInt(1, 90), 'day').format('YYYY-MM-DD'),
      status: rng() < 0.75 ? 'normal' : rng() < 0.5 ? 'locked' : 'near-expiry'
    })
  }
}
