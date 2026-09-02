import { reactive } from 'vue'
import dayjs from 'dayjs'
import { mulberry32 } from '@/utils'

/** 全局种子随机数（仅 dashboard 历史趋势用，保证每次刷新一致） */
export const rng = mulberry32(20260815)

/** 基于全局 rng 的随机工具（dashboard 历史趋势用） */
export function randInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min
}

/** 当前时间基准（运行时取当天，保证数据“新鲜”） */
export const NOW = dayjs()

/** 本地响应式镜像：后端 /api/snapshot 填充（hydrate/refreshDb），reactive 保证跨页面联动；
 *  仅作读缓存供派生读（derived.js）与交叉引用列（find.*）使用，后端为唯一权威态 */
export const db = reactive({
  commodities: [],
  customers: [],
  terminals: [],
  vehicles: [],
  drivers: [],
  contracts: [],
  transportRequests: [], // 客户运输需求（门户发起 → 合同草稿）
  plans: [],
  dispatches: [],
  weighings: [],
  warehouses: [],
  inventories: [],
  settlements: [],
  payments: [],
  prepayments: [], // 环节5：预付款台账（客户预付，收取/抵扣；available = amount - used）
  payables: [], // P1 成本侧闭环：趟次应付台账（司机趟次费 + 外协车运费；pending 待付 / paid 已付）
  dunnings: [], // P1 逾期催收：催款台账（reminder 提醒 / formal 正式催收 / legal 法务函，按账单轮次递增）
  bankRecords: [], // 银行流水（对账核销：unmatched 待核销 / matched 已核销）
  invoices: [],
  messages: [], // 消息中心（flow 事件驱动 + 种子）
  exceptions: [],
  accidents: [],
  trainings: [],
  inspections: [],
  users: [],
  roles: [],
  // 角色权限表（数据化）：角色名 → { menus: null|路径[], actions: null|操作码[] }，null=全部，[]=无
  rolePerms: {},
  // 电子围栏参数（在途监控页可配置）：deviateLimit 轨迹偏离阈值（地图单位）/ delayMinutes 超 ETA 阈值（分钟）
  fenceConfig: { enabled: true, deviateLimit: 15, delayMinutes: 30 },
  // 环节6：消息免打扰设置（按登录账号）：username → { enabled, quietStart, quietEnd, mutedTypes }
  dnd: {},
  // 环节7：安全库存台账（仓库×商品 可发库存下限）：{ id, warehouseId, commodityId, minQty }
  safetyStocks: [],
  // 环节8：数据权限（行级，按登录账号）：username → { regions: [...] }，空/缺省 = 全量数据
  dataScopes: {},
  // P2 运价管理：线路运价表（商品×装/卸场站×方式 → 单价，合同可查表取价/调价）
  rateCards: [],
  // P2 保险环节：事故保险理赔台账（报险→责任认定→理赔结案，理赔冲减事故损失）
  insurance: [],
  // P2 异常/审批升级：超时阈值（小时）。异常单待受理超 exceptionHours 逐级升级；合同审批待批超 contractHours 催办
  escalateConfig: { exceptionHours: 2, contractHours: 24 },
  logs: []
})

/** 公路口径运输方式（派车+磅单）；铁路/水运/管道按运输单元执行，不占车辆司机、无公路磅单
 *  置于 base（无依赖）：种子模块（dispatch 等）与 flow 服务层共用同一口径，避免循环导入 */
export const ROAD_MODES = ['公路', '多式联运']
export const isRoadMode = (mode) => ROAD_MODES.includes(mode || '公路')

/** 车辆皮重（10-16t，按车辆 id 确定性派生）；种子磅单与运行时补录共用同一口径 */
export function tareOf(vehicle) {
  if (!vehicle) return 13
  const n = vehicle.id.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)
  return +(10 + (n % 61) / 10).toFixed(2)
}


/** 运输线路：装货场站 -> 卸货场站 */
export const ROUTES = [
  { from: 'T005', to: 'T001', distance: 280, commodityIds: ['CM001', 'CM002'] },
  { from: 'T006', to: 'T002', distance: 420, commodityIds: ['CM001'] },
  { from: 'T007', to: 'T002', distance: 380, commodityIds: ['CM001', 'CM003'] },
  { from: 'T008', to: 'T012', distance: 350, commodityIds: ['CM001', 'CM002'] },
  { from: 'T005', to: 'T011', distance: 320, commodityIds: ['CM001'] },
  { from: 'T003', to: 'T009', distance: 1200, commodityIds: ['CM004', 'CM005'] },
  { from: 'T003', to: 'T010', distance: 900, commodityIds: ['CM004'] },
  { from: 'T012', to: 'T009', distance: 300, commodityIds: ['CM004', 'CM005'] },
  { from: 'T006', to: 'T011', distance: 520, commodityIds: ['CM001', 'CM003'] },
  { from: 'T008', to: 'T009', distance: 450, commodityIds: ['CM002'] }
]

/** 场站在监控地图上的坐标（1000 x 620 视口，示意性布局） */
export const MAP_NODES = {
  T001: { x: 520, y: 140, label: '秦皇岛港' },
  T002: { x: 420, y: 165, label: '黄骅港' },
  T003: { x: 470, y: 215, label: '天津港' },
  T004: { x: 495, y: 155, label: '曹妃甸港' },
  T005: { x: 330, y: 195, label: '大同装车站' },
  T006: { x: 235, y: 250, label: '鄂尔多斯站' },
  T007: { x: 195, y: 320, label: '神府装车站' },
  T008: { x: 560, y: 330, label: '兖州装车站' },
  T009: { x: 690, y: 430, label: '宝钢原料场' },
  T010: { x: 630, y: 75, label: '鞍钢原料场' },
  T011: { x: 385, y: 245, label: '河钢原料场' },
  T012: { x: 620, y: 395, label: '日照港' }
}

