/**
 * Phase 4 阶段 2：前端数据层单测（collectionStore + useCollection）。
 * 运行：node --import ./scripts/register.mjs scripts/verify-collection.mjs
 * 纯逻辑，不依赖 HTTP（node 下 USE_API=false，useCollection 镜像本地 db）。
 */
import { db } from '../src/mock/base.js'
import {
  getCollection, setRows, invalidate, optimisticUpdate, setLoading, setError, resetStore
} from '../src/composables/collectionStore.js'
import { useCollection } from '../src/composables/useCollection.js'

let pass = 0, fail = 0
const failures = []
function check(name, cond) {
  if (cond) pass++
  else { fail++; failures.push(name) }
}

// ===== collectionStore 纯逻辑 =====
resetStore()
// 初始化
let c = getCollection('contracts')
check('S1 初始空槽', c.rows.length === 0 && c.loaded === false && c.stale === false)
// setRows 权威态
setRows('contracts', [{ id: 'C1' }, { id: 'C2' }], { total: 2 })
c = getCollection('contracts')
check('S2 setRows 写入', c.rows.length === 2 && c.loaded === true && c.total === 2 && c.stale === false)
// invalidate
invalidate('contracts')
c = getCollection('contracts')
check('S3 invalidate 标记过期', c.stale === true && c.loaded === false && c.rows.length === 2)
// 再 setRows 清除 stale
setRows('contracts', [{ id: 'C1' }])
check('S4 setRows 清除 stale', getCollection('contracts').stale === false && getCollection('contracts').loaded === true)
// optimisticUpdate 立即生效 + 标记 stale
optimisticUpdate('contracts', (rows) => [...rows, { id: 'C3' }])
c = getCollection('contracts')
check('S5 optimisticUpdate 立即生效', c.rows.length === 2 && c.rows.some((x) => x.id === 'C3') && c.stale === true)
// optimisticUpdate 就地改
optimisticUpdate('contracts', (rows) => { rows[0].name = '改'; return rows })
check('S6 optimisticUpdate 就地改', getCollection('contracts').rows[0].name === '改' && getCollection('contracts').stale === true)
// optimisticUpdate 异常 → 记 error 不改 rows
const before = getCollection('contracts').rows.length
optimisticUpdate('contracts', () => { throw new Error('boom') })
check('S7 optimisticUpdate 异常记 error', getCollection('contracts').rows.length === before && getCollection('contracts').error === 'boom')
// setLoading/setError
setLoading('contracts', true)
check('S8 setLoading', getCollection('contracts').loading === true)
setError('contracts', 'net down')
check('S9 setError 清 loading', getCollection('contracts').error === 'net down' && getCollection('contracts').loading === false)
// resetStore
resetStore()
check('S10 resetStore 清空', !getCollection('contracts').loaded)

// ===== useCollection（node 模式：镜像本地 db）=====
resetStore()
// 用 db 里真实存在的集合（contracts 种子非空）
const seedCount = db.contracts.length
const col = useCollection('contracts')
check('U1 初始未加载', col.data.value.length === 0 && col.loading.value === false)
await col.refresh()
check('U2 refresh 镜像 db', col.data.value.length === seedCount && col.loading.value === false)
check('U3 refresh 后 loaded', getCollection('contracts').loaded === true)
// 幂等：再 refresh 不重复
await col.refresh()
check('U4 refresh 幂等', col.data.value.length === seedCount)
// update 乐观更新
col.update((rows) => [...rows, { id: 'C-OPT' }])
check('U5 update 乐观更新', col.data.value.length === seedCount + 1 && getCollection('contracts').stale === true)
// invalidate
col.invalidate()
check('U6 invalidate 标记过期', getCollection('contracts').stale === true && getCollection('contracts').loaded === false)
// 分页（node 模式：镜像本地 db + 本地切片）
const paged = useCollection('dispatches', { page: 1, size: 5, key: 'dispatches:p1' })
await paged.refresh()
check('U7 分页切片', paged.data.value.length === Math.min(5, db.dispatches.length) && paged.total.value === db.dispatches.length)
// 复合 key 不串缓存：全量视图与分页视图独立
const full = useCollection('dispatches')
await full.refresh()
check('U8 复合 key 独立缓存', full.data.value.length === db.dispatches.length && paged.data.value.length === Math.min(5, db.dispatches.length))
// 过滤（node 模式本地过滤，口径与后端一致）
const pendingContracts = db.contracts.filter((c) => c.status === 'pending').length
const filtered = useCollection('contracts', { status: 'pending', key: 'contracts:pending' })
await filtered.refresh()
check('U9 过滤 status', filtered.data.value.length === pendingContracts && filtered.total.value === pendingContracts)
// keyword 过滤
const kwCount = db.contracts.filter((c) => String(c.id || '').toLowerCase().includes('ht') || String(c.name || '').toLowerCase().includes('ht')).length
const kw = useCollection('contracts', { keyword: 'HT', key: 'contracts:kw' })
await kw.refresh()
check('U10 过滤 keyword（忽略大小写）', kw.data.value.length === kwCount)

console.log('=== Phase 4 阶段 2 数据层单测 ===')
console.log('PASS=' + pass + ' FAIL=' + fail)
for (const f of failures) console.log('  [FAIL] ' + f)
process.exit(fail ? 1 : 0)
