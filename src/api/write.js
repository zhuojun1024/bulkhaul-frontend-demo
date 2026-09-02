/**
 * 写持久化钩子（薄客户端）：afterWrite(fnName, ...args) 按 W 映射 POST 后端，防抖 200ms 后 refreshDb 重取权威态（合并连续写）；
 * B3 乐观锁 expectedVersion（409 → blms:conflict 事件）；写后按业务域失效数据层缓存。node 下 no-op。
 */
import { api } from './client'
import { refreshDb } from './snapshot'
import { W } from './endpoints'
import { db } from '../data/base'
import { invalidateMany, invalidateAllFor } from '../composables/collectionStore'

/* ===== 写后失效（Phase 4 阶段 2）：写函数名 → 受影响的集合（数据层缓存失效，视图重取权威态）=====
 * 保守口径：写操作可能联动多集合（如 confirmUnload 联动 weighings/settlements/payables/plans），
 * 故按业务域整域失效，宁可多失效不漏失效（失效仅触发重取，成本低）。 */
const WRITE_COLL = {
  dispatches: ['dispatches', 'weighings', 'settlements', 'payables', 'plans', 'exceptions', 'inventories'],
  contracts: ['contracts', 'plans', 'transportRequests'],
  plans: ['plans', 'dispatches'],
  settlements: ['settlements', 'payments', 'prepayments', 'invoices', 'dunnings', 'exceptions', 'dispatches'],
  weighings: ['weighings', 'settlements'],
  warehouse: ['warehouses', 'inventories', 'safetyStocks'],
  exceptions: ['exceptions', 'settlements', 'dispatches'],
  safety: ['accidents', 'trainings', 'inspections'],
  insurance: ['insurance'],
  finance: ['payables', 'bankRecords', 'payments', 'settlements'],
  admin: ['commodities', 'customers', 'terminals', 'vehicles', 'drivers', 'users', 'roles', 'rateCards', 'dataScopes', 'dnd'],
  messages: ['messages']
}
function invalidateForWrite(fnName) {
  // 从 W 映射的 path 前缀推断域；兜底按 fnName 关键字
  const ep = W[fnName]
  let path = ''
  try { path = ep && ep.path ? ep.path([]) : '' } catch (e) { path = '' }
  const p = String(path)
  let domain = null
  if (p.includes('/dispatch/')) domain = 'dispatches'
  else if (p.includes('/weighing')) domain = 'weighings'
  else if (p.includes('/warehouse')) domain = 'warehouse'
  else if (p.includes('/exception')) domain = 'exceptions'
  else if (p.includes('/safety')) domain = 'safety'
  else if (p.includes('/insurance')) domain = 'insurance'
  else if (p.includes('/settlement')) domain = 'settlements'
  else if (p.includes('/finance')) domain = 'finance'
  else if (p.includes('/contract') || p.includes('/plan')) domain = p.includes('/plan') ? 'plans' : 'contracts'
  else if (p.includes('/admin/messages')) domain = 'messages'
  else if (p.includes('/admin')) domain = 'admin'
  if (!domain) {
    // 兜底：按 fnName 关键字
    if (/dispatch|load|depart|arrive|unload|receipt|scan|reassign|resume|accept/i.test(fnName)) domain = 'dispatches'
    else if (/weigh|correct/i.test(fnName)) domain = 'weighings'
    else if (/warehouse|inventory|safetyStock|inbound/i.test(fnName)) domain = 'warehouse'
    else if (/exception/i.test(fnName)) domain = 'exceptions'
    else if (/accident|training|inspection/i.test(fnName)) domain = 'safety'
    else if (/insurance|claim/i.test(fnName)) domain = 'insurance'
    else if (/settle|payment|prepay|invoice|dunning|reconcile/i.test(fnName)) domain = 'settlements'
    else if (/payable|bank/i.test(fnName)) domain = 'finance'
    else if (/contract|plan|request/i.test(fnName)) domain = 'contracts'
    else if (/message/i.test(fnName)) domain = 'messages'
    else domain = 'admin'
  }
  const colls = WRITE_COLL[domain]
  if (colls) {
    invalidateMany(colls)
    for (const c of colls) invalidateAllFor(c) // 复合 key（分页/过滤视图）一并失效
  }
}

