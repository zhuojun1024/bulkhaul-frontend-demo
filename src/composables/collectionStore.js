/**
 * 集合数据层核心（Phase 4 阶段 2：useCollection 的响应式缓存 + 写后失效 + 乐观更新）。
 * 纯逻辑、环境无关（不依赖 USE_API / db / HTTP），可独立单测。
 *
 * 设计：
 *  - 模块级 reactive 缓存：collection name -> { rows, total, page, size, loading, error, stale, loaded }
 *  - 写后失效：invalidate(name) 标记 stale + 未加载，视图下次访问触发重取
 *  - 乐观更新：optimisticUpdate(name, updater) 立即改本地 rows 并标记 stale（服务端确认后 refresh 覆盖为权威态）
 *  - 视图经 useCollection(name) 拿到响应式 data/loading/error/total + refresh/update/invalidate
 */
import { reactive } from 'vue'

const state = reactive({})

/** 取（并按需初始化）某查询的缓存槽。key 默认 = name；分页/过滤视图传复合 key 避免与全量视图串缓存 */
export function getCollection(name, key) {
  const k = key || name
  if (!state[k]) {
    state[k] = {
      rows: [],
      total: 0,
      page: 1,
      size: 20,
      loading: false,
      error: null,
      stale: false,
      loaded: false
    }
  }
  return state[k]
}

/** 写入服务端权威态（refresh 成功后调用）；meta 可带 total/page/size（分页端点） */
export function setRows(name, rows, meta = {}, key) {
  const c = getCollection(name, key)
  c.rows = Array.isArray(rows) ? rows : []
  c.loaded = true
  c.stale = false
  c.error = null
  if (meta.total !== undefined) c.total = meta.total
  if (meta.page !== undefined) c.page = meta.page
  if (meta.size !== undefined) c.size = meta.size
}

/** 写后失效：标记该集合过期 + 未加载（视图访问时重取） */
export function invalidate(name, key) {
  const c = getCollection(name, key)
  c.stale = true
  c.loaded = false
}

/** 批量失效 */
export function invalidateMany(names) {
  for (const n of names) invalidate(n)
}

/** 失效某集合的全部缓存槽（含复合 key）：写后失效用，name 前缀匹配 */
export function invalidateAllFor(name) {
  for (const k of Object.keys(state)) {
    if (k === name || k.startsWith(name + ':')) invalidate(name, k)
  }
}

/** 乐观更新：updater(rows) 返回新数组（或就地改后返回原数组）；立即生效并标记 stale（待服务端确认） */
export function optimisticUpdate(name, updater, key) {
  const c = getCollection(name, key)
  let next
  try {
    next = updater(c.rows)
  } catch (e) {
    c.error = e && e.message ? e.message : String(e)
    return
  }
  c.rows = Array.isArray(next) ? next : c.rows
  c.stale = true
}

/** 设置加载/错误态 */
export function setLoading(name, loading, key) {
  getCollection(name, key).loading = loading
}
export function setError(name, error, key) {
  const c = getCollection(name, key)
  c.error = error
  c.loading = false
}

/** 测试用：清空全部缓存 */
export function resetStore() {
  for (const k of Object.keys(state)) delete state[k]
}
