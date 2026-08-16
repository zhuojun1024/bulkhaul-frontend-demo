import { reactive } from 'vue'
import dayjs from 'dayjs'
import { mulberry32, round } from '@/utils'

/** 全局种子随机数，保证每次刷新数据一致 */
export const rng = mulberry32(20260815)
export { round }

/** 基于全局 rng 的随机工具，各 mock 模块直接调用（randInt(min,max) / pick(arr)） */
export function randInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min
}
export function pick(arr) {
  return arr[Math.floor(rng() * arr.length)]
}
export function pickN(arr, n) {
  const copy = [...arr]
  const res = []
  while (res.length < n && copy.length) {
    res.push(copy.splice(Math.floor(rng() * copy.length), 1)[0])
  }
  return res
}

/** 当前时间基准（运行时取当天，保证数据“新鲜”） */
export const NOW = dayjs()

/** 中央数据库：所有 mock 数据挂载于此，reactive 保证跨页面联动 */
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
  logs: []
})

/** 车辆皮重（10-16t，按车辆 id 确定性派生）；种子磅单与运行时补录共用同一口径 */
export function tareOf(vehicle) {
  if (!vehicle) return 13
  const n = vehicle.id.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)
  return +(10 + (n % 61) / 10).toFixed(2)
}

/* ========== 基础词库 ========== */
export const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗郑梁谢宋唐许韩冯邓曹彭'.split('')
export const GIVEN_NAMES = [
  '伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋',
  '勇', '杰', '涛', '明', '超', '霞', '平', '刚', '华', '建国',
  '建军', '志强', '海燕', '文斌', '秀兰', '桂英', '德福', '春生',
  '国庆', '卫东', '学文', '永强', '宝山', '铁柱', '大伟', '金龙',
  '凤霞', '玉梅', '桂芳', '春梅', '志远', '建华', '立新', '海燕',
  '少康', '国栋', '子涵', '雨泽', '浩然', '天佑'
]

export function randomName() {
  return pick(SURNAMES) + pick(GIVEN_NAMES)
}

export function randomPhone() {
  const prefix = pick(['135', '136', '137', '138', '139', '150', '151', '152', '158', '159', '186', '187', '188', '199'])
  return prefix + String(randInt(10000000, 99999999))
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

/** 车牌前缀池 */
export const PLATE_PREFIX = ['冀B', '冀C', '冀E', '晋A', '晋B', '晋C', '蒙K', '辽B', '鲁B', '陕K']

export function randomPlate() {
  const prefix = pick(PLATE_PREFIX)
  const letter = String.fromCharCode(65 + randInt(0, 25))
  const num = String(randInt(10000, 99999))
  return `${prefix}·${letter}${num}`
}

/** 生成 ID 序列号 */
let seq = 0
export function nextSeq(prefix) {
  seq += 1
  return `${prefix}-${String(seq).padStart(4, '0')}`
}

/** 正规 ID 生成（P2 架构下沉：后端正规 ID 生成的等价实现）
 *  扫描列表已有 ID 取最大序列 + 1：删除记录后不复用旧号、并发创建不冲突；
 *  替代旧的"数组长度 + 1"派生（删除后长度回退会导致 ID 复用） */
export function genId(prefix, width, list = []) {
  let max = 0
  const re = new RegExp(`^${prefix}(\\d+)$`)
  for (const x of list) {
    const m = re.exec(String((x && x.id) || ''))
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return prefix + String(max + 1).padStart(width, '0')
}
