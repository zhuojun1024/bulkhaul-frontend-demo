/**
 * useCollection(name, opts)：前端数据层 composable（Phase 4 阶段 2/3）。
 * 页面 import 数据层、不直接 fetch；读走缓存 + 失效重取，写后失效由 writeInvalidate 驱动。
 *
 * opts：{ page, size, status, mode, keyword, dateFrom, dateTo, key }
 *  - 带 page → 服务端分页（GET /api/coll/{name}?page&size&filters → {list,total}）
 *  - 不带 page → 全量（可带过滤）
 *  - key：复合缓存键（默认 name；同集合不同查询传不同 key 避免串缓存）
 *
 * 双环境：
 *  - 浏览器（USE_API=true）：GET /api/coll/{name} → 写缓存（后端权威）
 *  - node（USE_API=false）：镜像本地响应式 db，过滤在本地应用
 *
 * 返回：{ data, loading, error, total, refresh, update, invalidate }
 */
import { computed } from 'vue'
import { api, USE_API } from '@/api'
import { db } from '@/data/base'
import { getCollection, setRows, invalidate as invalidateStore, optimisticUpdate, setLoading, setError } from './collectionStore'

/** 过滤条件（本地镜像 + 查询串共用） */
function filtersOf(opts) {
  const f = {}
  for (const k of ['status', 'mode', 'keyword', 'dateFrom', 'dateTo']) {
    if (opts[k] !== undefined && opts[k] !== null && opts[k] !== '') f[k] = opts[k]
  }
  return f
}

/** 本地过滤（node 态镜像；口径与后端 CollReadController.applyFilters 一致） */
function applyLocalFilters(rows, f) {
  let out = rows
  if (f.status) out = out.filter((r) => r.status === f.status)
  if (f.mode) out = out.filter((r) => r.mode === f.mode)
  if (f.keyword) {
    const kw = String(f.keyword).toLowerCase()
    out = out.filter((r) => String(r.id || '').toLowerCase().includes(kw) || String(r.name || '').toLowerCase().includes(kw))
  }
  if (f.dateFrom || f.dateTo) {
    out = out.filter((r) => {
      const s = String(r.signDate || '')
      if (f.dateFrom && s < f.dateFrom) return false
      if (f.dateTo && s > f.dateTo) return false
      return true
    })
  }
  return out
}

export function useCollection(name, opts = {}) {
  // opts 可为对象或函数（函数在每次 refresh 时求值，支持响应式参数：page/filter 变化后重取）
  const o = typeof opts === 'function' ? opts() : opts
  const key = o.key || name
  const store = getCollection(name, key)
  const data = computed(() => store.rows)
  const loading = computed(() => store.loading)
  const error = computed(() => store.error)
  const total = computed(() => store.total)

  async function refresh() {
    const cur = typeof opts === 'function' ? opts() : opts
    const f = filtersOf(cur)
    if (!USE_API) {
      // node 态：镜像本地响应式 db + 本地过滤
      const rows = applyLocalFilters((db[name] || []).slice(), f)
      if (cur.page) {
        const size = cur.size || 20
        const start = (cur.page - 1) * size
        setRows(name, rows.slice(start, start + size), { total: rows.length, page: cur.page, size }, key)
      } else {
        setRows(name, rows, { total: rows.length }, key)
      }
      return data.value
    }
    setLoading(name, true, key)
    try {
      const params = new URLSearchParams()
      if (cur.page) { params.set('page', cur.page); params.set('size', cur.size || 20) }
      for (const [k, v] of Object.entries(f)) params.set(k, v)
      const qs = params.toString() ? '?' + params.toString() : ''
      const r = await api('GET', `/coll/${name}${qs}`)
      if (!r.ok) throw new Error(r.error || '加载失败')
      if (Array.isArray(r.data)) {
        setRows(name, r.data, { total: r.data.length }, key)
      } else {
        setRows(name, r.data.list || [], { total: r.data.total, page: r.data.page, size: r.data.size }, key)
      }
    } catch (e) {
      setError(name, e && e.message ? e.message : String(e), key)
    }
    return data.value
  }

  function update(updater) {
    optimisticUpdate(name, updater, key)
    return data.value
  }

  function invalidate() {
    invalidateStore(name, key)
  }

  return { data, loading, error, total, refresh, update, invalidate }
}
