/**
 * 真实 API 联调层（阶段 6 收尾；目录拆分：src/api 为接口层，src/mock 为内存业务引擎/种子数据）
 *
 * 架构：内存引擎（flow.js）保持同步 + 响应式（npm test 554 断言不变），
 * 浏览器中每个写操作在内存引擎同步执行后，后台 POST 到后端持久化，
 * 并从 /api/snapshot 拉取权威态刷新本地 db（后端为权威）。
 * node 环境（npm test）USE_API=false，纯内存，不发 HTTP。
 *
 * 读/计算函数（settlementCandidates/creditCheck/outstandingOf/visibleDispatches/…）保持同步本地，
 * 读 db（db 由后端 hydrate）。写函数经 afterWrite 持久化。
 *
 * afterWrite(fnName, ...args)：args 为调用方传入的**原始位置参数**（与 flow.js 函数签名一致），
 * W 映射按位置索引 args[0]/args[1]… 构造 path/body。
 */
import { db } from '../mock/base'

/** 浏览器环境（有 localStorage）启用真实 API；node 测试态关闭 */
export const USE_API = typeof window !== 'undefined' && !!window.localStorage

const BASE = '/api'

function token() {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem('blms_token')) || ''
  } catch (e) {
    return ''
  }
}

/**
 * HTTP client：fetch 相对 /api（经 dev server / verify-ui 静态服务反向代理到 8081，无 CORS），
 * 自动带 Authorization: Bearer，解析 ApiResult{ok,data,error,code}。
 * 401 → 清 token（登录态失效）。
 */
export async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const t = token()
  if (t) headers['Authorization'] = 'Bearer ' + t
  const opts = { method, headers }
  if (body !== undefined) opts.body = JSON.stringify(body)
  let res
  try {
    res = await fetch(BASE + path, opts)
  } catch (e) {
    return { ok: false, error: '无法连接后端服务（' + (e && e.message ? e.message : e) + '），请确认 bulkhaul-server 已在 8081 运行', code: 'network' }
  }
  let json
  try {
    json = await res.json()
  } catch (e) {
    return { ok: false, error: '后端返回非 JSON（HTTP ' + res.status + '）', code: 'bad-response' }
  }
  if (res.status === 401) {
    try {
      localStorage.removeItem('blms_token')
    } catch (e) { /* localStorage 不可用时忽略 */ }
    return { ok: false, error: (json && json.error) || '未登录或登录已过期', code: (json && json.code) || 'unauthenticated' }
  }
  return json
}

/* ===== 集合清单（与后端 DataStore 一致：29 数组型 + 5 对象型） ===== */
const LIST_COLLS = [
  'commodities', 'customers', 'terminals', 'vehicles', 'drivers', 'contracts', 'transportRequests',
  'plans', 'dispatches', 'weighings', 'warehouses', 'inventories', 'settlements', 'payments',
  'prepayments', 'payables', 'dunnings', 'bankRecords', 'invoices', 'messages', 'exceptions',
  'accidents', 'trainings', 'inspections', 'rateCards', 'insurance', 'safetyStocks', 'users', 'roles'
]
const OBJ_COLLS = ['rolePerms', 'fenceConfig', 'escalateConfig', 'dnd', 'dataScopes']

/** 后端审计日志时间归一：ISO（2026-08-29T21:39:17）→ 前端口径（2026-08-29 21:39:17），保证日志页 slice(0,10)/展示一致 */
function normLogTime(t) {
  return String(t || '').replace('T', ' ').slice(0, 19)
}

/**
 * 从后端拉取全量快照并刷新本地响应式 db（后端为权威态）。
 * 数组集合用 splice 保响应式身份；对象集合清除旧键 + 合并（处理删除）；logs 归一化时间。
 */
export async function refreshDb() {
  const r = await api('GET', '/snapshot')
  if (!r.ok || !r.data) return false
  const d = r.data
  for (const c of LIST_COLLS) {
    const list = Array.isArray(d[c]) ? d[c] : []
    const arr = db[c]
    if (Array.isArray(arr)) arr.splice(0, arr.length, ...list)
    else db[c] = list
  }
  for (const c of OBJ_COLLS) {
    const cur = db[c]
    const next = d[c] || {}
    if (cur && typeof cur === 'object') {
      for (const k of Object.keys(cur)) if (!(k in next)) delete cur[k]
      Object.assign(cur, next)
    } else {
      db[c] = { ...next }
    }
  }
  const logs = (Array.isArray(d.logs) ? d.logs : []).map((l) => ({ ...l, time: normLogTime(l.time) }))
  if (Array.isArray(db.logs)) db.logs.splice(0, db.logs.length, ...logs)
  return true
}

