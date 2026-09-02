/**
 * HTTP 客户端（薄客户端）：fetch 相对 /api（经 dev server / verify-ui 静态服务反向代理到 8081，无 CORS），
 * 自动带 Authorization: Bearer，解析 ApiResult{ok,data,error,code}。401 → 清 token（登录态失效）。
 */
/** 浏览器环境（有 localStorage）启用真实 API；node 测试态关闭 */
export const USE_API = typeof window !== 'undefined' && !!window.localStorage

const BASE = '/api'

export function token() {
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