let refreshTimer = null

/* ===== B3 乐观锁：对 6 核心集合的既有记录写，附带客户端最后看到的 version =====
 * 后端 commitAll 比对：匹配 → version+1 持久化；不匹配 → 409（数据已变更）。缺省（无 version）→ 不参与（兼容旧行为）。
 * a[0] 为记录对象（含 version）→ 直接取；a[0] 为 id 字符串 → 在本地 db 对应集合查 version。 */
const VERSIONED = new Set([
  /* dispatches（a[0]=调度单记录） */
  'confirmLoad', 'depart', 'arrive', 'confirmUnload', 'cancelDispatch', 'reassignDispatch',
  'resumeDispatch', 'acceptDispatch', 'supplementReceipt', 'scanConfirmLoad', 'scanConfirmUnload',
  /* contracts（a[0]=合同记录） */
  'changeContract', 'extendContract', 'terminateContract', 'completeContract', 'archiveContract',
  /* plans（a[0]=计划记录） */
  'cancelPlan',
  /* settlements（a[0]=结算单记录） */
  'startReconcile', 'recalcSettlement', 'confirmSettle', 'recordPayment', 'revertPayment',
  'dunning', 'customerConfirm', 'customerObjection', 'applyPrepayment',
  /* weighings（a[0]=磅单 id 字符串） */
  'correctWeighing',
  /* invoices（a[0]=发票记录） */
  'redFlushInvoiceRow'
])
const VERSIONED_ID_COLL = { correctWeighing: 'weighings' }

function expectedVersionFor(fnName, args) {
  if (!VERSIONED.has(fnName)) return undefined
  const a0 = args[0]
  if (a0 && typeof a0 === 'object' && typeof a0.version === 'number') return a0.version
  if (typeof a0 === 'string') {
    const coll = VERSIONED_ID_COLL[fnName]
    if (coll) {
      const rec = (db[coll] || []).find((r) => r.id === a0)
      if (rec && typeof rec.version === 'number') return rec.version
    }
  }
  return undefined
}

/**
 * 写操作持久化钩子：写操作发起后调用。
 * node 下 no-op；浏览器下按 W 映射 POST 后端，防抖 200ms 后从快照刷新权威态（合并连续写）。
 * B3 乐观锁：核心集合既有记录写附带 expectedVersion（不匹配 → 409，经 window 事件提示"数据已变更，请刷新"）。
 * 后端拒绝（RBAC/守卫）或网络失败时 console.warn 并刷新回权威态，不阻塞 UI。
 * @param {string} fnName 写操作名（W 映射键，沿用原 flow.js 写函数名）
 * @param {...*} args 原始位置参数（W 映射按位置索引取参）
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
  // B3 乐观锁：注入 expectedVersion（body 端点进 body；无 body 端点进查询参数）
  const ev = expectedVersionFor(fnName, args)
  if (ev !== undefined) {
    if (body !== undefined) body = { ...body, expectedVersion: ev }
    else path += (path.includes('?') ? '&' : '?') + 'expectedVersion=' + ev
  }
  invalidateForWrite(fnName) // Phase 4 阶段 2：写后失效数据层缓存（视图重取权威态）
  api(method, path, body)
    .then((r) => {
      if (r && !r.ok) {
        console.warn('[API] 后端拒绝 ' + fnName + '：', r.error, r.code)
        if (r.code === 'conflict') {
          // B3 乐观锁冲突（409）：全局事件 → main.js toast"数据已变更，请刷新"；下方 refreshDb 已拉回权威态
          window.dispatchEvent(new CustomEvent('blms:conflict', { detail: { fnName, error: r.error } }))
        }
      }
    })
    .catch((e) => console.warn('[API] 后端调用失败 ' + fnName + '：', e && e.message))
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => refreshDb(), 200)
}