/** 启动时 hydrate：拉取快照覆盖 db（需已登录 token；未登录时跳过，登录页不依赖 db） */
export async function hydrate() {
  if (!USE_API || !token()) return false
  return refreshDb()
}

/* ===== 写端点映射：flow.js 写函数名 → { method, path(args), body(args) } =====
 * args 为原始位置参数数组（与 flow.js 函数签名一致）。path/body 按 args[i] 取参。 */
const W = {
  /* 调度（/api/dispatch） */
  confirmLoad: { path: (a) => `/dispatch/${a[0].id}/confirmLoad` },
  depart: { path: (a) => `/dispatch/${a[0].id}/depart` },
  arrive: { path: (a) => `/dispatch/${a[0].id}/arrive` },
  confirmUnload: { path: (a) => `/dispatch/${a[0].id}/confirmUnload` },
  cancelDispatch: { path: (a) => `/dispatch/${a[0].id}/cancel`, body: (a) => ({ reason: a[1] || '' }) },
  reassignDispatch: { path: (a) => `/dispatch/${a[0].id}/reassign`, body: (a) => ({ vehicleId: a[1], driverId: a[2] }) },
  reportException: { path: (a) => `/dispatch/${a[0].id}/reportException`, body: (a) => ({ description: a[1], type: a[2] || 'other', level: a[3] || 'medium' }) },
  driverReportException: { path: (a) => `/dispatch/${a[0].id}/reportException`, body: (a) => ({ description: a[1], type: a[2] || 'other', level: a[3] || 'medium' }) },
  resumeDispatch: { path: (a) => `/dispatch/${a[0].id}/resume` },
  createDispatches: { path: () => '/dispatch/create', body: (a) => ({ planId: a[0].id, count: a[1], vehicleIds: a[2] || [] }) },
  acceptDispatch: { path: (a) => `/dispatch/${a[0].id}/accept` },
  driverDepart: { path: (a) => `/dispatch/${a[0].id}/driver/depart` },
  driverArrive: { path: (a) => `/dispatch/${a[0].id}/driver/arrive` },
  signReceipt: { path: (a) => `/dispatch/${a[0].id}/driver/signReceipt`, body: (a) => ({ signer: a[1] || '' }) },
  supplementReceipt: { path: (a) => `/dispatch/${a[0].id}/supplementReceipt`, body: (a) => ({ signer: a[1] || '', reason: a[2] || '' }) },
  scanConfirmLoad: { path: (a) => `/dispatch/${a[0].id}/scan/load`, body: (a) => ({ code: a[1] || '' }) },
  scanConfirmUnload: { path: (a) => `/dispatch/${a[0].id}/scan/unload`, body: (a) => ({ code: a[1] || '' }) },

  /* 磅单（/api/weighing） */
  manualWeighing: { path: () => '/weighing/manual', body: (a) => ({ dispatchId: a[0], type: a[1], net: a[2] }) },
  correctWeighing: { path: (a) => `/weighing/${a[0]}/correct`, body: (a) => ({ newNet: a[1], reason: a[2] || '' }) },

  /* 仓储（/api/warehouse） */
  manualInbound: { path: () => '/warehouse/inbound', body: (a) => ({ warehouseId: a[0], commodityId: a[1], quantity: a[2], batch: a[3] || '', remark: a[4] || '' }) },
  setSafetyStock: { path: () => '/warehouse/safetyStock', body: (a) => ({ warehouseId: a[0], commodityId: a[1], minQty: a[2] }) },
  setInventoryStatus: { path: (a) => `/warehouse/inventory/${a[0].id}/status`, body: (a) => ({ status: a[1] }) },

  /* 异常（/api/exception） */
  acceptException: { path: (a) => `/exception/${a[0].id}/accept`, body: (a) => ({ handler: a[1] || '' }) },
  finishException: { path: (a) => `/exception/${a[0].id}/finish`, body: (a) => ({ result: a[1] || '', cost: a[2] || 0 }) },
  closeException: { path: (a) => `/exception/${a[0].id}/close` },

  /* 安全（/api/safety） */
  registerAccident: { path: () => '/safety/accident', body: (a) => a[0] },
  closeAccident: { path: (a) => `/safety/accident/${a[0].id}/close` },
  addTraining: { path: () => '/safety/training', body: (a) => a[0] },
  completeTraining: { path: (a) => `/safety/training/${a[0].id}/complete`, body: (a) => ({ driverIds: a[1] || [] }) },
  addInspection: { path: () => '/safety/inspection', body: (a) => a[0] },

  /* 保险（/api/insurance） */
  fileInsuranceClaim: { path: () => '/insurance/claim', body: (a) => ({ ...(a[1] || {}), accidentId: a[0] || '' }) },
  assessInsuranceClaim: { path: (a) => `/insurance/claim/${a[0].id}/assess`, body: (a) => a[1] || {} },
  settleInsuranceClaim: { path: (a) => `/insurance/claim/${a[0].id}/settle`, body: (a) => a[1] || {} },
  rejectInsuranceClaim: { path: (a) => `/insurance/claim/${a[0].id}/reject`, body: (a) => ({ reason: a[1] || '' }) },

  /* 结算（/api/settlement） */
  generateSettlements: { path: () => '/settlement/generate', body: (a) => ({ keys: a[0] || [] }) },
  startReconcile: { path: (a) => `/settlement/${a[0].id}/startReconcile` },
  recalcSettlement: { path: (a) => `/settlement/${a[0].id}/recalc` },
  confirmSettle: { path: (a) => `/settlement/${a[0].id}/confirmSettle` },
  recordPayment: { path: (a) => `/settlement/${a[0].id}/recordPayment`, body: (a) => ({ amount: a[1], method: a[2] || '银行转账' }) },
  revertPayment: { path: (a) => `/settlement/${a[0].id}/revertPayment/${a[1]}`, body: (a) => ({ reason: a[2] || '' }) },
  dunning: { path: (a) => `/settlement/${a[0].id}/dunning`, body: (a) => ({ level: a[1] || 'reminder' }) },
  customerConfirm: { path: (a) => `/settlement/${a[0].id}/customerConfirm` },
  customerObjection: { path: (a) => `/settlement/${a[0].id}/customerObjection`, body: (a) => ({ reason: a[1] || '' }) },
  applyPrepayment: { path: (a) => `/settlement/${a[0].id}/applyPrepayment`, body: (a) => ({ amount: a[1] }) },
  collectPrepayment: { path: () => '/settlement/prepayment/collect', body: (a) => ({ customerId: a[0], amount: a[1], method: a[2] || '银行转账', remark: a[3] || '' }) },
  issueInvoice: { path: (a) => `/settlement/${a[0].id}/issueInvoice` },
  issueInvoiceRow: { path: (a) => `/settlement/${a[0].settlementId}/issueInvoice` },
  redFlushInvoiceRow: { path: (a) => `/settlement/invoice/${a[0].id}/redFlush`, body: (a) => ({ reason: a[1] || '' }) },

  /* 财务核销（/api/finance） */
  generatePayables: { path: () => '/finance/payables/generate' },
  payPayable: { path: (a) => `/finance/payables/${a[0].id}/pay`, body: (a) => ({ method: a[1] || '银行转账' }) },
  addBankStatement: { path: () => '/finance/bank/statement', body: (a) => a[0] },
  matchBankRecord: { path: (a) => `/finance/bank/${a[0].id}/match`, body: (a) => ({ settlementId: a[1] }) },
  autoMatchBank: { path: () => '/finance/bank/autoMatch' },

  /* 合同/计划（/api） */
  createContract: { path: () => '/contract', body: (a) => ({ ...(a[0] || {}), status: a[1] || 'draft' }) },
  createPlan: { path: () => '/plan', body: (a) => a[0] },
  cancelPlan: { path: (a) => `/plan/${a[0].id}/cancel` },
  submitContractApproval: { path: (a) => `/contract/${a[0].id}/submitApproval` },
  approveContract: { path: (a) => `/contract/${a[0].id}/approve`, body: (a) => ({ comment: a[1] || '' }) },
  rejectContract: { path: (a) => `/contract/${a[0].id}/reject`, body: (a) => ({ reason: a[1] || '' }) },
  changeContract: { path: (a) => `/contract/${a[0].id}/change`, body: (a) => ({ fields: a[1] || {}, reason: a[2] || '' }) },
  approveContractChange: { path: (a) => `/contract/${a[0].id}/approveChange`, body: (a) => ({ comment: a[1] || '' }) },
  rejectContractChange: { path: (a) => `/contract/${a[0].id}/rejectChange`, body: (a) => ({ reason: a[1] || '' }) },
  extendContract: { path: (a) => `/contract/${a[0].id}/extend`, body: (a) => ({ newDate: a[1], reason: a[2] || '' }) },
  terminateContract: { path: (a) => `/contract/${a[0].id}/terminate`, body: (a) => ({ reason: a[1] || '', settleNow: a[2] !== false }) },
  completeContract: { path: (a) => `/contract/${a[0].id}/complete` },
  archiveContract: { path: (a) => `/contract/${a[0].id}/archive` },
  submitTransportRequest: { path: () => '/contract/request', body: (a) => ({ ...(a[1] || {}), customerId: a[0] }) },
  convertRequestToContract: { path: (a) => `/contract/request/${a[0].id}/convert`, body: (a) => a[1] || {} },
  rejectTransportRequest: { path: (a) => `/contract/request/${a[0].id}/reject`, body: (a) => ({ reason: a[1] || '' }) },

  /* 管理后台（/api/admin） */
  saveCommodity: { path: () => '/admin/commodity', body: (a) => a[0] },
  toggleCommodityStatus: { path: (a) => `/admin/commodity/${a[0].id}/toggle` },
  saveTerminal: { path: () => '/admin/terminal', body: (a) => a[0] },
  saveWarehouse: { path: () => '/admin/warehouse', body: (a) => a[0] },
  saveDriver: { path: () => '/admin/driver', body: (a) => a[0] },
  toggleDriverStatus: { path: (a) => `/admin/driver/${a[0].id}/toggle` },
  toggleCustomerStatus: { path: (a) => `/admin/customer/${a[0].id}/toggle` },
  importCommodities: { path: () => '/admin/commodity/import', body: (a) => a[0] || [] },
  importCustomers: { path: () => '/admin/customer/import', body: (a) => a[0] || [] },
  importDrivers: { path: () => '/admin/driver/import', body: (a) => a[0] || [] },
  importVehicles: { path: () => '/admin/vehicle/import', body: (a) => a[0] || [] },
  sendVehicleRepair: { path: (a) => `/admin/vehicle/${a[0].id}/repair`, body: (a) => ({ reason: a[1] || '' }) },
  resumeVehicle: { path: (a) => `/admin/vehicle/${a[0].id}/resume` },
  saveUser: { path: () => '/admin/user', body: (a) => a[0] },
  removeUser: { method: 'DELETE', path: (a) => `/admin/user/${a[0].id}` },
  toggleUserStatus: { path: (a) => `/admin/user/${a[0].id}/toggle`, body: (a) => ({ active: !!a[1] }) },
  resetPassword: { path: (a) => `/admin/user/${a[0]}/resetPassword`, body: (a) => ({ password: a[1] }) },
  saveRole: { path: () => '/admin/role', body: (a) => a[0] },
  removeRole: { method: 'DELETE', path: (a) => `/admin/role/${a[0].id}` },
  updateRolePerms: { method: 'PUT', path: (a) => `/admin/role/${a[0]}/perms`, body: (a) => a[1] || {} },
  setDataScope: { method: 'PUT', path: (a) => `/admin/user/${a[0]}/dataScope`, body: (a) => ({ regions: a[1] || [] }) },
  setDnd: { method: 'PUT', path: () => '/admin/dnd', body: (a) => a[0] || {} },
  createRateCard: { path: () => '/admin/rateCard', body: (a) => a[0] },
  updateRateCard: { method: 'PUT', path: (a) => `/admin/rateCard/${a[0]}`, body: (a) => a[1] || {} },
  toggleRateCard: { path: (a) => `/admin/rateCard/${a[0]}/toggle` },
  recalcAll: { path: () => '/admin/recalc' },

  /* 消息（/api/admin） */
  markMessageRead: { path: (a) => `/admin/messages/${a[0].id}/read` },
  markAllMessagesRead: { path: () => '/admin/messages/readAll' }
}

let refreshTimer = null

/**
 * 写操作持久化钩子：内存引擎同步执行成功后调用。
 * node 下 no-op；浏览器下按 W 映射 POST 后端，防抖 200ms 后从快照刷新权威态（合并连续写）。
 * 后端拒绝（RBAC/守卫）或网络失败时 console.warn 并刷新回权威态，不阻塞 UI。
 * @param {string} fnName flow.js 写函数名
 * @param {...*} args 原始位置参数（与 flow.js 函数签名一致）
 */
export function afterWrite(fnName, ...args) {
  if (!USE_API) return
  const ep = W[fnName]
  if (!ep) return
  const method = ep.method || 'POST'
  let path
  let body
  try {
    path = ep.path(args)
    body = ep.body ? ep.body(args) : undefined
  } catch (e) {
    console.warn('[API] 构造请求失败 ' + fnName + '：', e && e.message)
    return
  }
  api(method, path, body)
    .then((r) => {
      if (r && !r.ok) console.warn('[API] 后端拒绝 ' + fnName + '：', r.error, r.code)
    })
    .catch((e) => console.warn('[API] 后端调用失败 ' + fnName + '：', e && e.message))
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => refreshDb(), 200)
}
