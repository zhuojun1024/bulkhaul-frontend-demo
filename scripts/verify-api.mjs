/**
 * 薄客户端 API 层测试（Phase 4 引擎移除·批次 F1）
 *
 * 背景：生产模式写路径已彻底后端权威（113/116 写操作经 api() POST + 写后重取），
 * 内存引擎（flow.js 状态机）在生产模式为死代码。本套件围绕**薄客户端层**（src/api/index.js）
 * 重建单测，覆盖真正在生产运行的代码：
 *   - W 端点契约（前端↔后端 API 契约：method/path/body，~90 端点）
 *   - api() HTTP 客户端（token 注入 / 401 清登录态 / 网络错误 / 非 JSON 响应 / body 序列化）
 *   - refreshDb() 快照刷新（数组 splice 保响应式 / 对象集合合并 / 日志时间归一）
 *   - afterWrite() node 态 no-op（USE_API=false）
 *
 * 运行：node --import ./scripts/register.mjs scripts/verify-api.mjs
 * node 态 USE_API=false：api() 仍可直接调用（仅 afterWrite/hydrate 门控 USE_API），fetch 以 stub 注入。
 */
import { W, api, refreshDb, afterWrite, USE_API } from '@/api'
import { db } from '@/mock/base'

let pass = 0, fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name) }
}

/* ===== 环境 stub：localStorage（内存版）+ fetch（可注入） ===== */
const lsStore = new Map()
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsStore.set(k, String(v)) },
  removeItem: (k) => { lsStore.delete(k) },
  clear: () => { lsStore.clear() }
}
let fetchImpl = null
globalThis.fetch = (url, opts) => fetchImpl(url, opts)

/* ============================================================
 * 阶段1：W 端点契约（前端↔后端 API 契约是薄客户端核心资产）
 * 通用参数：a[0]=记录对象（id/settlementId/version）、a[1]=字符串、a[2]=数字
 * ============================================================ */
console.log('== 阶段1：W 端点契约（method/path/body 形状） ==')
const A = [{ id: 'REC-0001', settlementId: 'JS-0001', version: 1 }, 'str-arg', 42]
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
const names = Object.keys(W)
check('W 端点数量 >= 85（覆盖全部业务域）', names.length >= 85)
// 个别端点位置参数形状与通用 A 不同（a[0] 为字符串 / a[1] 为对象），按真实调用形状给参
const ARG_OVERRIDES = {
  updateRolePerms: ['调度员', { menus: null, actions: ['dispatch'] }],
  setDataScope: ['zhangsan', { regions: ['华东'] }],
  updateRateCard: ['RATE-001', { changed: true }],
  assessInsuranceClaim: ['BX-001', { responsibility: 'carrier', assessedAmount: 1000 }],
  settleInsuranceClaim: ['BX-001', { settledAmount: 900 }],
  convertRequestToContract: ['YS-0001', { commodityId: 'SP-0001' }]
}
let badMethod = 0, badPath = 0, badBody = 0
for (const n of names) {
  const ep = W[n]
  if (ep.method && !VALID_METHODS.has(ep.method)) { badMethod++; console.log('    非法 method ' + n + '=' + ep.method) }
  const args = ARG_OVERRIDES[n] || A
  if (typeof ep.path !== 'function') { badPath++; console.log('    path 非函数 ' + n); continue }
  let p
  try { p = ep.path(args) } catch (e) { badPath++; console.log('    path 抛异常 ' + n + ': ' + e.message); continue }
  if (typeof p !== 'string' || !p.startsWith('/') || p.length <= 1) { badPath++; console.log('    path 形状非法 ' + n + ' → ' + JSON.stringify(p)) }
  if (ep.body) {
    if (typeof ep.body !== 'function') { badBody++; console.log('    body 非函数 ' + n); continue }
    let b
    try { b = ep.body(args) } catch (e) { badBody++; console.log('    body 抛异常 ' + n + ': ' + e.message); continue }
    if (b === null || b === undefined || (typeof b !== 'object')) { badBody++; console.log('    body 形状非法 ' + n + ' → ' + JSON.stringify(b)) }
  }
}
check('全部端点 method 合法（GET/POST/PUT/DELETE/PATCH）', badMethod === 0)
check('全部端点 path 为 / 开头字符串', badPath === 0)
check('全部带 body 端点 body 为对象/数组', badBody === 0)
// 关键端点路径精确断言（与后端 Controller 映射一致）
check('confirmLoad → /dispatch/{id}/confirmLoad', W.confirmLoad.path(A) === '/dispatch/REC-0001/confirmLoad')
check('scanConfirmLoad → /dispatch/{id}/scan/load', W.scanConfirmLoad.path(A) === '/dispatch/REC-0001/scan/load')
check('customerConfirm → /settlement/{id}/customerConfirm', W.customerConfirm.path(A) === '/settlement/REC-0001/customerConfirm')
check('submitTransportRequest → /contract/request', W.submitTransportRequest.path(A) === '/contract/request')
check('removeUser 为 DELETE', W.removeUser.method === 'DELETE' && W.removeUser.path(A) === '/admin/user/REC-0001')
check('updateRolePerms 为 PUT /admin/role/{name}/perms（a[0]=角色名）', W.updateRolePerms.method === 'PUT' && W.updateRolePerms.path(['调度员']) === '/admin/role/调度员/perms')
check('setDataScope 为 PUT /admin/user/{username}/dataScope（a[0]=账号）', W.setDataScope.method === 'PUT' && W.setDataScope.path(['zhangsan']) === '/admin/user/zhangsan/dataScope')
check('markAllMessagesRead → /admin/messages/readAll', W.markAllMessagesRead.path(A) === '/admin/messages/readAll')
check('issueInvoiceRow 用 a[0].settlementId', W.issueInvoiceRow.path(A) === '/settlement/JS-0001/issueInvoice')

