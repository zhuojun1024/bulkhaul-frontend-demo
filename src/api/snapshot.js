/**
 * 快照同步（薄客户端）：/api/snapshot 全量快照 → 本地响应式 db（后端为唯一权威态）。
 * 数组集合 splice 保响应式身份；对象集合清旧键 + 合并（处理删除）；logs 归一化时间。
 */
import { api, USE_API, token } from './client'
import { db } from '../data/base'

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
  // Phase 4 阶段 3：快照刷新成功 → 通知生产模式页面重取权威集合（薄客户端读同步）
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('blms:refreshed'))
  return true
}

/** 启动时 hydrate：拉取快照覆盖 db（需已登录 token；未登录时跳过，登录页不依赖 db） */
export async function hydrate() {
  if (!USE_API || !token()) return false
  return refreshDb()
}