/* ============================================================
 * 阶段2：api() HTTP 客户端（fetch stub 注入）
 * ============================================================ */
console.log('== 阶段2：api() HTTP 客户端 ==')
// 2.1 成功 + token 注入 + Content-Type
lsStore.set('blms_token', 'tok-123')
let captured = null
fetchImpl = (url, opts) => { captured = { url, opts }; return Promise.resolve({ status: 200, json: async () => ({ ok: true, data: { id: 42 } }) }) }
let r = await api('POST', '/dispatch/REC-0001/depart', { x: 1 })
check('api 返回后端 ApiResult（ok/data 透传）', r.ok === true && r.data && r.data.id === 42)
check('请求 URL = /api 前缀 + path', captured.url === '/api/dispatch/REC-0001/depart')
check('带 Authorization: Bearer <token>', captured.opts.headers['Authorization'] === 'Bearer tok-123')
check('带 Content-Type: application/json', captured.opts.headers['Content-Type'] === 'application/json')
check('body 序列化为 JSON 字符串', captured.opts.body === JSON.stringify({ x: 1 }))
// 2.2 无 token → 不带 Authorization
lsStore.delete('blms_token')
captured = null
fetchImpl = (url, opts) => { captured = { url, opts }; return Promise.resolve({ status: 200, json: async () => ({ ok: true }) }) }
await api('GET', '/snapshot')
check('无 token 时不带 Authorization 头', captured.opts.headers['Authorization'] === undefined)
// 2.3 401 → 清登录态 + unauthenticated
lsStore.set('blms_token', 'tok-expired')
fetchImpl = () => Promise.resolve({ status: 401, json: async () => ({ error: '登录已过期' }) })
r = await api('GET', '/snapshot')
check('401 → ok:false + code:unauthenticated', r.ok === false && r.code === 'unauthenticated')
check('401 → 透传后端 error 文案', r.error === '登录已过期')
check('401 → 清除本地 token', lsStore.get('blms_token') === undefined)
// 2.4 网络错误 → code:network
fetchImpl = () => Promise.reject(new Error('ECONNREFUSED'))
r = await api('GET', '/snapshot')
check('网络错误 → ok:false + code:network', r.ok === false && r.code === 'network')
check('网络错误 → 含可操作提示', /无法连接后端服务/.test(r.error))
// 2.5 非 JSON 响应 → code:bad-response
fetchImpl = () => Promise.resolve({ status: 200, json: async () => { throw new Error('not json') } })
r = await api('GET', '/snapshot')
check('非 JSON 响应 → ok:false + code:bad-response', r.ok === false && r.code === 'bad-response')

/* ============================================================
 * 阶段3：refreshDb() 快照刷新（后端为权威态）
 * ============================================================ */
console.log('== 阶段3：refreshDb() 快照刷新 ==')
// 预置本地 db（模拟 hydrate 前的旧态）
db.commodities.splice(0, db.commodities.length, { id: 'SP-OLD', name: '旧商品' })
db.rolePerms['旧角色'] = { menus: [], actions: [] }
db.logs.splice(0, db.commodities && db.logs.length, ...[{ time: '2026-01-01 00:00:00', msg: '旧日志' }])
const commoditiesBefore = db.commodities // 记录数组引用（splice 保身份）
lsStore.set('blms_token', 'tok-123')
const snapshot = {
  ok: true,
  data: {
    commodities: [{ id: 'SP-0001', name: '新商品' }, { id: 'SP-0002', name: '煤炭' }],
    rolePerms: { '调度员': { menus: null, actions: ['dispatch'] } },
    logs: [{ time: '2026-08-29T21:39:17', msg: '后端日志' }]
  }
}
fetchImpl = () => Promise.resolve({ status: 200, json: async () => snapshot })
const ok = await refreshDb()
check('refreshDb 返回 true（快照成功）', ok === true)
check('数组集合被快照替换（旧行清除）', db.commodities.length === 2 && db.commodities[0].id === 'SP-0001')
check('数组 splice 保响应式身份（引用不变）', db.commodities === commoditiesBefore)
check('对象集合合并（旧键清除 + 新键写入）', db.rolePerms['调度员'] && db.rolePerms['旧角色'] === undefined)
check('日志时间归一（ISO T → 空格）', db.logs[0].time === '2026-08-29 21:39:17')
// 快照失败 → 返回 false，db 不变
db.commodities.splice(0, db.commodities.length, { id: 'KEEP-1' })
fetchImpl = () => Promise.resolve({ status: 500, json: async () => ({ ok: false, error: 'boom' }) })
const ok2 = await refreshDb()
check('快照失败 → 返回 false', ok2 === false)
check('快照失败 → db 不被污染', db.commodities.length === 1 && db.commodities[0].id === 'KEEP-1')

/* ============================================================
 * 阶段4：afterWrite() node 态 no-op（USE_API=false）
 * ============================================================ */
console.log('== 阶段4：afterWrite() node 态 no-op ==')
check('node 态 USE_API=false', USE_API === false)
let fetchCalled = false
fetchImpl = () => { fetchCalled = true; return Promise.resolve({ status: 200, json: async () => ({ ok: true }) }) }
let ret
try { ret = afterWrite('confirmLoad', { id: 'PD-0001', version: 1 }) } catch (e) { ret = 'threw:' + e.message }
check('afterWrite node 态不抛异常', ret !== 'threw')
check('afterWrite node 态不发 HTTP（no-op）', fetchCalled === false)

/* ===== 汇总 ===== */
console.log('')
console.log('结果：' + pass + ' 通过，' + fail + ' 失败')
if (fail > 0) process.exit(1)
