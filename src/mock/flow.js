import { db, randInt, randomName, ROUTES, MAP_NODES, NOW, tareOf, loadVarianceOf, genId, ROAD_MODES, isRoadMode } from './base'
import { ROLE_ACTIONS } from '@/permission-table'
import dayjs from 'dayjs'
import { round, formatMoney, hashPassword } from '@/utils'

export { tareOf, ROAD_MODES, isRoadMode }

/**
 * 业务流转中枢：集中管理调度单状态机，及向计划/合同/资源的回卷联动
 * 状态机：pending(待装货) → loading(装货中) → intransit(在途) → unloading(卸货中) → completed(已完成)
 *        任意执行态可上报异常 → exception(异常)，异常关闭后可恢复运输
 * 所有页面操作统一调用本模块，避免状态逻辑散落在各页面
 *
 * P2 架构下沉（对接 API 前提）：
 * - 服务层 RBAC 单点校验（requireAction）：状态变更入口按操作人角色校验权限（db.rolePerms 数据化，默认拒绝），
 *   前端按钮权限仅为体验层；对接后端后本模块函数即后端 endpoint 的校验逻辑
 * - 司机端入口（scanConfirmLoad/scanConfirmUnload/driverDepart/driverArrive/acceptDispatch/signReceipt）
 *   走内部核心（doConfirmLoad/doConfirmUnload/doDepart/doArrive），状态机守卫与 PC 端一致；
 *   不做 PC 端 RBAC（等价后端司机 App 独立鉴权，N-1 修复：司机角色操作权限为空，原实现误走 PC 入口被拦截），
 *   但统一经司机端身份守卫 requireDriverApp（M6 修复）：仅车次本人司机或持 dispatch 执行权限角色（演示切换）可调用
 * - 资源乐观锁（version + validateResourceCommit）：车辆/司机占用在提交前二次校验，防并发超占
 * - 定时任务驱动（scheduler.js）：围栏事件/GPS 遥测/逾期校准不再依赖页面 tick
 * - 写操作全部下沉：合同/计划/商品/客户/司机/车辆/库存/用户/角色的新建与状态变更均经本模块（守卫+审计）
 */

const vehicleOf = (id) => db.vehicles.find((v) => v.id === id)
const driverOf = (id) => db.drivers.find((d) => d.id === id)
const planOf = (id) => db.plans.find((p) => p.id === id)
const contractOf = (id) => db.contracts.find((c) => c.id === id)

/** 执行中状态（占用车辆/司机） */
const ACTIVE = ['loading', 'intransit', 'unloading']

/** 公路口径 ROAD_MODES / isRoadMode 定义于 base.js（种子与服务层共用口径），上方 re-export 保持既有导入不变 */

/** 运输单元编号（铁路车号/船舶名/管段），按 方式+调度单号 确定性派生 */
export function unitNoOf(mode, seedStr) {
  let n = 0
  for (const ch of String(seedStr)) n = (n * 31 + ch.charCodeAt(0)) % 100000
  if (mode === '铁路') return `X${1000 + (n % 9000)}次`
  if (mode === '水运') return `冀散货${100 + (n % 899)}`
  if (mode === '管道') return `管线${['一', '二', '三', '四'][n % 4]}线`
  return `联运${2026000 + (n % 999)}`
}

/** 发票号码：按种子串确定性派生 16 位（与全局种子随机体系一致，不用 Math.random） */
export function genInvoiceNo(seedStr) {
  let n = 0
  for (const ch of String(seedStr)) n = (n * 31 + ch.charCodeAt(0)) % 2147483647
  return '2410' + String(100000000000 + (n % 900000000000))
}

/* ========== 审计日志与服务层权限（RBAC 单点校验） ========== */

/** 当前操作人（登录时写入；审计日志与服务层权限校验使用）
 *  P3 工程加固：默认"未登录"态（默认拒绝）——未登录直调服务层一律按 RBAC 拦截，
 *  与"默认拒绝"原则一致（原缺陷：未登录态按平台管理员最高权限放行）。
 *  浏览器登录守卫保证 setOperator；driverId：司机账号绑定的司机档案（司机端身份守卫 M6 用） */
let operator = { name: '未登录', username: '', role: '', driverId: '' }
export function setOperator(user) {
  if (user && user.username) {
    operator = { name: user.name || user.username, username: user.username, role: user.role || '', driverId: user.driverId || '' }
  }
}

/** M7 修复：清除操作人（退出登录时调用）——服务层进入"未登录"态，
 *  后续写操作按默认拒绝拦截，审计日志不再记在旧用户名下（原缺陷：登出后 operator 残留） */
export function clearOperator() {
  operator = { name: '未登录', username: '', role: '', driverId: '' }
}

/** 服务层权限判定（P2：后端 RBAC 单点校验的等价实现）
 *  判定顺序与 permission.js 一致：db.rolePerms[角色]（数据化，角色管理页可编辑）→ 内置表 ROLE_ACTIONS → 默认拒绝 */
export function operatorCan(action) {
  const perm = db.rolePerms && db.rolePerms[operator.role]
  const actions = perm ? perm.actions : ROLE_ACTIONS[operator.role]
  if (actions === null) return true
  if (actions === undefined) return false
  return actions.includes(action)
}

/** 状态变更入口守卫：无权限返回错误（不抛异常，调用方统一处理）
 *  前端按钮权限（usePerm）仅为体验层；本守卫是"后端单点校验"的等价物，改 localStorage 也无法绕过 */
function requireAction(action) {
  if (operatorCan(action)) return null
  return { error: `当前角色「${operator.role || '未登录'}」无此操作权限，操作已被服务层拦截` }
}

/** P3 工程加固：日志/消息上限（防 localStorage 5MB 配额撑爆；超限裁剪最旧记录） */
export const MAX_LOGS = 1000
export const MAX_MESSAGES = 500

/** 写审计日志（状态变更动作实时落日志）；超 MAX_LOGS 裁剪最旧 */
export function logAction(module, action, detail, result = 'success') {
  db.logs.unshift({
    id: genId('LOG-', 5, db.logs),
    time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    user: operator.name,
    username: operator.username,
    action,
    module,
    detail: detail || '',
    ip: '192.168.1.100',
    result
  })
  if (db.logs.length > MAX_LOGS) db.logs.length = MAX_LOGS
}

/* ========== 环节9：登录安全（验证码 + 密码哈希） ==========
 *  验证码：一次性、60 秒有效，SVG 渲染（字符为 <text> 元素，e2e 可读）；
 *  密码：用户表只存哈希（hashPassword，SHA-256），登录按哈希比对，不落明文。
 *  对接后端时本段即登录 endpoint 的校验逻辑（届时换 JWT/短信鉴权 + 服务端加盐哈希） */

const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CAPTCHA_TTL = 60 * 1000
const captchaStore = new Map() // id -> { code, expiresAt }（运行态，不随快照持久化）

/** 生成验证码（4 位，60 秒有效，一次性）；返回 { id, code, svg } */
export function generateCaptcha() {
  let code = ''
  for (let i = 0; i < 4; i++) code += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)]
  const id = 'CAP-' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0')
  captchaStore.set(id, { code, expiresAt: Date.now() + CAPTCHA_TTL })
  return { id, code, svg: captchaSvgOf(code) }
}

/** 校验并消费验证码（一次性；不存在/过期/不符均返回 false） */
export function verifyCaptcha(id, input) {
  const rec = captchaStore.get(id)
  if (!rec) return false
  if (Date.now() > rec.expiresAt) {
    captchaStore.delete(id)
    return false
  }
  captchaStore.delete(id)
  return rec.code === String(input || '').trim().toUpperCase()
}

/** 登录校验（验证码 + 密码哈希 + 账号状态）；成功返回 { ok, user }，失败返回 { error, code }
 *  code: captcha（验证码错/过期）/ credential（用户名或密码错）/ disabled（账号停用）
 *  成功/凭据失败/停用均记审计日志；会话建立（setOperator/userStore.login）由调用方完成 */
export function login(username, password, captchaId, captchaCode) {
  const id = String(username || '').trim()
  if (!verifyCaptcha(captchaId, captchaCode)) {
    return { error: '验证码错误或已过期', code: 'captcha' }
  }
  const user = db.users.find((u) => u.username === id || u.phone === id)
  if (!user || user.passwordHash !== hashPassword(password)) {
    logAction('系统', '登录系统', `账号 ${id} 登录失败（用户名或密码错误）`, 'fail')
    return { error: '用户名或密码错误', code: 'credential' }
  }
  if (user.status !== 'active') {
    logAction('系统', '登录系统', `账号 ${user.username} 登录失败（账号已停用）`, 'fail')
    return { error: '账号已停用，请联系管理员', code: 'disabled' }
  }
  logAction('系统', '登录系统', `账号 ${user.username}（${user.role}）登录成功`)
  return { ok: true, user }
}

/** 验证码 SVG（字符为 <text> 元素，带随机位移/旋转/颜色 + 干扰线，e2e 可读字符） */
function captchaSvgOf(code) {
  const width = 120
  const height = 40
  const colors = ['#2b5ce6', '#0f9d58', '#d97706', '#dc2626', '#7c3aed']
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  svg += `<rect width="${width}" height="${height}" rx="6" fill="#f1f5f9"/>`
  for (let i = 0; i < 3; i++) {
    const x1 = (Math.random() * width).toFixed(1)
    const y1 = (Math.random() * height).toFixed(1)
    const x2 = (Math.random() * width).toFixed(1)
    const y2 = (Math.random() * height).toFixed(1)
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colors[i % colors.length]}" stroke-width="1" opacity="0.35"/>`
  }
  const step = width / (code.length + 1)
  for (let i = 0; i < code.length; i++) {
    const x = step * (i + 1) + (Math.random() * 6 - 3)
    const y = height / 2 + 8 + (Math.random() * 6 - 3)
    const rotate = Math.random() * 30 - 15
    const color = colors[Math.floor(Math.random() * colors.length)]
    svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="24" font-family="Consolas, monospace" font-weight="bold" fill="${color}" transform="rotate(${rotate.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${code[i]}</text>`
  }
  svg += `</svg>`
  return svg
}

/* ========== 消息中心（G6：flow 事件驱动，顶栏未读角标 + 消息中心页） ========== */

/** 发送平台消息（关键业务事件调用；type: approval/dispatch/exception/settlement/request/system）
 *  M4 修复（消息定向）：to = 目标角色名数组，仅这些角色可见；null/缺省 = 全员广播。
 *  定向按 RBAC 操作码推导（toRoles，与服务层权限判定同口径），审批消息只发审批人等 */
export function notify(title, type, path, content = '', to = null) {
  db.messages.unshift({
    id: genId('MSG-', 4, db.messages),
    title,
    content,
    type,
    path,
    time: dayjs().format('YYYY-MM-DD HH:mm'),
    read: false,
    to: to || null
  })
  if (db.messages.length > MAX_MESSAGES) db.messages.length = MAX_MESSAGES
  return db.messages[0]
}

/** 持有指定操作的角色（M4 消息定向：与 operatorCan 判定顺序一致，db.rolePerms → ROLE_ACTIONS） */
export function rolesWithAction(action) {
  const names = new Set([...Object.keys(db.rolePerms || {}), ...Object.keys(ROLE_ACTIONS)])
  const res = []
  for (const name of names) {
    const perm = db.rolePerms && db.rolePerms[name]
    const actions = perm ? perm.actions : ROLE_ACTIONS[name]
    if (actions === null || (Array.isArray(actions) && actions.includes(action))) res.push(name)
  }
  return res
}

/** 消息定向：多个操作码的持有角色并集 */
export function toRoles(...actions) {
  const s = new Set()
  for (const a of actions) for (const r of rolesWithAction(a)) s.add(r)
  return [...s]
}

/** 当前操作人可见消息（M4：广播全员可见；定向消息仅目标角色可见；平台管理员可见全部） */
export function visibleMessages() {
  if (operator.role === '平台管理员') return [...db.messages]
  return db.messages.filter((m) => !m.to || m.to.includes(operator.role))
}

/** 标记消息已读（仅当前操作人可见的消息可标记，服务层守卫） */
export function markMessageRead(m) {
  if (m && !m.read && (!m.to || m.to.includes(operator.role) || operator.role === '平台管理员')) m.read = true
  return { ok: true }
}

/** 全部标记已读（仅标记当前操作人可见的消息，避免把其他角色的定向消息标读），返回本次标记条数 */
export function markAllMessagesRead() {
  let n = 0
  for (const m of visibleMessages()) {
    if (!m.read) {
      m.read = true
      n += 1
    }
  }
  return n
}

/* ===== 环节6：消息免打扰（DND，按登录账号，存 db.dnd 随快照持久化） ===== */

/** 当前操作人的免打扰设置（缺省：关闭，免打扰时段 22:00-08:00，无类型屏蔽） */
export function getDnd() {
  const d = db.dnd && db.dnd[operator.username]
  return d
    ? { ...d }
    : { enabled: false, quietStart: '22:00', quietEnd: '08:00', mutedTypes: [] }
}

/** 保存免打扰设置（未登录态拒绝） */
export function setDnd(settings) {
  if (!operator.username) return { error: '未登录，无法保存免打扰设置' }
  db.dnd = db.dnd || {}
  db.dnd[operator.username] = {
    enabled: !!settings.enabled,
    quietStart: settings.quietStart || '22:00',
    quietEnd: settings.quietEnd || '08:00',
    mutedTypes: Array.isArray(settings.mutedTypes) ? settings.mutedTypes : []
  }
  return { ok: true }
}

/** 消息是否被当前操作人免打扰：类型屏蔽，或消息时间落在免打扰时段（支持跨零点，如 22:00-08:00） */
export function isMuted(m) {
  const d = getDnd()
  if (!d.enabled || !m) return false
  if ((d.mutedTypes || []).includes(m.type)) return true
  const t = String(m.time || '').slice(11, 16)
  if (!t) return false
  return d.quietStart <= d.quietEnd
    ? t >= d.quietStart && t < d.quietEnd
    : t >= d.quietStart || t < d.quietEnd
}

/** 未读数（顶栏角标/消息中心）：未读且未被免打扰（DND 消息不打扰） */
export function unreadCount() {
  return visibleMessages().filter((m) => !m.read && !isMuted(m)).length
}

/* ===== 环节8：数据权限（行级，按登录账号；RBAC 是功能权限，本层是数据权限，多租户对接的等价物） =====
 * 口径：按**装货侧场站区域**过滤（调度员只看本区线路）；区域取自场站 region（单一来源）。
 * 无范围设置/空数组 = 全量数据；平台管理员恒为全量。 */

/** 全部区域（由场站 region 派生，单一来源） */
export const DATA_REGIONS = [...new Set(db.terminals.map((t) => t.region))]

/** 当前操作人的数据范围：regions 为空 = 全量数据；平台管理员恒为全量 */
export function dataScopeOf() {
  if (operator.role === '平台管理员') return { regions: [] }
  return (db.dataScopes && db.dataScopes[operator.username]) || { regions: [] }
}

/** 记录的装货侧区域：调度单/计划直接取 loadTerminalId；合同/结算单经合同派生 */
export function recordRegion(record) {
  const loadTerminalId = record && (record.loadTerminalId || (record.contractId && contractOf(record.contractId)?.loadTerminalId))
  const t = db.terminals.find((x) => x.id === loadTerminalId)
  return t ? t.region : null
}

/** 记录是否在当前操作人数据范围内（无范围=全量；无区域归属的记录可见，防御口径） */
export function inDataScope(record) {
  const scope = dataScopeOf()
  if (!scope.regions.length) return true
  const region = recordRegion(record)
  return region ? scope.regions.includes(region) : true
}

/** 当前操作人可见调度单（行级过滤，列表页/在途监控统一口径） */
export function visibleDispatches() {
  return db.dispatches.filter(inDataScope)
}

/** 当前操作人可见计划（行级过滤） */
export function visiblePlans() {
  return db.plans.filter(inDataScope)
}

/** 设置数据范围（RBAC：user）；regions 传 [] 清除范围（恢复全量）；平台管理员不可被限制 */
export function setDataScope(username, regions) {
  const permErr = requireAction('user')
  if (permErr) return permErr
  const u = db.users.find((x) => x.username === username)
  if (!u) return { error: `账号 ${username} 不存在` }
  if (u.username === 'admin') return { error: '平台管理员为全量数据，不可设置数据范围' }
  if (!Array.isArray(regions)) return { error: '数据范围须为区域数组' }
  const list = regions.filter((r) => DATA_REGIONS.includes(r))
  if (list.length !== regions.length) return { error: '包含无效区域' }
  db.dataScopes = db.dataScopes || {}
  if (list.length) db.dataScopes[username] = { regions: list }
  else delete db.dataScopes[username]
  logAction('系统管理', '设置数据范围', `账号 ${username} 数据范围：${list.length ? list.join('、') : '全量数据'}`)
  return { ok: true }
}

/** 登记磅单 */
function pushWeighing(d, type, net, time) {
  const v = vehicleOf(d.vehicleId)
  const tare = tareOf(v)
  db.weighings.unshift({
    id: genId('BZ-', 5, db.weighings),
    dispatchId: d.id,
    plate: v ? v.plate : '-',
    terminalId: type === '进磅' ? d.loadTerminalId : d.unloadTerminalId,
    type,
    gross: +(tare + net).toFixed(2),
    tare,
    net: +net.toFixed(2),
    time,
    operator: randomName()
  })
}

/** 磅单补录：场站操作员对尚无该类型磅单的车次手工录单（仅公路口径车次） */
export function manualWeighing(dispatchId, type, net) {
  const permErr = requireAction('weighing')
  if (permErr) return permErr
  const d = db.dispatches.find((x) => x.id === dispatchId)
  if (!d) return { error: '调度单不存在' }
  if (!isRoadMode(d.mode)) return { error: `${d.mode} 车次按运输单元执行，无公路磅单，无需补录` }
  if (db.weighings.some((w) => w.dispatchId === dispatchId && w.type === type)) {
    return { error: `该调度单已存在${type}磅单，不能重复补录` }
  }
  pushWeighing(d, type, net, dayjs().format('YYYY-MM-DD HH:mm'))
  logAction('磅单记录', '磅单补录', `调度单 ${d.id} 补录${type}磅单，净重 ${net} 吨`)
  return { ok: true }
}

/** 磅单更正/复磅（RBAC：weighing）：修正一张磅单的净重（过磅读数错误/争议复磅），从源头溯源
 *  留痕：保留首次原始净重（originalNet，支持多次复磅追溯），记录复磅时间/原因/操作人，重算毛重
 *  结算联动：车次已入账单时按当前磅单重算金额；已对账/已结算账单因客户确认基于旧磅单而失效，
 *  回"待对账"并清除客户确认与对账快照，须重新对账 + 客户再确认（与异常补扣失效确认同机制） */
export function correctWeighing(weighingId, newNet, reason) {
  const permErr = requireAction('weighing')
  if (permErr) return permErr
  const w = db.weighings.find((x) => x.id === weighingId)
  if (!w) return { error: '磅单不存在' }
  const net = +Number(newNet)
  if (!isFinite(net) || net <= 0) return { error: '复磅净重须为大于 0 的数值' }
  const fixed = +net.toFixed(2)
  if (fixed === w.net) return { error: '复磅净重与原值相同，无需更正' }
  const r = String(reason || '').trim()
  if (!r) return { error: '请填写复磅原因' }
  const oldNet = w.net
  w.originalNet = w.originalNet != null ? w.originalNet : oldNet
  w.net = fixed
  w.gross = +(w.tare + fixed).toFixed(2)
  w.corrected = true
  w.correctTime = dayjs().format('YYYY-MM-DD HH:mm')
  w.correctReason = r
  w.correctOperator = operator.name
  logAction('磅单记录', '磅单更正/复磅', `磅单 ${w.id}（调度单 ${w.dispatchId}，${w.type}）净重 ${oldNet} → ${fixed} 吨，原因：${r}`)
  // 结算联动：车次已入账单 → 按当前磅单重算金额，已对账/已结算则客户确认失效
  const d = db.dispatches.find((x) => x.id === w.dispatchId)
  if (d && d.settlementId) {
    const s = db.settlements.find((x) => x.id === d.settlementId)
    if (s) applyWeighingCorrectionToSettlement(s, w, oldNet, fixed)
  }
  notify(`磅单 ${w.id} 已复磅更正`, 'weighing', '/terminal/weighing', `${w.type}净重 ${oldNet} → ${fixed} 吨，原因：${r}`, toRoles('weighing', 'settlement'))
  return { ok: true, oldNet, net: fixed }
}

/** 磅单更正的结算联动：按当前磅单重算账单金额；已对账/已结算账单客户确认失效，回待对账
 *  与 recalcSettlement 同口径重算费用（出磅净重变化 → 结算量/运费/损耗/质量扣重变化）；
 *  已开票账单金额变化 → 发票标记金额陈旧（红冲重开前拦截收款） */
function applyWeighingCorrectionToSettlement(s, w, oldNet, net) {
  const c = contractOf(s.contractId)
  const ds = db.dispatches.filter((x) => x.settlementId === s.id)
  const wasReconciled = s.status !== 'pending'
  const fees = calcSettlementFees(c, ds)
  const oldTotal = s.totalAmount
  Object.assign(s, fees)
  s.totalAmount =
    fees.freight +
    fees.loadingFee +
    fees.unloadingFee +
    (s.tollFee || 0) +
    (s.surcharge || 0) -
    fees.lossDeduction -
    fees.qualityDeduction -
    fees.exceptionLoss
  const delta = s.totalAmount - oldTotal
  if (delta !== 0) {
    s.adjustments = s.adjustments || []
    s.adjustments.push({
      time: dayjs().format('YYYY-MM-DD HH:mm'),
      reason: `磅单 ${w.id} 复磅更正（${w.type}净重 ${oldNet} → ${net}）${wasReconciled ? '，已对账/结算，客户确认失效，须重新对账确认' : ''}`,
      amount: delta
    })
    // M5 修复：已开票账单金额变化 → 发票标记金额陈旧，红冲重开前收款被拦截（强制流程）
    if (s.invoiceStatus === 'issued') markInvoiceStale(s, `磅单 ${w.id} 复磅更正，账单金额变化`)
  }
  // 已对账/已结算：对账快照与客户确认基于旧磅单，逻辑上失效 → 回待对账，须重新对账 + 客户再确认
  if (wasReconciled) {
    s.status = 'pending'
    s.customerConfirmed = null
    s.reconciliation = null
    s.settleDate = null
    notify(
      `账单 ${s.billNo} 磅单更正后须重新对账确认`,
      'settlement',
      '/settlement',
      `磅单 ${w.id} 复磅更正（${w.type}净重 ${oldNet} → ${net}），结算金额调整为 ${formatMoney(s.totalAmount)}，客户原确认已失效，请重新对账并由客户确认`,
      toRoles('settlement')
    )
    notify(
      `账单 ${s.billNo} 金额调整，请重新确认对账`,
      'settlement',
      '/portal',
      `磅单更正后结算金额调整为 ${formatMoney(s.totalAmount)}，请重新确认对账结果`,
      toRoles('customer-confirm')
    )
  }
  logAction(
    '结算管理',
    '结算调整',
    `账单 ${s.billNo} 因磅单 ${w.id} 复磅更正重算：结算金额 ${formatMoney(oldTotal)} → ${formatMoney(s.totalAmount)}（${delta > 0 ? '+' : ''}${formatMoney(delta)}）${wasReconciled ? '，客户确认失效，账单回待对账' : ''}`
  )
}

/** 占用车辆/司机（派车、发车、恢复时）；version 递增（乐观锁写标记，提交前校验用） */
export function occupyResource(d) {
  const v = vehicleOf(d.vehicleId)
  const dr = driverOf(d.driverId)
  if (v && v.status !== 'scrapped') {
    v.status = 'inuse'
    v.version = (v.version || 1) + 1
  }
  if (dr) {
    dr.status = 'onduty'
    dr.version = (dr.version || 1) + 1
  }
}

/** 释放车辆/司机（完成时；仍有其他执行中任务则不释放）；version 递增 */
export function releaseResource(d) {
  const v = vehicleOf(d.vehicleId)
  const dr = driverOf(d.driverId)
  if (v && !db.dispatches.some((x) => x.vehicleId === v.id && ACTIVE.includes(x.status))) {
    v.status = 'idle'
    v.version = (v.version || 1) + 1
  }
  if (dr && !db.dispatches.some((x) => x.driverId === dr.id && ACTIVE.includes(x.status))) {
    dr.status = 'available'
    dr.version = (dr.version || 1) + 1
  }
}

/** 回卷计划：进度=已完成车次运量/批次量；全部完成→completed，有执行/异常→intransit，未开始→dispatched */
export function rollupPlan(planId) {
  const p = planOf(planId)
  if (!p || p.status === 'cancelled') return
  const ds = db.dispatches.filter((x) => x.planId === planId)
  if (!ds.length) return
  const doneQty = ds.filter((x) => x.status === 'completed').reduce((s, x) => s + x.quantity, 0)
  p.progress = Math.min(100, Math.round((doneQty / p.quantity) * 100))
  const allDone = ds.every((x) => x.status === 'completed')
  const active = ds.some((x) => ACTIVE.includes(x.status) || x.status === 'exception')
  p.status = allDone ? 'completed' : active || doneQty > 0 ? 'intransit' : 'dispatched'
  rollupContract(p.contractId)
}

/** 回卷合同：进度=实际完成运量/合同计划量；量达成→completed */
export function rollupContract(contractId) {
  const c = contractOf(contractId)
  if (!c || c.status !== 'executing') return
  const doneQty = db.dispatches
    .filter((x) => x.contractId === contractId && x.status === 'completed')
    .reduce((s, x) => s + x.quantity, 0)
  c.progress = Math.min(100, Math.round((doneQty / c.quantity) * 100))
  if (c.progress >= 100) c.status = 'completed'
}

/** 仓储联动：确认装货 → 装货场站（有仓库时）出库，按入库时间 FIFO 跨批次扣减
 *  M3 修复（充足性守卫）：
 *  - 仓库有该商品批次但可发库存（normal 状态）不足本车次量 → 返回错误，拦截装货（大宗物流装货前须校验可发库存）；
 *  - 仓库无该商品批次记录（外采/过路，如煤场站对应矿石仓）→ 不做出库联动（与原口径一致）；
 *  - 充足 → 跨批次 FIFO 扣减（修复原"只扣最早批次、不足静默扣到 0"的库存丢失） */
function warehouseOut(d) {
  const t = db.terminals.find((x) => x.id === d.loadTerminalId)
  const wh = t && t.warehouseId ? db.warehouses.find((w) => w.id === t.warehouseId) : null
  if (!wh || wh.status !== 'operating') return null
  const batches = db.inventories.filter((i) => i.warehouseId === wh.id && i.commodityId === d.commodityId)
  if (!batches.length) return null
  const available = batches.filter((i) => i.status === 'normal').reduce((s, i) => s + i.quantity, 0)
  if (available < d.quantity) {
    const name = db.commodities.find((x) => x.id === d.commodityId)?.name || d.commodityId
    return { error: `装货场站可发库存不足：${wh.name} 该商品（${name}）可发库存 ${available} 吨，本车次需 ${d.quantity} 吨，请先补库或调整车次数量后再装货` }
  }
  let rest = d.quantity
  for (const b of batches.filter((i) => i.status === 'normal').sort((a, x) => (a.inDate < x.inDate ? -1 : 1))) {
    if (rest <= 0) break
    const take = Math.min(b.quantity, rest)
    b.quantity = +(b.quantity - take).toFixed(2)
    rest = +(rest - take).toFixed(2)
  }
  wh.used = Math.max(0, +(wh.used - d.quantity).toFixed(2))
  logAction('仓储管理', '出库', `调度单 ${d.id} 装货：${wh.name} 出库 ${d.quantity} 吨`)
  // 环节7：出库后若可发库存跌破安全库存下限（穿越阈值），发出预警
  checkInventoryAlert(wh, d.commodityId, available)
  return null
}

/** 仓储联动：确认卸货 → 卸货场站（有仓库时）入库，按出磅净重生成新批次 */
function warehouseIn(d) {
  const t = db.terminals.find((x) => x.id === d.unloadTerminalId)
  const wh = t && t.warehouseId ? db.warehouses.find((w) => w.id === t.warehouseId) : null
  if (!wh || wh.status !== 'operating') return
  const w = db.weighings.find((x) => x.dispatchId === d.id && x.type === '出磅')
  const qty = w ? w.net : d.quantity
  db.inventories.unshift({
    id: genId('INV-', 4, db.inventories),
    warehouseId: wh.id,
    commodityId: d.commodityId,
    batch: `B${dayjs().format('YYMMDD')}-${d.id.slice(-3)}`,
    quantity: qty,
    inDate: dayjs().format('YYYY-MM-DD'),
    status: 'normal'
  })
  wh.used = Math.min(wh.capacity, wh.used + qty)
  logAction('仓储管理', '入库', `调度单 ${d.id} 卸货：${wh.name} 入库 ${qty} 吨`)
}

/* ===== 环节7：安全库存预警（仓库×商品 下限，可发库存跌破下限即告警，M3 充足性守卫的补充） ===== */

/** 指定仓库×商品的安全库存记录（未设置返回 null） */
export function safetyStockOf(warehouseId, commodityId) {
  return (db.safetyStocks || []).find((x) => x.warehouseId === warehouseId && x.commodityId === commodityId) || null
}

/** 指定仓库×商品的可发库存（normal 状态批次合计，与 M3 出库守卫同口径） */
export function availableStockOf(warehouseId, commodityId) {
  return db.inventories
    .filter((i) => i.warehouseId === warehouseId && i.commodityId === commodityId && i.status === 'normal')
    .reduce((s, i) => s + i.quantity, 0)
}

/** 安全库存预警列表：可发库存 < 安全库存下限（仓库×商品维度，实时计算） */
export function inventoryAlerts() {
  const res = []
  for (const sq of db.safetyStocks || []) {
    const available = availableStockOf(sq.warehouseId, sq.commodityId)
    if (available < sq.minQty) {
      res.push({ warehouseId: sq.warehouseId, commodityId: sq.commodityId, available, minQty: sq.minQty, gap: +(sq.minQty - available).toFixed(2) })
    }
  }
  return res
}

/** 安全库存预警检查：可发库存由 ≥ 下限 跌破 < 下限（穿越阈值）时写审计日志 + 定向通知仓储角色
 *  已处于低于下限状态时不重复告警（避免同一缺口反复打扰） */
function checkInventoryAlert(wh, commodityId, beforeAvail) {
  const sq = safetyStockOf(wh.id, commodityId)
  if (!sq) return
  const after = availableStockOf(wh.id, commodityId)
  if (beforeAvail >= sq.minQty && after < sq.minQty) {
    const name = db.commodities.find((x) => x.id === commodityId)?.name || commodityId
    logAction('仓储管理', '安全库存预警', `${wh.name} ${name} 可发库存 ${after} 吨，跌破安全库存下限 ${sq.minQty} 吨`)
    notify(
      `安全库存预警：${wh.name} ${name} 可发库存 ${after} 吨，低于安全库存 ${sq.minQty} 吨`,
      'system',
      '/warehouse/inventory',
      `缺口 ${sq.minQty - after} 吨，请及时安排补库`,
      toRoles('warehouse')
    )
  }
}

/** 确认装货核心（状态机流转；PC 端 confirmLoad 与司机端 scanConfirmLoad 共用）
 *  前置守卫：须处于"待装货"态；公路车次须司机已接单（与司机端规则一致） */
function doConfirmLoad(d) {
  if (d.status !== 'pending') return { error: `调度单 ${d.id} 当前非"待装货"状态，无法确认装货` }
  if (isRoadMode(d.mode) && d.driverId && !d.accepted) return { error: `司机尚未接单，请先由司机接单后再确认装货` }
  const outErr = warehouseOut(d)
  if (outErr) return outErr
  d.status = 'loading'
  d.loadTime = dayjs().format('YYYY-MM-DD HH:mm')
  d.progress = 5
  let inNet = null
  if (isRoadMode(d.mode)) {
    // P2 进磅实际过磅：装货过磅净重 = 调度量 × (1 ± 0.5%)（实际过磅值，非恒等于调度量）
    inNet = +(d.quantity * (1 + loadVarianceOf(d.id))).toFixed(2)
    pushWeighing(d, '进磅', inNet, d.loadTime)
  }
  rollupPlan(d.planId)
  logAction(
    '场站管理',
    '确认装货',
    isRoadMode(d.mode)
      ? `调度单 ${d.id} 确认装货（进磅 ${inNet} 吨）`
      : `调度单 ${d.id} 确认装货（${d.mode} ${d.unitNo || ''}，${d.quantity} 吨）`
  )
}

/** 确认装货（PC 端入口：RBAC 单点校验 dispatch） */
export function confirmLoad(d) {
  const permErr = requireAction('dispatch')
  if (permErr) return permErr
  return doConfirmLoad(d)
}

/** 发车核心（状态机流转 + 资源占用；PC 端 depart 与司机端 driverDepart 共用） */
function doDepart(d) {
  if (d.status !== 'loading') return { error: `调度单 ${d.id} 当前非"装货中"状态，无法发车` }
  d.status = 'intransit'
  d.progress = 10
  d.speed = randInt(40, 68)
  const hours = round((d.distance || 300) / d.speed, 1)
  d.eta = dayjs().add(Math.round(hours * 60) + 30, 'minute').format('YYYY-MM-DD HH:mm')
  occupyResource(d)
  rollupPlan(d.planId)
  logAction('调度管理', '车辆发车', `调度单 ${d.id} 发车，预计 ${d.eta} 到达`)
}

/** 发车（PC 端入口：RBAC 单点校验 dispatch） */
export function depart(d) {
  const permErr = requireAction('dispatch')
  if (permErr) return permErr
  return doDepart(d)
}

/** 到达核心（状态机流转；PC 端 arrive 与司机端 driverArrive 共用） */
function doArrive(d) {
  if (d.status !== 'intransit') return { error: `调度单 ${d.id} 当前非"在途"状态，无法确认到达` }
  d.status = 'unloading'
  d.progress = 96
  d.speed = 0
  d.eta = dayjs().add(randInt(30, 90), 'minute').format('YYYY-MM-DD HH:mm')
  rollupPlan(d.planId)
  logAction('调度管理', '到达卸货场', `调度单 ${d.id} 到达，开始卸货`)
}

/** 到达（PC 端入口：RBAC 单点校验 dispatch） */
export function arrive(d) {
  const permErr = requireAction('dispatch')
  if (permErr) return permErr
  return doArrive(d)
}

/** 确认卸货核心（unloading → completed，公路车次登记出磅单（含 1.5% 损耗），卸货场站入库，释放资源并回卷；
 *  PC 端 confirmUnload 与司机端 scanConfirmUnload 共用） */
function doConfirmUnload(d) {
  if (d.status !== 'unloading') return { error: `调度单 ${d.id} 当前非"卸货中"状态，无法确认卸货` }
  d.status = 'completed'
  d.unloadTime = dayjs().format('YYYY-MM-DD HH:mm')
  d.progress = 100
  d.speed = 0
  let loss = 0
  let outNet = null
  if (isRoadMode(d.mode)) {
    // P2 出磅基于进磅净重（实际过磅）：运输损耗 1-2%（按进磅净重），出磅 = 进磅 - 损耗
    const inW = db.weighings.find((w) => w.dispatchId === d.id && w.type === '进磅')
    const inBase = inW ? inW.net : d.quantity
    loss = +(inBase * (randInt(10, 20) / 1000)).toFixed(2)
    outNet = +(inBase - loss).toFixed(2)
    pushWeighing(d, '出磅', outNet, d.unloadTime)
    // 环节4：卸货质检（水分/灰分）——结算质量扣重依据
    d.quality = {
      moisture: +(randInt(80, 140) / 10).toFixed(1),
      ash: +(randInt(120, 200) / 10).toFixed(1),
      time: d.unloadTime
    }
  }
  warehouseIn(d)
  releaseResource(d)
  // P1 成本侧闭环：公路车次完成即生成趟次应付（司机趟次费 + 外协车运费），待结算侧付款核销
  doCreateTripPayable(d)
  rollupPlan(d.planId)
  logAction(
    '场站管理',
    '确认卸货',
    isRoadMode(d.mode)
      ? `调度单 ${d.id} 确认卸货（出磅 ${outNet} 吨，损耗 ${loss} 吨）`
      : `调度单 ${d.id} 确认卸货（${d.mode} ${d.unitNo || ''}，${d.quantity} 吨，无磅单损耗）`
  )
}

/** 确认卸货（PC 端入口：RBAC 单点校验 dispatch） */
export function confirmUnload(d) {
  const permErr = requireAction('dispatch')
  if (permErr) return permErr
  return doConfirmUnload(d)
}

/** 取消调度单（RBAC：dispatch）：仅"待装货"（装货前）可取消——车辆故障/客户改期场景
 *  装货前车辆/司机仅被本单占用（status 仍 idle/available，经 BUSY_STATUSES 视为占用），
 *  取消后本单退出 BUSY_STATUSES，车辆/司机即回到可用，无需回滚仓储（装货前未出库）；回卷计划进度 */
export function cancelDispatch(d, reason) {
  const permErr = requireAction('dispatch')
  if (permErr) return permErr
  if (d.status !== 'pending') return { error: `调度单 ${d.id} 当前非"待装货"状态，无法取消（仅装货前可取消）` }
  const r = String(reason || '').trim()
  if (!r) return { error: '请填写取消原因' }
  d.status = 'cancelled'
  d.cancelReason = r
  d.cancelTime = dayjs().format('YYYY-MM-DD HH:mm')
  rollupPlan(d.planId)
  logAction('调度管理', '取消调度单', `调度单 ${d.id} 取消（${r}）`)
  notify(`调度单 ${d.id} 已取消`, 'dispatch', '/dispatch', r, toRoles('dispatch'))
  return { ok: true }
}

/** 改派调度单（RBAC：dispatch）：仅"待装货"（装货前）公路车次可换车/换司机
 *  目标车辆/司机须空闲、年检/驾照未过期且无其他未完结车次（排除本单自身占用）；换司机后需重新接单 */
export function reassignDispatch(d, vehicleId, driverId) {
  const permErr = requireAction('dispatch')
  if (permErr) return permErr
  if (d.status !== 'pending') return { error: `调度单 ${d.id} 当前非"待装货"状态，无法改派（仅装货前可改派）` }
  if (!isRoadMode(d.mode)) return { error: `${d.mode} 车次按运输单元执行，无车辆/司机可改派` }
  const v = db.vehicles.find((x) => x.id === vehicleId)
  const dr = db.drivers.find((x) => x.id === driverId)
  if (!v) return { error: '目标车辆不存在' }
  if (!dr) return { error: '目标司机不存在' }
  if (vehicleInspectionExpired(v)) return { error: `车辆 ${v.plate} 年检过期，不可改派` }
  if (driverLicenseExpired(dr)) return { error: `司机 ${dr.name} 驾照过期，不可改派` }
  const busyV = db.dispatches.some((x) => x.id !== d.id && BUSY_STATUSES.includes(x.status) && x.vehicleId === v.id)
  const busyD = db.dispatches.some((x) => x.id !== d.id && BUSY_STATUSES.includes(x.status) && x.driverId === dr.id)
  if (v.status !== 'idle' || busyV) return { error: `车辆 ${v.plate} 当前不可用（非空闲或有未完结车次）` }
  if (dr.status !== 'available' || busyD) return { error: `司机 ${dr.name} 当前不可用（非空闲或有未完结车次）` }
  d.vehicleId = v.id
  d.driverId = dr.id
  d.accepted = false
  logAction('调度管理', '改派调度单', `调度单 ${d.id} 改派：车辆 → ${v.plate}，司机 → ${dr.name}`)
  notify(`调度单 ${d.id} 已改派`, 'dispatch', '/dispatch', `车辆 ${v.plate} / 司机 ${dr.name}`, toRoles('dispatch'))
  return { ok: true }
}

/** 异常单创建核心（状态机流转 + 异常单 + 事故联动；用户操作与系统事件共用，不做用户权限校验） */
function createException(d, description, type, level, source = '') {
  if (!['pending', 'loading', 'intransit', 'unloading'].includes(d.status)) {
    return { error: `调度单 ${d.id} 当前非执行中状态，无法上报异常` }
  }
  d.status = 'exception'
  d.speed = 0
  const e = {
    id: genId('YC-', 4, db.exceptions),
    dispatchId: d.id,
    type,
    level,
    status: 'pending',
    occurTime: dayjs().format('YYYY-MM-DD HH:mm'),
    handler: '',
    description,
    result: '',
    cost: 0,
    source
  }
  db.exceptions.unshift(e)
  if (type === 'accident') {
    const v = vehicleOf(d.vehicleId)
    const a = {
      id: genId('SG-', 3, db.accidents),
      time: dayjs().format('YYYY-MM-DD'),
      type: '碰撞',
      level: level === 'high' ? '重大' : level === 'medium' ? '较大' : '一般',
      vehicleId: d.vehicleId,
      plate: v ? v.plate : '-',
      location: `调度单 ${d.id} 在途`,
      description,
      handling: '处置中',
      loss: 0,
      status: 'handling',
      exceptionId: e.id
    }
    db.accidents.unshift(a)
    e.accidentId = a.id
  }
  rollupPlan(d.planId)
  logAction('异常处理', '上报异常', `调度单 ${d.id} 上报异常（${type}），生成异常单 ${e.id}${type === 'accident' ? ' 及事故记录 ' + e.accidentId : ''}`)
  notify(`调度单 ${d.id} 上报异常`, 'exception', '/exception', description, toRoles('exception'))
  return e
}

/** 上报异常（用户操作入口：RBAC 单点校验 exception）：→ exception，生成异常单；事故类同步生成事故记录 */
export function reportException(d, description, type = 'other', level = 'medium') {
  const permErr = requireAction('exception')
  if (permErr) return permErr
  return createException(d, description, type, level)
}

/** 恢复运输：exception → intransit(已装货) / loading(未装货)（RBAC：dispatch） */
export function resumeDispatch(d) {
  const permErr = requireAction('dispatch')
  if (permErr) return permErr
  if (d.status !== 'exception') return { error: `调度单 ${d.id} 当前非"异常"状态，无法恢复运输` }
  if (d.loadTime) {
    d.status = 'intransit'
    d.progress = Math.max(10, Math.min(d.progress || 10, 90))
    d.speed = randInt(40, 68)
    d.eta = dayjs().add(4, 'hour').format('YYYY-MM-DD HH:mm')
  } else {
    d.status = 'loading'
    d.progress = 5
  }
  occupyResource(d)
  rollupPlan(d.planId)
  logAction('异常处理', '恢复运输', `调度单 ${d.id} 恢复运输（${d.status === 'intransit' ? '在途' : '装货'}）`)
}

/* ===== 异常处置（受理/处置/关闭） ===== */

/** 受理异常：pending → handling，指派处理人（RBAC：exception） */
export function acceptException(e, handler) {
  const permErr = requireAction('exception')
  if (permErr) return permErr
  e.handler = handler
  e.status = 'handling'
  logAction('异常处理', '受理异常', `异常单 ${e.id} 受理，处理人 ${handler}`)
}

/** 处置完成：填写处置结果与损失金额（RBAC：exception） */
export function finishException(e, result, cost) {
  const permErr = requireAction('exception')
  if (permErr) return permErr
  e.result = result
  e.cost = cost || 0
  if (e.accidentId) {
    const a = db.accidents.find((x) => x.id === e.accidentId)
    if (a) {
      a.handling = result
      a.loss = cost || 0
    }
  }
  logAction('异常处理', '处置完成', `异常单 ${e.id} 处置完成，损失 ${cost || 0} 元`)
}

/** 关闭归档：closed；事故类同步结案并更新车辆状态
 *  结算联动：车次已入账单且损失未计入 → 补扣损失（结算调整），避免"结算后异常才关闭"损失漏扣（RBAC：exception） */
export function closeException(e) {
  const permErr = requireAction('exception')
  if (permErr) return permErr
  e.status = 'closed'
  if (!e.handler) e.handler = '系统'
  if (!e.result) e.result = '已处理完毕'
  if (e.accidentId) {
    const a = db.accidents.find((x) => x.id === e.accidentId)
    if (a) {
      a.status = 'closed'
      a.handling = a.handling || '已结案'
      const v = vehicleOf(a.vehicleId)
      if (v && v.status === 'idle') v.status = 'maintenance'
    }
  }
  if (e.cost > 0 && e.dispatchId && !e.settleApplied) {
    const d = db.dispatches.find((x) => x.id === e.dispatchId)
    const s = d && d.settlementId ? db.settlements.find((x) => x.id === d.settlementId) : null
    if (s) {
      const wasSettled = s.status === 'settled' || s.status === 'overdue'
      s.exceptionLoss = (s.exceptionLoss || 0) + e.cost
      s.totalAmount -= e.cost
      s.adjustments = s.adjustments || []
      s.adjustments.push({
        time: dayjs().format('YYYY-MM-DD HH:mm'),
        reason: `异常单 ${e.id} 关闭，损失补扣${s.invoiceStatus === 'issued' ? '（已开票，需红冲重开）' : ''}${wasSettled ? '（已结算，客户确认失效，须重新对账确认）' : ''}`,
        amount: -e.cost
      })
      // M5 修复：已开票账单补扣 → 发票标记金额陈旧，红冲重开前收款被拦截（强制流程）
      if (s.invoiceStatus === 'issued') markInvoiceStale(s, `异常单 ${e.id} 关闭补扣损失 ${formatMoney(e.cost)}`)
      // P0 修复：已结算/逾期账单补扣后，客户对原金额的确认逻辑上已失效——
      // 账单回"待对账"，清除客户确认与对账快照，须重新对账 + 客户再确认后方可再次结算
      if (wasSettled) {
        s.status = 'pending'
        s.customerConfirmed = null
        s.reconciliation = null
        s.settleDate = null
        notify(
          `账单 ${s.billNo} 补扣后须重新对账确认`,
          'settlement',
          '/settlement',
          `异常单 ${e.id} 关闭补扣 ${formatMoney(e.cost)}，结算金额调整为 ${formatMoney(s.totalAmount)}，客户原确认已失效，请重新对账并由客户确认`,
          toRoles('settlement')
        )
        notify(
          `账单 ${s.billNo} 金额调整，请重新确认对账`,
          'settlement',
          '/portal',
          `异常补扣后结算金额调整为 ${formatMoney(s.totalAmount)}，请重新确认对账结果`,
          toRoles('customer-confirm')
        )
      }
      e.settleApplied = s.id
      logAction(
        '结算管理',
        '结算调整',
        `账单 ${s.billNo} 因异常单 ${e.id} 关闭补扣损失 ${formatMoney(e.cost)}，结算金额调整为 ${formatMoney(s.totalAmount)}${wasSettled ? '，客户确认失效，账单回待对账' : ''}`
      )
    }
  }
  logAction('异常处理', '关闭异常单', `异常单 ${e.id} 关闭归档${e.accidentId ? `，事故 ${e.accidentId} 结案` : ''}`)
  notify(`异常单 ${e.id} 已关闭`, 'exception', '/exception', e.result, toRoles('exception'))
}

/* ===== 安全管理（事故登记 / 培训计划 / 车辆检查） ===== */

/** 事故登记：手工登记事故记录（不一定关联车次异常单，如场外/历史事故补录）（RBAC：safety） */
export function registerAccident(payload) {
  const permErr = requireAction('safety')
  if (permErr) return permErr
  const v = payload.vehicleId ? vehicleOf(payload.vehicleId) : null
  const a = {
    id: genId('SG-', 3, db.accidents),
    time: payload.time,
    type: payload.type,
    level: payload.level,
    vehicleId: v ? v.id : '',
    plate: v ? v.plate : payload.plate || '-',
    location: payload.location || '',
    description: payload.description || '',
    handling: payload.handling || '',
    loss: payload.loss || 0,
    status: payload.status || 'handling'
  }
  db.accidents.unshift(a)
  logAction('安全管理', '事故登记', `事故 ${a.id} 登记（${a.level}·${a.type}，车辆 ${a.plate}，损失 ${formatMoney(a.loss)}）`)
  return a
}

/** 事故结案：handling → closed（独立入口，不依赖异常单关闭）（RBAC：safety） */
export function closeAccident(a) {
  const permErr = requireAction('safety')
  if (permErr) return permErr
  if (a.status !== 'handling') return { error: `事故 ${a.id} 当前非"处理中"状态，无法结案` }
  a.status = 'closed'
  a.handling = a.handling || '已结案'
  logAction('安全管理', '事故结案', `事故 ${a.id} 结案`)
  return { ok: true }
}

/** 培训计划：新建培训（计划中，参训司机待标记完成时记录）（RBAC：safety） */
export function addTraining(payload) {
  const permErr = requireAction('safety')
  if (permErr) return permErr
  if (!payload.title || !payload.title.trim()) return { error: '请填写培训主题' }
  if (!payload.date) return { error: '请选择培训日期' }
  if (dayjs(payload.date).isBefore(dayjs(), 'day')) return { error: '培训日期不能早于今天' }
  const t = {
    id: genId('PX-', 3, db.trainings),
    title: payload.title.trim(),
    date: payload.date,
    trainer: payload.trainer || '',
    participants: 0,
    driverIds: [],
    status: 'scheduled'
  }
  db.trainings.unshift(t)
  logAction('安全管理', '培训计划', `培训 ${t.id} 计划：${t.title}（${t.date}）`)
  return t
}

/** 培训完成：计划中 → 已完成，记录实际参训司机（覆盖率口径按 driverIds 计算）（RBAC：safety） */
export function completeTraining(t, driverIds) {
  const permErr = requireAction('safety')
  if (permErr) return permErr
  if (t.status !== 'scheduled') return { error: `培训 ${t.id} 当前非"计划中"状态，无法标记完成` }
  if (dayjs(t.date).isAfter(dayjs(), 'day')) return { error: `培训 ${t.id} 日期（${t.date}）未到，无法标记完成` }
  t.status = 'completed'
  t.driverIds = driverIds || []
  t.participants = t.driverIds.length
  logAction('安全管理', '培训完成', `培训 ${t.id} 完成，${t.participants} 名司机参训`)
  return { ok: true }
}

/** 车辆检查登记（RBAC：safety） */
export function addInspection(payload) {
  const permErr = requireAction('safety')
  if (permErr) return permErr
  const v = payload.vehicleId ? vehicleOf(payload.vehicleId) : null
  if (!v) return { error: '请选择被检车辆' }
  const i = {
    id: genId('JC-', 3, db.inspections),
    vehicleId: v.id,
    plate: v.plate,
    date: payload.date,
    item: payload.item || '',
    result: payload.result === 'fail' ? 'fail' : 'pass',
    inspector: payload.inspector || '',
    remark: payload.remark || ''
  }
  db.inspections.unshift(i)
  logAction('安全管理', '检查登记', `车辆 ${v.plate} 检查（${i.item}）：${i.result === 'pass' ? '合格' : '不合格'}`)
  return i
}

/** 车辆年检过期（nextInspection 早于今天） */
export function vehicleInspectionExpired(v) {
  return !!v && !!v.nextInspection && dayjs(v.nextInspection).isBefore(dayjs(), 'day')
}

/** 驾照过期（licenseExpire 早于今天） */
export function driverLicenseExpired(d) {
  return !!d && !!d.licenseExpire && dayjs(d.licenseExpire).isBefore(dayjs(), 'day')
}

/** 未完结车次状态（占用车辆/司机，派车互斥口径）
 *  N-2 修复：覆盖全部非终态（含在途/卸货中）——原口径缺 intransit/unloading，
 *  手动指定路径可给在途车辆二次派车（自动匹配路径靠 status==='idle' 兜住，服务层不兜） */
export const BUSY_STATUSES = ['pending', 'loading', 'intransit', 'unloading', 'exception']

/** 资源提交校验（P2：后端事务/乐观锁的等价实现）
 *  选择时快照车辆/司机 version，提交前二次校验：版本一致（期间无其他写操作）且无未完结车次；
 *  任一不满足 → 并发冲突/重复占用，本次派车失败，防止双人同时派车超占 */
export function validateResourceCommit(v, dr, seen) {
  if (!v || !dr) return { error: '车辆或司机不存在' }
  if (v.version !== seen.vVersion) return { error: `车辆 ${v.plate} 已被其他操作占用（并发冲突），请重新派车` }
  if (dr.version !== seen.dVersion) return { error: `司机 ${dr.name} 已被其他操作占用（并发冲突），请重新派车` }
  if (db.dispatches.some((x) => BUSY_STATUSES.includes(x.status) && x.vehicleId === v.id)) {
    return { error: `车辆 ${v.plate} 已有未完结车次，请重新选择` }
  }
  if (db.dispatches.some((x) => BUSY_STATUSES.includes(x.status) && x.driverId === dr.id)) {
    return { error: `司机 ${dr.name} 已有未完结车次，请重新选择` }
  }
  return { ok: true }
}

/** 计划调度：生成 count 张调度单，数量按批次均摊，距离取实际线路
 *  公路/多式联运 → 匹配车辆+司机；铁路/水运/管道 → 按运输单元派车（车号/船名/管段），不占车辆司机
 *  守卫：RBAC（dispatch）；合同已终止不可再派车；车辆/司机排除已有未完结车次（待装货/装货中/异常）者，防重复占用；
 *  年检/驾照过期拦截：自动匹配排除年检过期车辆与驾照过期司机，手动指定年检过期车辆直接报错；
 *  事务化（P0）：全成或全滚——先校验资源充足性（count ≤ 空闲车辆数 且 ≤ 空闲司机数），
 *  不足则整体失败（created 为空、计划状态不变）；再两阶段提交（构建+校验全部 → 统一落库），
 *  杜绝旧实现"第 M 张失败时前 M-1 张残留、计划状态不更新"的半套调度单；
 *  乐观锁：提交前 validateResourceCommit 二次校验（版本+占用），防并发超占 */
export function createDispatches(p, count, vehicleIds = []) {
  const permErr = requireAction('dispatch')
  if (permErr) return { created: [], error: permErr.error }
  const c = contractOf(p.contractId)
  if (c && c.status === 'terminated') return { created: [], error: '合同已终止，不能再下发调度单' }
  const route = ROUTES.find((r) => r.from === p.loadTerminalId && r.to === p.unloadTerminalId)
  const per = Math.max(1, Math.round(p.quantity / count))
  const road = isRoadMode(p.mode)
  const created = []
  if (road) {
    const busyV = new Set(db.dispatches.filter((x) => BUSY_STATUSES.includes(x.status)).map((x) => x.vehicleId))
    const busyD = new Set(db.dispatches.filter((x) => BUSY_STATUSES.includes(x.status)).map((x) => x.driverId))
    // 手动指定：年检过期车辆硬拦截（明确报错，避免静默少派车）
    if (vehicleIds.length) {
      const expiredSel = db.vehicles.filter((v) => vehicleIds.includes(v.id) && vehicleInspectionExpired(v))
      if (expiredSel.length) {
        return { created, error: `年检过期车辆不可派车：${expiredSel.map((v) => v.plate).join('、')}` }
      }
    }
    const pool = vehicleIds.length
      ? db.vehicles.filter((v) => v.type !== '铁路敞车' && v.type !== '散货船' && vehicleIds.includes(v.id) && !busyV.has(v.id))
      : db.vehicles.filter((v) => v.type !== '铁路敞车' && v.type !== '散货船' && v.status === 'idle' && !vehicleInspectionExpired(v) && !busyV.has(v.id))
    const avail = db.drivers.filter((x) => x.status === 'available' && !driverLicenseExpired(x) && !busyD.has(x.id))
    if (!pool.length || !avail.length) {
      const reasons = []
      if (!pool.length) reasons.push('无可用车辆（须空闲、年检未过期且无未完结车次）')
      if (!avail.length) reasons.push('无可用司机（须空闲、驾照未过期且无未完结车次）')
      return { created, error: reasons.join('；') }
    }
    // 事务化（P0）：每张调度单需一辆互不重复的空闲车辆与一名空闲司机；
    // 资源不足则整体失败（created 为空、计划状态不变），杜绝"半套"调度单残留
    if (count > pool.length || count > avail.length) {
      const reasons = []
      if (count > pool.length) reasons.push(`可用车辆不足（需 ${count} 辆，仅 ${pool.length} 辆空闲）`)
      if (count > avail.length) reasons.push(`可用司机不足（需 ${count} 名，仅 ${avail.length} 名空闲）`)
      return { created, error: reasons.join('；') }
    }
    // 两阶段提交：先构建并校验全部调度单（不落库），任一失败整体回退；全部通过再统一落库
    let pdSeq = 0
    const pdRe = /^PD-(\d+)$/
    for (const x of db.dispatches) {
      const m = pdRe.exec(String(x.id || ''))
      if (m) pdSeq = Math.max(pdSeq, parseInt(m[1], 10))
    }
    const pending = []
    for (let i = 0; i < count; i++) {
      const v = pool[i]
      const dr = avail[i]
      // 乐观锁：选择时快照版本，提交前二次校验（后端事务等价）
      const seen = { vVersion: v.version || 1, dVersion: dr.version || 1 }
      const commitErr = validateResourceCommit(v, dr, seen)
      if (commitErr && commitErr.error) return { created, error: commitErr.error }
      const id = 'PD-' + String(pdSeq + i + 1).padStart(5, '0')
      pending.push({
        id,
        planId: p.id,
        contractId: p.contractId,
        commodityId: p.commodityId,
        quantity: per,
        mode: p.mode,
        loadTerminalId: p.loadTerminalId,
        unloadTerminalId: p.unloadTerminalId,
        vehicleId: v.id,
        driverId: dr.id,
        unitNo: p.mode === '多式联运' ? unitNoOf('多式联运', id) : '',
        distance: route ? route.distance : 300,
        status: 'pending',
        accepted: false,
        dispatchTime: dayjs().format('YYYY-MM-DD HH:mm'),
        loadTime: null,
        unloadTime: null,
        progress: 0,
        speed: 0,
        eta: dayjs().add(8, 'hour').format('YYYY-MM-DD HH:mm'),
        fee: Math.round(per * p.unitPrice),
        unitPrice: p.unitPrice
      })
    }
    // 提交：统一落库（保持"最新在前"顺序），计划状态随之更新
    for (const d of pending) db.dispatches.unshift(d)
    created.push(...pending)
  } else {
    for (let i = 0; i < count; i++) {
      const id = genId('PD-', 5, db.dispatches)
      const d = {
        id,
        planId: p.id,
        contractId: p.contractId,
        commodityId: p.commodityId,
        quantity: per,
        mode: p.mode,
        loadTerminalId: p.loadTerminalId,
        unloadTerminalId: p.unloadTerminalId,
        vehicleId: null,
        driverId: null,
        unitNo: unitNoOf(p.mode, id),
        distance: route ? route.distance : 300,
        status: 'pending',
        accepted: false,
        dispatchTime: dayjs().format('YYYY-MM-DD HH:mm'),
        loadTime: null,
        unloadTime: null,
        progress: 0,
        speed: 0,
        eta: dayjs().add(8, 'hour').format('YYYY-MM-DD HH:mm'),
        fee: Math.round(per * p.unitPrice),
        unitPrice: p.unitPrice
      }
      db.dispatches.unshift(d)
      created.push(d)
    }
  }
  p.status = 'dispatched'
  logAction(
    '调度管理',
    '下发调度单',
    `计划 ${p.id} 生成 ${created.length} 张调度单（${p.mode}${road ? '' : '，按运输单元执行' }）`
  )
  if (created.length) notify(`计划 ${p.id} 下发 ${created.length} 张调度单`, 'dispatch', '/dispatch', '', toRoles('dispatch'))
  return { created }
}

/* ========== 结算流转 ========== */

/** 对账容差（吨）：结算量与磅单净重差值超过该值视为数据不一致 */
const RECONCILE_TOLERANCE = 0.5

/** 单车结算量：按磅结算，取出磅净重；无出磅单时回退调度量 */
function settleQtyOf(d) {
  const w = db.weighings.find((x) => x.dispatchId === d.id && x.type === '出磅')
  return w ? w.net : d.quantity
}

/** 单车次结算运费（收入口径）：出磅净重 × 快照单价（与结算 freight 同口径，按出磅净重而非调度量）
 *  P2 报表口径对齐：成本利润报表收入改用此口径，与结算一致 */
export function dispatchRevenueOf(d) {
  const c = contractOf(d.contractId)
  const price = d.unitPrice != null ? d.unitPrice : c ? c.unitPrice : 0
  return Math.round(settleQtyOf(d) * price)
}

/** 环节4：质量扣重口径（大宗按质结算）——标准水分 10% / 标准灰分 15%；
 *  水分每超标准 1% 按出磅净重扣 1.5%，灰分每超标准 1% 扣 1%（煤炭行业常用扣减系数，演示口径） */
export const QUALITY_STANDARD = { moisture: 10, ash: 15 }
export const QUALITY_RATE = { moisture: 0.015, ash: 0.01 }

/** 质量扣重吨数：按出磅净重对水分/灰分超标部分比例扣减；无质检记录（非公路/未质检）= 0 */
export function qualityDeductionQty(d) {
  if (!d || !d.quality) return 0
  const net = settleQtyOf(d)
  const over =
    Math.max(0, d.quality.moisture - QUALITY_STANDARD.moisture) * QUALITY_RATE.moisture +
    Math.max(0, d.quality.ash - QUALITY_STANDARD.ash) * QUALITY_RATE.ash
  return +(net * over).toFixed(2)
}

/** 结算费用计算：按出磅净重结算，损耗/质量扣重/已关闭异常损失作为扣减项
 *  单价口径：按车次派车时快照单价（d.unitPrice）逐车次计算，合同改价不追溯已派车车次；
 *  无快照价（历史数据）回退合同当前单价
 *  环节4：质量扣重（水分/灰分超标按出磅净重比例扣减，qualityDeductionQty）作为独立扣减项 */
export function calcSettlementFees(contract, dispatches) {
  const fallbackPrice = contract ? contract.unitPrice : 0
  const priceOf = (d) => (d.unitPrice != null ? d.unitPrice : fallbackPrice)
  const dispatchQuantity = dispatches.reduce((s, d) => s + d.quantity, 0)
  const totalQuantity = +dispatches.reduce((s, d) => s + settleQtyOf(d), 0).toFixed(2)
  const lossQty = +(dispatchQuantity - totalQuantity).toFixed(2)
  const freight = Math.round(dispatches.reduce((s, d) => s + settleQtyOf(d) * priceOf(d), 0))
  const loadingFee = Math.round(totalQuantity * 8)
  const unloadingFee = Math.round(totalQuantity * 6)
  const lossDeduction = Math.round(dispatches.reduce((s, d) => s + (d.quantity - settleQtyOf(d)) * priceOf(d), 0))
  const qualityQty = +dispatches.reduce((s, d) => s + qualityDeductionQty(d), 0).toFixed(2)
  const qualityDeduction = Math.round(dispatches.reduce((s, d) => s + qualityDeductionQty(d) * priceOf(d), 0))
  const exceptionLoss = dispatches.reduce(
    (sum, d) =>
      sum +
      db.exceptions
        .filter((e) => e.dispatchId === d.id && e.status === 'closed')
        .reduce((s, e) => s + (e.cost || 0), 0),
    0
  )
  return {
    dispatchQuantity,
    totalQuantity,
    lossQty,
    freight,
    loadingFee,
    unloadingFee,
    lossDeduction,
    qualityQty,
    qualityDeduction,
    exceptionLoss
  }
}

/** 结算候选：已完成且未入账单的调度单，按 合同+月份(卸货时间) 聚合 */
export function settlementCandidates() {
  const groups = new Map()
  for (const d of db.dispatches) {
    if (d.status !== 'completed' || d.settled) continue
    const period = d.unloadTime ? dayjs(d.unloadTime).format('YYYY-MM') : dayjs(NOW).format('YYYY-MM')
    const key = `${d.contractId}|${period}`
    if (!groups.has(key)) {
      const c = contractOf(d.contractId)
      groups.set(key, { key, contractId: d.contractId, customerId: c ? c.shipperId : '', period, dispatches: [] })
    }
    groups.get(key).dispatches.push(d)
  }
  return [...groups.values()].map((g) => {
    const quantity = g.dispatches.reduce((s, d) => s + d.quantity, 0)
    const c = contractOf(g.contractId)
    // M1 修复：预览运费与实际账单同口径（calcSettlementFees：车次快照单价 × 出磅净重）；
    // 原口径"合同当前单价 × 调度量"在合同改价后预览额 ≠ 实际账单额
    const freight = calcSettlementFees(c, g.dispatches).freight
    return { ...g, dispatchCount: g.dispatches.length, quantity, freight }
  })
}

/** 生成结算单核心（聚合候选 → 账单，标记车次已入账单；用户操作与合同终止联动共用） */
function doGenerateSettlements(keys) {
  const created = []
  for (const g of settlementCandidates().filter((x) => keys.includes(x.key))) {
    const c = contractOf(g.contractId)
    const fees = calcSettlementFees(c, g.dispatches)
    const tollFee = randInt(2000, 20000)
    const surcharge = randInt(0, 8000)
    const id = genId('JS-', 4, db.settlements)
    const s = {
      id,
      // 账单号与结算单号同源（取 ID 序列），删除后不复用
      billNo: `BL-${g.period.replace('-', '')}-${id.slice(-3)}`,
      contractId: g.contractId,
      customerId: c ? c.shipperId : '',
      period: g.period,
      dispatchCount: g.dispatchCount,
      ...fees,
      tollFee,
      surcharge,
      totalAmount:
        fees.freight +
        fees.loadingFee +
        fees.unloadingFee +
        tollFee +
        surcharge -
        fees.lossDeduction -
        fees.qualityDeduction -
        fees.exceptionLoss,
      paidAmount: 0,
      status: 'pending',
      settleDate: null,
      invoiceStatus: 'not-issued',
      reconciliation: null,
      remark: ''
    }
    db.settlements.unshift(s)
    for (const d of g.dispatches) {
      d.settled = true
      d.settlementId = s.id
      // 已关闭异常损失已在账单中计入，标记防止 closeException 重复补扣
      for (const e of db.exceptions.filter((x) => x.dispatchId === d.id && x.status === 'closed')) e.settleApplied = s.id
    }
    created.push(s)
  }
  if (created.length) {
    logAction('结算管理', '生成结算单', `生成 ${created.length} 张结算单（${created.map((s) => s.billNo).join('、')}）`)
    notify(`生成 ${created.length} 张结算单`, 'settlement', '/settlement', created.map((s) => s.billNo).join('、'), toRoles('settlement'))
  }
  return created
}

/** 生成结算单（用户操作入口：RBAC 单点校验 settlement） */
export function generateSettlements(keys) {
  const permErr = requireAction('settlement')
  if (permErr) return { error: permErr.error }
  return doGenerateSettlements(keys)
}

/** 对账三方比对：调度量 vs 磅单净重(进/出) vs 结算量；差异=调度量-进磅净重(装货差异)，损耗=调度量-结算量 */
export function buildReconciliation(s, date) {
  const c = contractOf(s.contractId)
  // M2 修复：差异/损耗金额逐车次按快照单价折算（与结算口径一致）；
  // 原口径整单用"合同当前单价"，合同改价后对账金额失真
  const priceOf = (d) => (d.unitPrice != null ? d.unitPrice : c ? c.unitPrice : 0)
  const items = db.dispatches
    .filter((d) => d.settlementId === s.id)
    .map((d) => {
      const ws = db.weighings.filter((w) => w.dispatchId === d.id)
      const inNet = ws.find((w) => w.type === '进磅')?.net ?? null
      const outNet = ws.find((w) => w.type === '出磅')?.net ?? null
      const settleQty = settleQtyOf(d)
      // P2 进磅实际过磅：差异 = 调度量 - 进磅净重（装货差异：下单量 vs 实际装货过磅量）；无进磅单（非公路）= 0
      const diff = inNet != null ? +(d.quantity - inNet).toFixed(2) : 0
      return {
        dispatchId: d.id,
        plate: vehicleOf(d.vehicleId)?.plate || d.unitNo || '-',
        dispatchQty: d.quantity,
        inNet,
        outNet,
        settleQty,
        loss: +(d.quantity - settleQty).toFixed(2),
        // 环节4：质量扣重（水分/灰分超标按出磅净重比例扣减，结算扣减项）
        qualityQty: qualityDeductionQty(d),
        diff,
        price: priceOf(d),
        // 签收状态：公路车次须有电子签收单（收货凭证）；非公路按运输单元执行，无签收（null=不适用）
        hasReceipt: isRoadMode(d.mode) ? !!d.receipt : null,
        status: Math.abs(diff) > RECONCILE_TOLERANCE ? 'diff' : 'match'
      }
    })
  const diffItems = items.filter((i) => i.status === 'diff')
  const diffQty = +diffItems.reduce((sum, i) => sum + i.diff, 0).toFixed(2)
  const lossQty = +items.reduce((sum, i) => sum + i.loss, 0).toFixed(2)
  const qualityQty = +items.reduce((sum, i) => sum + i.qualityQty, 0).toFixed(2)
  const missingReceipt = items.filter((i) => i.hasReceipt === false)
  s.reconciliation = {
    date: date || dayjs().format('YYYY-MM-DD HH:mm'),
    items,
    diffCount: diffItems.length,
    diffQty,
    diffAmount: Math.round(diffItems.reduce((sum, i) => sum + Math.abs(i.diff) * i.price, 0)),
    lossQty,
    lossAmount: Math.round(items.reduce((sum, i) => sum + i.loss * i.price, 0)),
    qualityQty,
    qualityAmount: Math.round(items.reduce((sum, i) => sum + i.qualityQty * i.price, 0)),
    missingReceiptCount: missingReceipt.length,
    missingReceiptIds: missingReceipt.map((i) => i.dispatchId)
  }
  return s.reconciliation
}

/** 发起对账：执行三方比对并进入"对账中"（RBAC：settlement） */
export function startReconcile(s) {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  buildReconciliation(s)
  s.status = 'reconciling'
  logAction('结算管理', '发起对账', `账单 ${s.billNo} 三方比对完成，${s.reconciliation.diffCount} 车次不一致，损耗 ${s.reconciliation.lossQty} 吨`)
  return s.reconciliation
}

/** 重算结算单（仅"待对账"账单）：按当前磅单与已关闭异常重算费用，差异记入调整记录
 *  适用场景：生成账单后磅单补录/异常损失变化，对账前刷新金额 */
export function recalcSettlement(s) {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  if (s.status !== 'pending') return { error: `账单 ${s.billNo} 当前非"待对账"状态，无法重算` }
  const c = contractOf(s.contractId)
  const ds = db.dispatches.filter((d) => d.settlementId === s.id)
  if (!ds.length) return { error: `账单 ${s.billNo} 下无车次，无法重算` }
  const fees = calcSettlementFees(c, ds)
  const oldTotal = s.totalAmount
  Object.assign(s, fees)
  s.totalAmount =
    fees.freight +
    fees.loadingFee +
    fees.unloadingFee +
    (s.tollFee || 0) +
    (s.surcharge || 0) -
    fees.lossDeduction -
    fees.qualityDeduction -
    fees.exceptionLoss
  const delta = s.totalAmount - oldTotal
  if (delta !== 0) {
    s.adjustments = s.adjustments || []
    s.adjustments.push({ time: dayjs().format('YYYY-MM-DD HH:mm'), reason: '重算结算（磅单/异常口径刷新）', amount: delta })
    logAction(
      '结算管理',
      '重算结算',
      `账单 ${s.billNo} 重算：结算金额 ${formatMoney(oldTotal)} → ${formatMoney(s.totalAmount)}（${delta > 0 ? '+' : ''}${formatMoney(delta)}）`
    )
    // M5 修复：已开票账单重算导致金额变化 → 发票标记金额陈旧
    if (s.invoiceStatus === 'issued') markInvoiceStale(s, '重算结算，账单金额变化')
  }
  return { ok: true, delta }
}

/** 逾期规则：已结算且超账期未付清 → 逾期；逾期账单付清 → 回到已结算 */
export function recalcSettlementStatus(s) {
  if (s.status !== 'settled' && s.status !== 'overdue') return
  const c = contractOf(s.contractId)
  const due = s.settleDate ? dayjs(s.settleDate).add(c ? c.paymentDays || 30 : 30, 'day') : null
  const unpaid = s.totalAmount - s.paidAmount > 0
  s.status = due && unpaid && dayjs().isAfter(due) ? 'overdue' : 'settled'
}

/** 确认结算：对账中 → 已结算，进入收款（账期由合同约定）
 *  保留预付款：不清零已累积的 paidAmount（对账前已收预付），与收款流水保持一致
 *  客户确认闸门：须客户已在门户确认对账结果（customerConfirmed），未确认不可结算
 *  环节1 签收硬拦截：公路车次以电子签收单为收货依据，存在未签收公路车次不可确认结算
 *  （非公路豁免：铁路/水运/管道按运输单元执行，无签收凭证；漏签车次经"补签"补齐后放行） */
export function confirmSettle(s) {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  if (s.status !== 'reconciling') return { error: `账单 ${s.billNo} 当前非"对账中"状态，无法确认结算` }
  if (!s.customerConfirmed) {
    return { error: `客户尚未确认账单 ${s.billNo} 的对账结果，请先由客户在客户门户确认对账后再确认结算` }
  }
  const missing = db.dispatches.filter((d) => d.settlementId === s.id && isRoadMode(d.mode) && !d.receipt)
  if (missing.length) {
    return {
      error: `${missing.length} 车次公路车次尚无电子签收单（收货凭证）：${missing.map((d) => d.id).join('、')}。签收是结算的收货依据，请先在调度单详情"补签"补齐签收后再确认结算`
    }
  }
  s.status = 'settled'
  s.settleDate = dayjs().format('YYYY-MM-DD')
  logAction('结算管理', '确认结算', `账单 ${s.billNo} 结算金额 ${formatMoney(s.totalAmount)}，累计已付 ${formatMoney(s.paidAmount)}`)
  notify(`账单 ${s.billNo} 已确认结算`, 'settlement', '/settlement', `结算金额 ${formatMoney(s.totalAmount)}，进入收款`, toRoles('settlement'))
}

/** 登记收款：写入收款流水并更新已付金额，超收按未付余额截断（RBAC：settlement）
 *  M5 修复：存在"金额陈旧"发票（已开票但账单额已变化）时拦截收款——须先红冲重开，保证票款一致 */
export function recordPayment(s, amount, method) {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  const staleInv = db.invoices.find((i) => i.settlementId === s.id && i.status === 'issued' && i.stale)
  if (staleInv) {
    return { error: `发票 ${staleInv.invoiceNo} 金额与账单金额不一致（${staleInv.staleReason}），请先红冲重开发票后再登记收款` }
  }
  const real = Math.min(amount, s.totalAmount - s.paidAmount)
  db.payments.unshift({
    id: genId('SK-', 4, db.payments),
    settlementId: s.id,
    amount: real,
    payTime: dayjs().format('YYYY-MM-DD HH:mm'),
    method,
    remark: real >= s.totalAmount - s.paidAmount ? '付清' : '部分收款'
  })
  s.paidAmount += real
  recalcSettlementStatus(s)
  logAction('结算管理', '登记收款', `账单 ${s.billNo} 收款 ${formatMoney(real)}（${method}）`)
  notify(`账单 ${s.billNo} 收款到账`, 'settlement', '/settlement', `${method} ${formatMoney(real)}`, toRoles('settlement'))
  return real
}

/** 收款冲正/退款（RBAC：settlement）：撤销一笔误登记收款，回退已付金额并释放对应预付款占用
 *  守卫：账单须处于"已结算/逾期"；流水须属于该账单且未冲正过；冲正金额不超过当前已付
 *  联动：预付款抵扣流水冲正时按 prepayUsed 回退对应预付款占用（p.used）；冲正不影响发票金额（发票按账单总额开具），无需红冲
 *  留痕：流水标记 reversed/revertTime/revertReason，审计日志 + 消息通知 */
export function revertPayment(s, paymentId, reason = '') {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  if (!['settled', 'overdue'].includes(s.status)) {
    return { error: `账单 ${s.billNo} 当前非"已结算/逾期"状态，不可冲正收款` }
  }
  const p = db.payments.find((x) => x.id === paymentId && x.settlementId === s.id)
  if (!p) return { error: '收款流水不存在或不属于该账单' }
  if (p.reversed) return { error: `流水 ${p.id} 已冲正，不可重复操作` }
  if (p.amount > s.paidAmount) return { error: '冲正金额超过当前已付金额，数据异常' }
  p.reversed = true
  p.revertTime = dayjs().format('YYYY-MM-DD HH:mm')
  p.revertReason = reason.trim() || '误登记冲正'
  s.paidAmount -= p.amount
  if (p.prepayUsed) {
    for (const [prepayId, amt] of Object.entries(p.prepayUsed)) {
      const pp = db.prepayments.find((x) => x.id === prepayId)
      if (pp) pp.used = Math.max(0, pp.used - amt)
    }
  }
  recalcSettlementStatus(s)
  logAction('结算管理', '收款冲正', `账单 ${s.billNo} 冲正流水 ${p.id} ${formatMoney(p.amount)}（${p.method}），原因：${p.revertReason}`)
  notify(`账单 ${s.billNo} 收款冲正 ${formatMoney(p.amount)}`, 'settlement', '/settlement', `原因：${p.revertReason}`, toRoles('settlement'))
  return { ok: true, amount: p.amount }
}

/** 催收/催款（RBAC：settlement）：对未付清账单（已结算/逾期）发起催收，留痕并提醒客户
 *  level：reminder 付款提醒 / formal 正式催收 / legal 法务函；formal、legal 仅逾期账单
 *  每账单按轮次递增，形成催收工作流（提醒 → 正式催收 → 法务函） */
export function dunning(s, level) {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  if (!['settled', 'overdue'].includes(s.status)) return { error: `账单 ${s.billNo} 当前非"已结算/逾期"状态，无法催收` }
  const unpaid = s.totalAmount - s.paidAmount
  if (unpaid <= 0) return { error: `账单 ${s.billNo} 已付清，无需催收` }
  const levelMap = { reminder: '付款提醒', formal: '正式催收', legal: '法务函' }
  if (!levelMap[level]) return { error: `无效催收级别：${level}` }
  if ((level === 'formal' || level === 'legal') && s.status !== 'overdue') {
    return { error: `正式催收/法务函仅适用于逾期账单（当前为"已结算"，可先发起付款提醒）` }
  }
  const round = db.dunnings.filter((x) => x.settlementId === s.id).length + 1
  const d = {
    id: genId('CJ-', 4, db.dunnings),
    settlementId: s.id,
    billNo: s.billNo,
    round,
    level,
    levelName: levelMap[level],
    time: dayjs().format('YYYY-MM-DD HH:mm'),
    content: `${levelMap[level]}：账单 ${s.billNo} 未付余额 ${formatMoney(unpaid)}，请尽快安排付款`,
    by: operator.name
  }
  db.dunnings.unshift(d)
  logAction('结算管理', '催收', `账单 ${s.billNo} 第 ${round} 轮${levelMap[level]}（未付 ${formatMoney(unpaid)}）`)
  notify(`账单 ${s.billNo} ${levelMap[level]}`, 'settlement', '/portal', `未付余额 ${formatMoney(unpaid)}，请尽快安排付款（第 ${round} 轮）`, toRoles('customer-confirm'))
  return { ok: true, round }
}

/** 客户未付余额（全部账单未付部分之和） */
export function outstandingOf(customerId) {
  return db.settlements
    .filter((s) => s.customerId === customerId)
    .reduce((sum, s) => sum + Math.max(0, s.totalAmount - s.paidAmount), 0)
}

/* ===== 环节5：预付款管理（收取 / 抵扣台账，信用占用联动） ===== */

/** 客户预付款台账（按收取时间倒序） */
export function prepaymentOf(customerId) {
  return db.prepayments.filter((p) => p.customerId === customerId)
}

/** 客户可用预付款（已收 - 已抵扣） */
export function prepaymentAvailable(customerId) {
  return prepaymentOf(customerId).reduce((s, p) => s + (p.amount - p.used), 0)
}

/** 收取预付款（RBAC：settlement）：客户预付货款入台账，可用于账单抵扣并冲减信用占用
 *  守卫：客户存在且未冻结；金额须大于 0 */
export function collectPrepayment(customerId, amount, method, remark = '') {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  const c = db.customers.find((x) => x.id === customerId)
  if (!c) return { error: '客户不存在' }
  if (c.status === 'frozen') return { error: `客户 ${c.name} 已冻结，不可收取预付款` }
  if (!amount || amount <= 0) return { error: '预付款金额须大于 0' }
  const p = {
    id: genId('YF-', 4, db.prepayments),
    customerId,
    amount: Math.round(amount),
    used: 0,
    time: dayjs().format('YYYY-MM-DD HH:mm'),
    method: method || '银行转账',
    remark: remark || ''
  }
  db.prepayments.unshift(p)
  logAction('结算管理', '收取预付款', `收取 ${c.name} 预付款 ${formatMoney(p.amount)}（${p.method}），当前可用 ${formatMoney(prepaymentAvailable(customerId))}`)
  notify(`收取预付款 ${formatMoney(p.amount)}`, 'settlement', '/customer/' + customerId, `${c.name} 预付款到账（${p.method}）`, toRoles('settlement'))
  return { ok: true, id: p.id }
}

/** 预付款抵扣（RBAC：settlement）：按 FIFO 从可用预付款抵扣账单未付余额，记入收款流水
 *  与 recordPayment 同口径：仅"已结算/逾期"且存在未付余额的账单；存在"金额陈旧"发票时拦截（票款一致）；
 *  超额按 min(抵扣额, 未付余额, 可用预付款) 截断 */
export function applyPrepayment(s, amount) {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  if (!['settled', 'overdue'].includes(s.status)) {
    return { error: `账单 ${s.billNo} 当前非"已结算/逾期"状态，不可抵扣预付款` }
  }
  const staleInv = db.invoices.find((i) => i.settlementId === s.id && i.status === 'issued' && i.stale)
  if (staleInv) {
    return { error: `发票 ${staleInv.invoiceNo} 金额与账单金额不一致（${staleInv.staleReason}），请先红冲重开后再抵扣` }
  }
  const unpaid = s.totalAmount - s.paidAmount
  if (unpaid <= 0) return { error: `账单 ${s.billNo} 无未付余额，无需抵扣` }
  const available = prepaymentAvailable(s.customerId)
  if (available <= 0) return { error: '该客户无可用预付款，请先收取预付款' }
  const real = Math.min(Math.round(amount) || 0, unpaid, available)
  if (real <= 0) return { error: '抵扣金额须大于 0' }
  // FIFO：按收取时间先后依次抵扣
  let rest = real
  const usedIds = []
  const usedMap = {}
  for (const p of [...prepaymentOf(s.customerId)].sort((a, b) => (a.time < b.time ? -1 : 1))) {
    if (rest <= 0) break
    const avail = p.amount - p.used
    if (avail <= 0) continue
    const x = Math.min(avail, rest)
    p.used += x
    rest -= x
    usedIds.push(p.id)
    usedMap[p.id] = x
  }
  db.payments.unshift({
    id: genId('SK-', 4, db.payments),
    settlementId: s.id,
    amount: real,
    payTime: dayjs().format('YYYY-MM-DD HH:mm'),
    method: '预付款抵扣',
    remark: `预付款抵扣（${usedIds.join('、')}）`,
    prepayUsed: usedMap // 冲正时按此回退对应预付款占用
  })
  s.paidAmount += real
  recalcSettlementStatus(s)
  logAction('结算管理', '预付款抵扣', `账单 ${s.billNo} 预付款抵扣 ${formatMoney(real)}（${usedIds.join('、')}），剩余未付 ${formatMoney(s.totalAmount - s.paidAmount)}`)
  notify(`账单 ${s.billNo} 预付款抵扣 ${formatMoney(real)}`, 'settlement', '/settlement', `剩余未付 ${formatMoney(s.totalAmount - s.paidAmount)}`, toRoles('settlement'))
  return { ok: true, amount: real }
}

/** 信用校验：（未付余额 - 可用预付款）+ 新订单金额 vs 客户授信额度
 *  环节5：预付款为客户预付货款，冲减信用占用（超额预付可覆盖新订单） */
export function creditCheck(customerId, orderAmount) {
  const c = db.customers.find((x) => x.id === customerId)
  if (!c) return { ok: true, message: '' }
  const outstanding = outstandingOf(customerId)
  const prepay = prepaymentAvailable(customerId)
  const occupied = Math.max(0, outstanding - prepay)
  const total = occupied + orderAmount
  if (total > c.creditLimit) {
    return {
      ok: false,
      message: `${c.name} 信用占用 ${formatMoney(occupied)}（未付 ${formatMoney(outstanding)} - 预付 ${formatMoney(prepay)}）+ 本单 ${formatMoney(orderAmount)} = ${formatMoney(total)}，超出授信额度 ${formatMoney(c.creditLimit)}`
    }
  }
  return { ok: true, message: '' }
}

/** 合同剩余可计划量：合同总量 - 未取消计划批次量之和（新建计划校验用） */
export function contractRemaining(contractId) {
  const c = contractOf(contractId)
  if (!c) return 0
  const planned = db.plans
    .filter((p) => p.contractId === contractId && p.status !== 'cancelled')
    .reduce((s, p) => s + p.quantity, 0)
  return Math.max(0, c.quantity - planned)
}

/** 客户确认对账：客户门户确认账单对账结果（须"对账中"且未确认过）
 *  不改账单状态（结算确认仍由结算专员执行），结果记 customerConfirmed 并审计
 *  环节2：重新对账后客户再次确认时，关闭历史异议单（resolved） */
export function customerConfirm(s) {
  const permErr = requireAction('customer-confirm')
  if (permErr) return permErr
  if (!s.reconciliation) return { error: `账单 ${s.billNo} 尚无对账结果，无法确认` }
  if (s.status !== 'reconciling') return { error: `账单 ${s.billNo} 当前非"对账中"状态，无法确认对账（异议后须先重新对账）` }
  if (s.customerConfirmed) return { error: `账单 ${s.billNo} 客户已确认过，无需重复确认` }
  s.customerConfirmed = { time: dayjs().format('YYYY-MM-DD HH:mm'), comment: '对账结果确认，无异议' }
  for (const o of s.objections || []) {
    if (o.status === 'open') {
      o.status = 'resolved'
      o.resolveTime = dayjs().format('YYYY-MM-DD HH:mm')
    }
  }
  logAction('客户门户', '确认对账', `客户确认账单 ${s.billNo} 对账结果（差异 ${s.reconciliation.diffCount} 车次，损耗 ${s.reconciliation.lossQty} 吨）`)
  notify(`客户已确认对账结果`, 'settlement', '/settlement', `账单 ${s.billNo} 客户已确认，可确认结算`, toRoles('settlement'))
  return { ok: true }
}

/** 环节2：客户异议——客户门户对对账结果（差异/损耗/签收等）提交异议单
 *  触发重新对账：账单回到"待对账"并清除客户确认标记，结算侧须重新 startReconcile，
 *  结果生成后客户再确认（确认时异议单自动关闭）；已确认的账单不可撤销，不可再异议 */
export function customerObjection(s, reason) {
  const permErr = requireAction('customer-confirm')
  if (permErr) return permErr
  if (!s.reconciliation) return { error: `账单 ${s.billNo} 尚无对账结果，无法提出异议` }
  if (s.status !== 'reconciling') return { error: `账单 ${s.billNo} 当前非"对账中"状态，无法提出异议` }
  if (s.customerConfirmed) return { error: `账单 ${s.billNo} 客户已确认，不可再提出异议` }
  const text = String(reason || '').trim() || '未填写具体原因'
  s.objections = s.objections || []
  s.objections.push({ time: dayjs().format('YYYY-MM-DD HH:mm'), reason: text, status: 'open' })
  s.status = 'pending'
  s.customerConfirmed = null
  logAction('客户门户', '对账异议', `客户对账单 ${s.billNo} 对账结果提出异议：${text}`)
  notify(`客户对账单 ${s.billNo} 提出异议`, 'settlement', '/settlement', text, toRoles('settlement'))
  return { ok: true }
}

/* ===== 客户运输需求（门户发起 → 合同草稿） ===== */

/** 客户发起运输需求（门户）：生成待处理需求单，由销售在合同管理转为合同草稿（RBAC：customer-request） */
export function submitTransportRequest(customerId, payload) {
  const permErr = requireAction('customer-request')
  if (permErr) return permErr
  const c = db.customers.find((x) => x.id === customerId)
  if (!c) return { error: '当前账号未绑定客户，无法发起运输需求' }
  if (c.status === 'frozen') return { error: `客户 ${c.name} 已冻结，无法发起运输需求` }
  if (!payload.commodityId || !payload.loadTerminalId || !payload.unloadTerminalId || !payload.consigneeId) {
    return { error: '请完整填写商品、装/卸货场站与收货方' }
  }
  if (!payload.quantity || payload.quantity <= 0) return { error: '计划数量须大于 0' }
  const r = {
    id: genId('YS-', 4, db.transportRequests),
    customerId: c.id,
    consigneeId: payload.consigneeId,
    commodityId: payload.commodityId,
    quantity: payload.quantity,
    loadTerminalId: payload.loadTerminalId,
    unloadTerminalId: payload.unloadTerminalId,
    mode: payload.mode || '公路',
    expectDate: payload.expectDate || dayjs().add(14, 'day').format('YYYY-MM-DD'),
    unitPrice: payload.unitPrice || 0,
    remark: payload.remark || '',
    status: 'pending',
    createTime: dayjs().format('YYYY-MM-DD HH:mm'),
    contractId: null,
    rejectReason: ''
  }
  db.transportRequests.unshift(r)
  logAction(
    '客户门户',
    '发起运输需求',
    `客户 ${c.name} 发起运输需求 ${r.id}（${db.commodities.find((x) => x.id === r.commodityId)?.name || ''} ${r.quantity} 吨）`
  )
  notify(`客户发起运输需求`, 'request', '/contract', `客户 ${c.name} 需求 ${r.id}，请及时处理`, toRoles('contract'))
  return r
}

/** 需求转合同草稿（合同管理：销售确认商务条款后生成草稿，进入正常审批流）（RBAC：contract） */
export function convertRequestToContract(r, fields = {}) {
  const permErr = requireAction('contract')
  if (permErr) return permErr
  if (r.status !== 'pending') return { error: `运输需求 ${r.id} 当前非"待处理"状态，无法转换` }
  const c = db.customers.find((x) => x.id === r.customerId)
  const consignee = db.customers.find((x) => x.id === r.consigneeId)
  const commodity = db.commodities.find((x) => x.id === r.commodityId)
  const quantity = fields.quantity ?? r.quantity
  const unitPrice = fields.unitPrice ?? r.unitPrice ?? 0
  const contract = {
    id: genId('HT-', 4, db.contracts),
    name: `${c?.name || ''}→${consignee?.name || ''} ${commodity?.name || ''}运输合同`,
    shipperId: r.customerId,
    consigneeId: r.consigneeId,
    commodityId: r.commodityId,
    mode: r.mode,
    loadTerminalId: r.loadTerminalId,
    unloadTerminalId: r.unloadTerminalId,
    quantity,
    unitPrice,
    amount: Math.round(quantity * unitPrice),
    paymentDays: fields.paymentDays ?? 30,
    startDate: dayjs().format('YYYY-MM-DD'),
    endDate: fields.endDate || dayjs().add(180, 'day').format('YYYY-MM-DD'),
    signDate: dayjs().format('YYYY-MM-DD'),
    status: 'draft',
    progress: 0,
    approvalChain: null,
    contact: c?.contact || '—',
    phone: c?.phone || '—',
    remark: `由客户运输需求 ${r.id} 生成${r.remark ? '；' + r.remark : ''}`,
    source: 'request',
    requestId: r.id
  }
  db.contracts.unshift(contract)
  r.status = 'converted'
  r.contractId = contract.id
  logAction('合同管理', '需求转合同', `运输需求 ${r.id} 转为合同草稿 ${contract.id}（${contract.name}）`)
  notify(`运输需求转合同`, 'request', '/contract', `需求 ${r.id} 转为合同草稿 ${contract.id}`, toRoles('contract'))
  return contract
}

/** 驳回运输需求：pending → rejected（须记录原因）（RBAC：contract） */
export function rejectTransportRequest(r, reason) {
  const permErr = requireAction('contract')
  if (permErr) return permErr
  if (r.status !== 'pending') return { error: `运输需求 ${r.id} 当前非"待处理"状态，无法驳回` }
  r.status = 'rejected'
  r.rejectReason = reason || '未通过'
  logAction('合同管理', '驳回需求', `运输需求 ${r.id} 驳回：${r.rejectReason}`, 'fail')
  notify(`运输需求被驳回`, 'request', '/contract', `需求 ${r.id}：${r.rejectReason}`, toRoles('contract'))
  return { ok: true }
}

/* ===== 成本归集（单车次全成本：燃油/磨损/司机/过路费/折旧） ===== */

/** 单车次成本：公路口径按车辆口径（燃油×装载系数 + 磨损 + 司机 + 过路费 + 折旧）；
 *  铁路/水运/管道无车辆司机，按运输单元能耗口径（能耗 + 磨损 + 通道费） */
export function tripCostOf(d) {
  const dist = d.distance || 300
  const v = d.vehicleId ? db.vehicles.find((x) => x.id === d.vehicleId) : null
  if (!v) {
    const fuel = Math.round(dist * 2.2)
    const wear = Math.round(dist * 0.5)
    const toll = Math.round(dist * 0.35)
    return { fuel, wear, driver: 0, toll, depreciation: 0, total: fuel + wear + toll }
  }
  const loadFactor = Math.max(0.5, Math.min(1, d.quantity / (v.capacity || 35)))
  const fuel = Math.round(dist * 1.8 * loadFactor)
  const wear = Math.round(dist * 0.6)
  const driver = Math.round(600 + dist * 0.25)
  const toll = Math.round(dist * 0.35)
  const depreciation = Math.round((v.monthlyCost || 0) / 30)
  return { fuel, wear, driver, toll, depreciation, total: fuel + wear + driver + toll + depreciation }
}

/** 司机趟次收入：与成本侧司机项同口径（底薪 600 + 0.25 元/公里）；非公路车次无司机收入 */
export function driverIncomeOf(d) {
  if (!d || !d.driverId) return 0
  return tripCostOf(d).driver
}

/* ===== P1 成本侧闭环：趟次应付（司机趟次费 + 外协车运费）→ 付款核销 ===== */

/** 外协车运费：外协车（owner=外协）按 里程×1.5 + 运量×25 计；自有车无外协运费（内部成本） */
export function outsourceFreightOf(d) {
  const v = d && d.vehicleId ? db.vehicles.find((x) => x.id === d.vehicleId) : null
  if (!v || v.owner !== '外协') return 0
  const dist = d.distance || 300
  return Math.round(dist * 1.5 + (d.quantity || 0) * 25)
}

/** 趟次应付核心（幂等，一车次一单）：公路已完成车次生成应付 = 司机趟次费 + 外协车运费
 *  由 doConfirmUnload 完成时自动调用（成本侧闭环），亦可供批量补生成 */
function doCreateTripPayable(d) {
  if (!d || d.status !== 'completed' || !isRoadMode(d.mode)) return null
  const existing = db.payables.find((p) => p.dispatchId === d.id)
  if (existing) return existing
  const v = d.vehicleId ? db.vehicles.find((x) => x.id === d.vehicleId) : null
  const driverFee = driverIncomeOf(d)
  const outsourceFee = v && v.owner === '外协' ? outsourceFreightOf(d) : 0
  const p = {
    id: genId('AF-', 4, db.payables),
    dispatchId: d.id,
    driverId: d.driverId || '',
    vehicleId: d.vehicleId || '',
    plate: v ? v.plate : '-',
    owner: v ? v.owner : '-',
    driverFee,
    outsourceFee,
    amount: driverFee + outsourceFee,
    status: 'pending',
    createTime: dayjs().format('YYYY-MM-DD HH:mm'),
    payTime: null,
    payMethod: null
  }
  db.payables.unshift(p)
  return p
}

/** 批量生成趟次应付（RBAC：settlement）：为所有已完成公路且尚无应付的车次补生成（含历史/种子） */
export function generatePayables() {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  const targets = db.dispatches.filter(
    (d) => d.status === 'completed' && isRoadMode(d.mode) && !db.payables.some((p) => p.dispatchId === d.id)
  )
  const created = []
  for (const d of targets) created.push(doCreateTripPayable(d))
  if (created.length) {
    const total = created.reduce((s, p) => s + p.amount, 0)
    logAction('结算管理', '生成趟次应付', `批量生成 ${created.length} 笔趟次应付，合计 ${formatMoney(total)}`)
    notify(`生成 ${created.length} 笔趟次应付`, 'settlement', '/settlement', `司机趟次费 + 外协车运费，合计 ${formatMoney(total)}`, toRoles('settlement'))
  }
  return { ok: true, created: created.length }
}

/** 趟次应付付款（RBAC：settlement）：待付 → 已付，记录付款时间/方式，成本侧核销 */
export function payPayable(p, method) {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  if (!p || p.status !== 'pending') return { error: `应付单 ${p?.id || ''} 非"待付"状态，不可付款` }
  p.status = 'paid'
  p.payTime = dayjs().format('YYYY-MM-DD HH:mm')
  p.payMethod = method || '银行转账'
  logAction(
    '结算管理',
    '趟次应付付款',
    `应付单 ${p.id}（调度单 ${p.dispatchId}）付款 ${formatMoney(p.amount)}（${p.payMethod}）：司机趟次费 ${formatMoney(p.driverFee)} + 外协运费 ${formatMoney(p.outsourceFee)}`
  )
  notify(`趟次应付已付 ${formatMoney(p.amount)}`, 'settlement', '/settlement', `调度单 ${p.dispatchId}：${p.payMethod}`, toRoles('settlement'))
  return { ok: true, amount: p.amount }
}

/** 趟次应付统计（待付/已付 笔数与金额） */
export function payableStats() {
  const pending = db.payables.filter((p) => p.status === 'pending')
  const paid = db.payables.filter((p) => p.status === 'paid')
  return {
    pendingCount: pending.length,
    pendingAmount: pending.reduce((s, p) => s + p.amount, 0),
    paidCount: paid.length,
    paidAmount: paid.reduce((s, p) => s + p.amount, 0)
  }
}

/* ===== 司机端（接单 / 电子签收） ===== */

/** 司机端身份守卫（M6 修复，等价后端司机 App 独立鉴权）：
 *  司机本人（司机角色，且须为该车次指派司机）或持有 dispatch 执行权限的角色（场站代操作/演示切换）可调用；
 *  其余 PC 角色（结算/客户/只读等）在服务层拦截——原缺陷：任何登录角色均可调用司机端入口 */
function requireDriverApp(d) {
  if (operator.role === '司机') {
    if (!operator.driverId || operator.driverId !== d.driverId) {
      return { error: `司机账号只能操作指派给本人的车次（调度单 ${d.id} 未指派给当前司机）` }
    }
    return null
  }
  if (operatorCan('dispatch')) return null
  return { error: `当前角色「${operator.role || '未登录'}」非司机端身份，无此操作权限，操作已被服务层拦截` }
}

/** 司机接单：标记已接单（不改状态机，装货确认前司机需先接单）（M6：司机端身份守卫） */
export function acceptDispatch(d) {
  const guardErr = requireDriverApp(d)
  if (guardErr) return guardErr
  d.accepted = true
  logAction('司机端', '司机接单', `调度单 ${d.id} 司机 ${driverOf(d.driverId)?.name || '-'} 接单`)
  notify(`司机接单提醒`, 'dispatch', '/dispatch', `调度单 ${d.id} 司机 ${driverOf(d.driverId)?.name || '-'} 已接单`, toRoles('dispatch'))
}

/** 司机端发车：走内部核心 doDepart（状态机守卫与 PC 端一致，M6：司机端身份守卫） */
export function driverDepart(d) {
  const guardErr = requireDriverApp(d)
  if (guardErr) return guardErr
  const r = doDepart(d)
  if (r && r.error) return r
  logAction('司机端', '车辆发车', `司机 ${driverOf(d.driverId)?.name || '-'} 确认调度单 ${d.id} 发车`)
  return { ok: true }
}

/** 司机端确认到达：走内部核心 doArrive（状态机守卫与 PC 端一致，M6：司机端身份守卫） */
export function driverArrive(d) {
  const guardErr = requireDriverApp(d)
  if (guardErr) return guardErr
  const r = doArrive(d)
  if (r && r.error) return r
  logAction('司机端', '确认到达', `司机 ${driverOf(d.driverId)?.name || '-'} 确认调度单 ${d.id} 到达卸货场站`)
  return { ok: true }
}

/** 司机端电子签收：卸货完成后生成签收单（签收人+时间+签收码），是公路车次的收货凭证（M6：司机端身份守卫） */
export function signReceipt(d, signer) {
  const guardErr = requireDriverApp(d)
  if (guardErr) return guardErr
  if (d.status !== 'completed') return { error: `调度单 ${d.id} 尚未卸货完成，签收单只能在卸货完成后生成` }
  if (d.receipt) return { error: `调度单 ${d.id} 已存在电子签收单，不可重复签收` }
  d.receipt = {
    code: 'QS-' + d.id.slice(-5),
    signer: signer || '收货方',
    time: dayjs().format('YYYY-MM-DD HH:mm')
  }
  logAction('司机端', '电子签收', `调度单 ${d.id} 电子签收，签收人 ${d.receipt.signer}（${d.receipt.code}）`)
  return d.receipt
}

/** 环节1：补签——已完成公路车次缺失电子签收（漏签/签收单遗失）时，调度员与收货方核实后补开
 *  非公路豁免：铁路/水运/管道按运输单元执行，无签收凭证，无需补签
 *  补签后若车次已入账单且已有对账结果，重建对账清除"未签收"标记 */
export function supplementReceipt(d, signer, reason) {
  const permErr = requireAction('dispatch')
  if (permErr) return permErr
  if (!isRoadMode(d.mode)) return { error: `${d.mode} 车次按运输单元执行，无签收凭证，无需补签（非公路豁免）` }
  if (d.status !== 'completed') return { error: `调度单 ${d.id} 尚未完成，仅已完成车次可补签` }
  if (d.receipt) return { error: `调度单 ${d.id} 已存在电子签收单，无需补签` }
  if (!signer || !String(signer).trim()) return { error: '请填写签收人' }
  d.receipt = {
    code: 'QS-B' + d.id.slice(-5),
    signer: String(signer).trim(),
    time: dayjs().format('YYYY-MM-DD HH:mm'),
    supplement: true,
    reason: String(reason || '').trim()
  }
  logAction('调度管理', '补签签收单', `调度单 ${d.id} 补签电子签收，签收人 ${d.receipt.signer}${d.receipt.reason ? `（原因：${d.receipt.reason}）` : ''}`)
  notify(`调度单 ${d.id} 已补签`, 'settlement', '/settlement', `签收人 ${d.receipt.signer}`, toRoles('settlement'))
  const s = db.settlements.find((x) => x.id === d.settlementId)
  if (s && s.reconciliation) buildReconciliation(s)
  return d.receipt
}

/* ===== 扫码确认（装/卸货码按调度单号确定性派生，司机端扫码核验后流转） ===== */

function hashStr(s) {
  let n = 0
  for (const ch of String(s)) n = (n * 31 + ch.charCodeAt(0)) % 2147483647
  return n
}

/** 装货码：装货场站张贴，司机扫码确认装货（ZD + 6 位） */
export function loadCodeOf(d) {
  return 'ZD' + String(100000 + (hashStr(d.id + ':load') % 900000))
}

/** 卸货码：卸货场站张贴，司机扫码确认卸货（XD + 6 位） */
export function unloadCodeOf(d) {
  return 'XD' + String(100000 + (hashStr(d.id + ':unload') % 900000))
}

/** 扫码确认装货：码不匹配/状态不符/未接单均拦截
 *  走内部核心 doConfirmLoad（状态机守卫与 PC 端一致，M6：司机端身份守卫） */
export function scanConfirmLoad(d, code) {
  const guardErr = requireDriverApp(d)
  if (guardErr) return guardErr
  const expect = loadCodeOf(d)
  if (String(code || '').trim() !== expect) return { error: `装货码校验失败：「${code || '空'}」与本车次装货码 ${expect} 不符` }
  const r = doConfirmLoad(d)
  if (r && r.error) return r
  logAction('司机端', '扫码确认装货', `调度单 ${d.id} 扫装货码 ${expect} 核验通过，确认装货`)
  return { ok: true }
}

/** 扫码确认卸货：码不匹配/状态不符均拦截
 *  走内部核心 doConfirmUnload（状态机守卫与 PC 端一致，M6：司机端身份守卫） */
export function scanConfirmUnload(d, code) {
  const guardErr = requireDriverApp(d)
  if (guardErr) return guardErr
  const expect = unloadCodeOf(d)
  if (String(code || '').trim() !== expect) return { error: `卸货码校验失败：「${code || '空'}」与本车次卸货码 ${expect} 不符` }
  const r = doConfirmUnload(d)
  if (r && r.error) return r
  logAction('司机端', '扫码确认卸货', `调度单 ${d.id} 扫卸货码 ${expect} 核验通过，确认卸货`)
  return { ok: true }
}

/* ===== 电子围栏（事件化：参数可配置 + 偏离/超时自动写异常单） ===== */

/** 地图坐标哈希偏移（与在途监控地图同一口径，保证回放轨迹与实时位置一致） */
export function hashOffset(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997
  return (h % 5) - 2
}

/** 轨迹点：沿线段均匀取 21 点，叠加按单号确定性派生的横向偏移（基础偏移 + 正弦波动） */
export function trackPointsOf(d) {
  const from = MAP_NODES[d.loadTerminalId]
  const to = MAP_NODES[d.unloadTerminalId]
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const base = hashOffset(d.id) * 5
  const phase = (hashOffset(d.id) % 6) * 0.7
  const pts = []
  for (let i = 0; i <= 20; i++) {
    const p = i / 20
    const off = base + 8 * Math.sin(i * 0.6 + phase)
    pts.push({ x: from.x + dx * p + nx * off, y: from.y + dy * p + ny * off })
  }
  return pts
}

/** 轨迹最大偏离：轨迹点到线路直线的最大垂直距离（地图坐标单位） */
export function maxDeviationOf(d) {
  const from = MAP_NODES[d.loadTerminalId]
  const to = MAP_NODES[d.unloadTerminalId]
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len2 = dx * dx + dy * dy || 1
  let max = 0
  for (const p of trackPointsOf(d)) {
    const t = ((p.x - from.x) * dx + (p.y - from.y) * dy) / len2
    const px = from.x + dx * t
    const py = from.y + dy * t
    max = Math.max(max, Math.sqrt((p.x - px) ** 2 + (p.y - py) ** 2))
  }
  return Math.round(max)
}

/** 围栏事件检查：在途车次 轨迹偏离超阈值→偏离异常 / 超 ETA 超阈值→延误异常，自动写异常单
 *  去重：每车次每类事件仅生成一次（d.fenceAlerted 记忆），恢复运输后不重复触发；
 *  由 scheduler.js 全局定时任务调用（后端 cron 等价，不再依赖监控页打开）；
 *  系统事件走 createException 内部核心（不做登录用户权限校验，与后端系统任务口径一致）；
 *  围栏参数在 db.fenceConfig（监控页可配置） */
export function checkFenceEvents() {
  const cfg = db.fenceConfig
  if (!cfg || !cfg.enabled) return []
  const created = []
  for (const d of db.dispatches) {
    if (d.status !== 'intransit') continue
    d.fenceAlerted = d.fenceAlerted || {}
    const dev = maxDeviationOf(d)
    if (!d.fenceAlerted.deviate && dev > cfg.deviateLimit) {
      d.fenceAlerted.deviate = true
      const e = createException(d, `围栏预警：轨迹偏离线路 ${dev} 个地图单位（阈值 ${cfg.deviateLimit}）`, 'other', 'medium', 'fence')
      if (e && e.id) created.push(e)
    } else if (!d.fenceAlerted.delay && d.eta && dayjs(d.eta).isBefore(dayjs().subtract(cfg.delayMinutes, 'minute'))) {
      d.fenceAlerted.delay = true
      const e = createException(d, `围栏预警：超预计到达时间 ${dayjs().diff(dayjs(d.eta), 'minute')} 分钟（阈值 ${cfg.delayMinutes} 分钟）`, 'delay', 'medium', 'fence')
      if (e && e.id) created.push(e)
    }
  }
  return created
}

/* ===== GPS 遥测与逾期校准（P2：后端数据源/定时任务的等价实现，由 scheduler.js 驱动） ===== */

/** GPS/遥测推进：在途车次进度与车速（后端遥测数据源等价；UI 不再直接改业务数据） */
export function advanceTelemetry() {
  for (const d of db.dispatches) {
    if (d.status === 'intransit') {
      d.progress = Math.min(95, d.progress + Math.random() * 0.9)
      d.speed = Math.max(35, Math.min(75, d.speed + (Math.random() - 0.5) * 8))
    }
  }
}

/** 逾期全量校准（后端定时任务等价：不再依赖"收款/页面加载时才重算"，应用关闭期间不丢逾期状态）
 *  返回本次状态变化条数 */
export function recalcOverdueAll() {
  let n = 0
  for (const s of db.settlements) {
    const before = s.status
    recalcSettlementStatus(s)
    if (s.status !== before) n += 1
  }
  return n
}

/* ===== P2 异常/审批升级与超时提醒（定时任务驱动，幂等） ===== */

/** 异常升级：待受理（pending）异常单超时逐级升级，提醒安全管理员/平台管理员
 *  级别1（超 exceptionHours）：升级提醒；级别2（超 4×exceptionHours）：升级督办
 *  幂等：按 escalated 计数，已升级级别不重复；返回本轮升级的异常单数组 */
export function escalatePendingExceptions() {
  const hours = (db.escalateConfig && db.escalateConfig.exceptionHours) || 2
  const now = dayjs()
  const escalated = []
  for (const e of db.exceptions) {
    if (e.status !== 'pending') continue
    const ageH = now.diff(dayjs(e.occurTime), 'hour')
    const target = ageH >= hours * 4 ? 2 : ageH >= hours ? 1 : 0
    if (target > (e.escalated || 0)) {
      e.escalated = target
      e.escalateTime = now.format('YYYY-MM-DD HH:mm')
      e.escalatedTo = target >= 2 ? '平台管理员（升级督办）' : '安全管理员/平台管理员'
      logAction(
        '异常处理',
        target >= 2 ? '异常升级督办' : '异常升级',
        `异常单 ${e.id} 待受理超 ${ageH}h，${target >= 2 ? '升级督办平台管理员' : '升级提醒安全管理员/平台管理员'}`
      )
      notify(
        target >= 2 ? `异常单 ${e.id} 超时未受理，升级督办` : `异常单 ${e.id} 超时未受理`,
        'exception',
        '/exception',
        `待受理超 ${ageH} 小时，${target >= 2 ? '请平台管理员督办处理' : '请安全管理员/平台管理员关注'}`,
        toRoles('exception')
      )
      escalated.push(e)
    }
  }
  return escalated
}

/** 合同审批超时催办：待审批合同/改价超 contractHours 未批 → 催办审批人（每 24h 至多一次）
 *  返回本轮催办的合同数组 */
export function escalateContractApprovals() {
  const hours = (db.escalateConfig && db.escalateConfig.contractHours) || 24
  const now = dayjs()
  const reminded = []
  for (const c of db.contracts) {
    // 合同审批待批（自提交起算）
    if (c.status === 'pending' && c.submitTime) {
      const ageH = now.diff(dayjs(c.submitTime), 'hour')
      if (ageH >= hours && (c.lastApprovalReminder ? now.diff(dayjs(c.lastApprovalReminder), 'hour') >= 24 : true)) {
        c.lastApprovalReminder = now.format('YYYY-MM-DD HH:mm')
        logAction('合同管理', '审批超时催办', `合同 ${c.id} 审批待批超 ${ageH}h，催办审批人`)
        notify(`合同 ${c.id} 审批超时`, 'approval', '/contract', `审批已待批 ${ageH} 小时，请审批人及时处理`, toRoles('contract-approve', 'contract'))
        reminded.push(c)
      }
    }
    // 改价审批待批（自变更提交起算）
    if (c.pendingChange && c.pendingChange.createTime) {
      const ageH = now.diff(dayjs(c.pendingChange.createTime), 'hour')
      if (ageH >= hours && (c.lastChangeReminder ? now.diff(dayjs(c.lastChangeReminder), 'hour') >= 24 : true)) {
        c.lastChangeReminder = now.format('YYYY-MM-DD HH:mm')
        logAction('合同管理', '改价审批超时催办', `合同 ${c.id} 改价待批超 ${ageH}h，催办审批人`)
        notify(`合同 ${c.id} 改价审批超时`, 'approval', '/contract', `改价审批已待批 ${ageH} 小时，请审批人及时处理`, toRoles('contract-approve', 'contract'))
        reminded.push(c)
      }
    }
  }
  return reminded
}

/* ===== P2 保险环节（事故投保 / 理赔 / 责任认定） ===== */

/** 保险理赔台账查询（只读，无 RBAC，同 report.js 口径） */
export function listInsuranceClaims() {
  return [...db.insurance]
}

/** 报险/投保：为事故登记保险理赔单（RBAC：insurance）；同一事故仅一张理赔单（重复报险拦截） */
export function fileInsuranceClaim(accidentId, payload) {
  const permErr = requireAction('insurance')
  if (permErr) return permErr
  const a = db.accidents.find((x) => x.id === accidentId)
  if (!a) return { error: `事故 ${accidentId} 不存在` }
  const dup = db.insurance.find((x) => x.accidentId === accidentId)
  if (dup) return { error: `事故 ${accidentId} 已有理赔单 ${dup.id}，请勿重复报险` }
  const e = db.exceptions.find((x) => x.accidentId === a.id)
  const claim = {
    id: genId('BX-', 3, db.insurance),
    accidentId: a.id,
    dispatchId: e ? e.dispatchId : '',
    policyNo: payload.policyNo || 'PICC-' + String(a.id).replace('SG-', '') + '-001',
    insurer: payload.insurer || '中国人民财产保险',
    insured: payload.insured || '车辆及货物',
    claimDate: payload.claimDate || dayjs().format('YYYY-MM-DD'),
    reportedAmount: payload.reportedAmount != null ? payload.reportedAmount : a.loss || 0,
    responsibility: '',
    responsibilityParty: '',
    assessedAmount: 0,
    settledAmount: 0,
    status: 'reported',
    handler: payload.handler || '',
    remark: payload.remark || ''
  }
  db.insurance.unshift(claim)
  a.insuranceId = claim.id
  logAction('安全管理', '保险报险', `事故 ${a.id} 报险，理赔单 ${claim.id}（${claim.insurer}，报案金额 ${formatMoney(claim.reportedAmount)}）`)
  notify(`事故 ${a.id} 已报险`, 'exception', '/safety', `理赔单 ${claim.id}（${claim.insurer}），报案金额 ${formatMoney(claim.reportedAmount)}`, toRoles('insurance', 'safety'))
  return { ok: true, id: claim.id, claim }
}

/** 责任认定 + 核定金额：reported → assessed（RBAC：insurance） */
export function assessInsuranceClaim(claim, payload) {
  const permErr = requireAction('insurance')
  if (permErr) return permErr
  if (claim.status !== 'reported') return { error: `理赔单 ${claim.id} 当前非"已报险"状态，无法定责核定` }
  if (!payload.responsibility) return { error: '请选择责任认定' }
  if (payload.assessedAmount == null || payload.assessedAmount < 0) return { error: '请填写核定金额' }
  claim.responsibility = payload.responsibility
  claim.responsibilityParty = payload.responsibilityParty || ''
  claim.assessedAmount = payload.assessedAmount
  claim.handler = payload.handler || claim.handler
  claim.status = 'assessed'
  logAction('安全管理', '保险责任认定', `理赔单 ${claim.id} 定责：${claim.responsibility}（${claim.responsibilityParty || '—'}），核定 ${formatMoney(claim.assessedAmount)}`)
  return { ok: true }
}

/** 理赔结案：assessed → settled（RBAC：insurance）
 *  理赔款冲减事故损失（accident.insuranceRecovered）；若事故损失已计入账单（异常补扣），
 *  按核定回收额（≤ 该异常损失）冲减账单 exceptionLoss，留调整记录；已结算账单回待对账须重新确认 */
export function settleInsuranceClaim(claim, payload) {
  const permErr = requireAction('insurance')
  if (permErr) return permErr
  if (claim.status !== 'assessed') return { error: `理赔单 ${claim.id} 当前非"已定责核定"状态，无法理赔结案` }
  const settled = payload.settledAmount != null ? payload.settledAmount : claim.assessedAmount
  if (settled < 0) return { error: '理赔金额不能为负' }
  claim.settledAmount = settled
  claim.status = 'settled'
  claim.settleDate = dayjs().format('YYYY-MM-DD')
  const a = db.accidents.find((x) => x.id === claim.accidentId)
  if (a) a.insuranceRecovered = (a.insuranceRecovered || 0) + settled
  let offsetBill = null
  const e = db.exceptions.find((x) => x.accidentId === claim.accidentId)
  if (e && e.settleApplied) {
    const s = db.settlements.find((x) => x.id === e.settleApplied)
    if (s) {
      const recover = Math.min(settled, e.cost || 0)
      if (recover > 0) {
        const wasSettled = s.status === 'settled' || s.status === 'overdue'
        s.exceptionLoss = (s.exceptionLoss || 0) - recover
        s.totalAmount += recover
        s.adjustments = s.adjustments || []
        s.adjustments.push({
          time: dayjs().format('YYYY-MM-DD HH:mm'),
          reason: `理赔单 ${claim.id} 结案，保险回收 ${formatMoney(recover)} 冲减异常损失`,
          amount: recover
        })
        if (wasSettled) {
          s.status = 'pending'
          s.customerConfirmed = null
          s.reconciliation = null
          s.settleDate = null
        }
        offsetBill = s.billNo
        logAction('结算管理', '保险回收冲减', `账单 ${s.billNo} 因理赔单 ${claim.id} 结案回收 ${formatMoney(recover)}，异常损失冲减，结算金额调整为 ${formatMoney(s.totalAmount)}${wasSettled ? '，客户确认失效，账单回待对账' : ''}`)
      }
    }
  }
  logAction('安全管理', '保险理赔结案', `理赔单 ${claim.id} 结案，理赔 ${formatMoney(settled)}${offsetBill ? `，冲减账单 ${offsetBill} 异常损失` : ''}`)
  notify(`理赔单 ${claim.id} 已结案`, 'exception', '/safety', `理赔 ${formatMoney(settled)}（责任：${claim.responsibility}）`, toRoles('insurance', 'safety'))
  return { ok: true, settledAmount: settled, offsetSettlement: offsetBill }
}

/** 拒赔：reported/assessed → rejected（RBAC：insurance） */
export function rejectInsuranceClaim(claim, reason) {
  const permErr = requireAction('insurance')
  if (permErr) return permErr
  if (!['reported', 'assessed'].includes(claim.status)) return { error: `理赔单 ${claim.id} 当前状态无法拒赔` }
  claim.status = 'rejected'
  claim.remark = reason || claim.remark
  logAction('安全管理', '保险拒赔', `理赔单 ${claim.id} 拒赔：${reason || '—'}`, 'fail')
  return { ok: true }
}

/* ===== 合同审批与开票（多级审批：部门审批 → 公司审批） ===== */

/** 审批链层级定义 */
export const APPROVAL_STEPS = [
  { level: 1, name: '部门审批' },
  { level: 2, name: '公司审批' }
]

/** 生成审批链（首级待审批，其余等待中） */
function buildApprovalChain() {
  return APPROVAL_STEPS.map((s, i) => ({
    level: s.level,
    name: s.name,
    status: i === 0 ? 'pending' : 'waiting',
    approver: '',
    comment: '',
    time: null
  }))
}

/** 提交审批：draft → pending，生成审批链（重新提交时重置审批链）（RBAC：contract） */
export function submitContractApproval(c) {
  const permErr = requireAction('contract')
  if (permErr) return permErr
  if (c.status !== 'draft') return { error: `合同 ${c.id} 当前非"草稿"状态，无法提交审批` }
  c.status = 'pending'
  c.approvalChain = buildApprovalChain()
  c.submitTime = dayjs().format('YYYY-MM-DD HH:mm') // P2 审批超时催办计时基准
  logAction('合同管理', '提交合同审批', `合同 ${c.id} 提交审批（部门审批 → 公司审批）`)
  notify(`合同 ${c.id} 提交审批`, 'approval', '/contract', '请及时处理（部门审批 → 公司审批）', toRoles('contract-approve', 'contract'))
  return { ok: true }
}

/** 审批通过：推进当前待审批层级；末级通过 → executing
 *  返回 { final }：false 表示还有后续层级，true 表示全链通过 */
export function approveContract(c, comment) {
  const permErr = requireAction('contract-approve')
  if (permErr) return permErr
  const step = (c.approvalChain || []).find((s) => s.status === 'pending')
  if (!step) return { error: `合同 ${c.id} 无待审批层级` }
  step.status = 'approved'
  step.approver = operator.name
  step.comment = comment || '同意'
  step.time = dayjs().format('YYYY-MM-DD HH:mm')
  const next = (c.approvalChain || []).find((s) => s.status === 'waiting')
  if (next) {
    next.status = 'pending'
    logAction('合同管理', '合同审批', `合同 ${c.id} ${step.name}通过（${step.approver}），进入${next.name}`)
    notify(`合同 ${c.id} ${step.name}通过`, 'approval', '/contract', `进入${next.name}（审批人 ${step.approver}）`, toRoles('contract-approve', 'contract'))
    return { ok: true, final: false, step: step.name }
  }
  c.status = 'executing'
  c.startDate = dayjs().format('YYYY-MM-DD')
  c.approval = { approver: operator.name, time: step.time, comment: step.comment }
  logAction('合同管理', '合同审批', `合同 ${c.id} 全级审批通过（末级：${step.name} ${step.approver}），进入执行`)
  notify(`合同 ${c.id} 全级审批通过`, 'approval', '/contract', '合同进入执行，可拆批计划', toRoles('contract-approve', 'contract'))
  return { ok: true, final: true, step: step.name }
}

/** 审批驳回：当前层级驳回 → 回草稿，后续层级取消（重新提交审批后重走全链） */
export function rejectContract(c, reason) {
  const permErr = requireAction('contract-approve')
  if (permErr) return permErr
  const step = (c.approvalChain || []).find((s) => s.status === 'pending')
  if (!step) return { error: `合同 ${c.id} 无待审批层级` }
  step.status = 'rejected'
  step.approver = operator.name
  step.comment = `驳回：${reason}`
  step.time = dayjs().format('YYYY-MM-DD HH:mm')
  for (const s of c.approvalChain || []) if (s.status === 'waiting') s.status = 'cancelled'
  c.status = 'draft'
  c.approval = { approver: operator.name, time: step.time, comment: `驳回：${reason}` }
  logAction('合同管理', '合同审批', `合同 ${c.id} ${step.name}驳回：${reason}`, 'fail')
  notify(`合同 ${c.id} 审批被驳回`, 'approval', '/contract', `${step.name}驳回：${reason}`, toRoles('contract-approve', 'contract'))
  return { ok: true, step: step.name }
}

/* ===== 合同全生命周期（变更 / 延期 / 提前终止 / 归档） ===== */

function pushChange(c, reason, content) {
  c.changes = c.changes || []
  c.changes.push({ time: dayjs().format('YYYY-MM-DD HH:mm'), operator: operator.name, reason, content })
}

/** 合同变更字段应用（即时变更与改价审批通过后共用），返回变更描述列表 */
function applyContractFields(c, fields) {
  const changes = []
  if (fields.quantity != null && fields.quantity !== c.quantity) {
    changes.push(`数量 ${c.quantity}→${fields.quantity} 吨`)
    c.quantity = fields.quantity
  }
  if (fields.unitPrice != null && fields.unitPrice !== c.unitPrice) {
    changes.push(`单价 ${c.unitPrice}→${fields.unitPrice} 元/吨`)
    c.unitPrice = fields.unitPrice
  }
  if (fields.endDate && fields.endDate !== c.endDate) {
    changes.push(`截止日期 ${c.endDate}→${fields.endDate}`)
    c.endDate = fields.endDate
  }
  c.amount = Math.round(c.quantity * c.unitPrice)
  return changes
}

/** 合同变更：调整数量/单价/截止日期，记录变更历史（RBAC：contract）
 *  环节3 改价审批：单价变更不即时生效，转"变更审批"（部门审批 → 公司审批），
 *  全链通过后才应用（数量/截止日期随同一变更单提交，一并待批）；仅数量/截止日期的变更仍即时生效。
 *  口径：已派车车次结算用派车时快照单价，改价仅影响未派车批次（不追溯） */
export function changeContract(c, fields, reason) {
  const permErr = requireAction('contract')
  if (permErr) return permErr
  if (c.pendingChange) return { error: `合同 ${c.id} 已有变更待审批，审批完成前不可提交新变更` }
  if (fields.unitPrice != null && fields.unitPrice !== c.unitPrice) {
    c.pendingChange = {
      fields: { quantity: fields.quantity, unitPrice: fields.unitPrice, endDate: fields.endDate },
      reason: String(reason || '').trim(),
      createTime: dayjs().format('YYYY-MM-DD HH:mm'),
      chain: buildApprovalChain()
    }
    logAction('合同管理', '提交改价审批', `合同 ${c.id} 改价提交审批：单价 ${c.unitPrice}→${fields.unitPrice} 元/吨（${reason || ''}）`)
    notify(`合同 ${c.id} 改价提交审批`, 'approval', '/contract', `单价 ${c.unitPrice}→${fields.unitPrice} 元/吨，请及时处理（部门审批 → 公司审批）`, toRoles('contract-approve', 'contract'))
    return { changed: false, pending: true, changes: [`单价 ${c.unitPrice}→${fields.unitPrice} 元/吨（待审批）`] }
  }
  const changes = applyContractFields(c, fields)
  if (!changes.length) return { changed: false }
  pushChange(c, reason, changes.join('；'))
  logAction('合同管理', '合同变更', `合同 ${c.id} 变更：${changes.join('；')}（${reason}）`)
  return { changed: true, changes }
}

/** 环节3：改价审批通过——推进变更审批当前待批层级；末级通过 → 应用变更（单价生效）
 *  返回 { final }：false 表示还有后续层级，true 表示全链通过并已生效 */
export function approveContractChange(c, comment) {
  const permErr = requireAction('contract-approve')
  if (permErr) return permErr
  const pc = c.pendingChange
  if (!pc) return { error: `合同 ${c.id} 无待审批的变更` }
  const step = (pc.chain || []).find((s) => s.status === 'pending')
  if (!step) return { error: `合同 ${c.id} 变更无待审批层级` }
  step.status = 'approved'
  step.approver = operator.name
  step.comment = comment || '同意'
  step.time = dayjs().format('YYYY-MM-DD HH:mm')
  const next = (pc.chain || []).find((s) => s.status === 'waiting')
  if (next) {
    next.status = 'pending'
    logAction('合同管理', '改价审批', `合同 ${c.id} 改价${step.name}通过（${step.approver}），进入${next.name}`)
    notify(`合同 ${c.id} 改价${step.name}通过`, 'approval', '/contract', `进入${next.name}（审批人 ${step.approver}）`, toRoles('contract-approve', 'contract'))
    return { ok: true, final: false, step: step.name }
  }
  const changes = applyContractFields(c, pc.fields)
  c.pendingChange = null
  pushChange(c, pc.reason || '改价', `${changes.join('；')}（改价审批通过）`)
  logAction('合同管理', '改价审批', `合同 ${c.id} 改价全级审批通过（末级：${step.name} ${step.approver}），变更生效：${changes.join('；')}`)
  notify(`合同 ${c.id} 改价审批通过`, 'approval', '/contract', `变更生效：${changes.join('；')}（仅影响未派车批次）`, toRoles('contract-approve', 'contract'))
  return { ok: true, final: true, step: step.name, changes }
}

/** 环节3：改价驳回——当前层级驳回即作废变更申请（合同单价保持不变），后续层级取消 */
export function rejectContractChange(c, reason) {
  const permErr = requireAction('contract-approve')
  if (permErr) return permErr
  const pc = c.pendingChange
  if (!pc) return { error: `合同 ${c.id} 无待审批的变更` }
  const step = (pc.chain || []).find((s) => s.status === 'pending')
  if (!step) return { error: `合同 ${c.id} 变更无待审批层级` }
  step.status = 'rejected'
  step.approver = operator.name
  step.comment = `驳回：${reason}`
  step.time = dayjs().format('YYYY-MM-DD HH:mm')
  for (const s of pc.chain || []) if (s.status === 'waiting') s.status = 'cancelled'
  const summary = pc.fields.unitPrice != null ? `单价 ${c.unitPrice}→${pc.fields.unitPrice} 元/吨` : '合同变更'
  c.pendingChange = null
  logAction('合同管理', '改价审批', `合同 ${c.id} 改价${step.name}驳回：${reason}（${summary}，单价维持不变）`, 'fail')
  notify(`合同 ${c.id} 改价被驳回`, 'approval', '/contract', `${step.name}驳回：${reason}`, toRoles('contract-approve', 'contract'))
  return { ok: true, step: step.name }
}

/** 合同延期：延长截止日期，记录变更历史（RBAC：contract） */
export function extendContract(c, newDate, reason) {
  const permErr = requireAction('contract')
  if (permErr) return permErr
  if (c.pendingChange) return { error: `合同 ${c.id} 已有变更待审批，审批完成前不可延期` }
  const old = c.endDate
  c.endDate = newDate
  pushChange(c, reason, `延期 ${old} → ${newDate}`)
  logAction('合同管理', '合同延期', `合同 ${c.id} 延期至 ${newDate}（${reason}）`)
}

/** 提前终止：executing → terminated
 *  口径：待执行计划批次取消；已调度/执行中计划及在途车次继续完成运输并正常结算（已发生业务照常履约），
 *  终止后不可再新建计划（新建计划页仅列执行中合同）与下发调度单（createDispatches 守卫拦截） */
export function terminateContract(c, reason, settleNow = true) {
  const permErr = requireAction('contract')
  if (permErr) return permErr
  c.status = 'terminated'
  pushChange(c, reason, `提前终止（${reason}）`)
  for (const p of db.plans.filter((x) => x.contractId === c.id && x.status === 'pending')) {
    p.status = 'cancelled'
  }
  let billNo = null
  if (settleNow) {
    // 终止联动结算走内部核心（外层已校验 contract 权限，不再叠加 settlement 权限）
    const keys = settlementCandidates().filter((g) => g.contractId === c.id).map((g) => g.key)
    if (keys.length) {
      const created = doGenerateSettlements(keys)
      billNo = created[0] ? created[0].billNo : null
    }
  }
  logAction('合同管理', '终止合同', `合同 ${c.id} 提前终止（${reason}）${billNo ? `，已完成车次生成提前结算单 ${billNo}` : ''}`)
  notify(`合同 ${c.id} 提前终止`, 'approval', '/contract', reason, toRoles('contract-approve', 'contract'))
  return billNo
}

/** 合同完结：executing → completed（手动关单）
 *  守卫：须执行中；未取消计划须全部完成（无待执行/已调度/执行中计划）
 *  适用：合同量含预留（拆批总量 < 合同量）时，计划全部完成也无法自动达 100%，由业务手动完结 */
export function completeContract(c) {
  const permErr = requireAction('contract')
  if (permErr) return permErr
  if (c.status !== 'executing') return { error: `合同 ${c.id} 当前非"执行中"状态，无法完结` }
  const activePlans = db.plans.filter(
    (p) => p.contractId === c.id && p.status !== 'cancelled' && p.status !== 'completed'
  )
  if (activePlans.length) {
    return { error: `合同 ${c.id} 尚有 ${activePlans.length} 个未完结计划（待执行/执行中），无法完结` }
  }
  c.status = 'completed'
  c.progress = 100
  pushChange(c, '合同完结', '计划全部完成，手动完结合同')
  logAction('合同管理', '合同完结', `合同 ${c.id} 手动完结（计划全部完成，进度置 100%）`)
  notify(`合同 ${c.id} 已完结`, 'approval', '/contract', '计划全部完成，合同手动关单', toRoles('contract-approve', 'contract'))
  return { ok: true }
}

/** 合同归档：completed → archived（只读存档）（RBAC：contract） */
export function archiveContract(c) {
  const permErr = requireAction('contract')
  if (permErr) return permErr
  c.status = 'archived'
  pushChange(c, '合同执行完毕', '归档')
  logAction('合同管理', '合同归档', `合同 ${c.id} 归档`)
}

/** M5 修复：账单金额变化后标记发票"金额陈旧"（发票额 ≠ 账单额）
 *  触发点：已开票账单发生异常补扣（closeException）/重算（recalcSettlement）。
 *  强制流程：陈旧发票未红冲重开前，recordPayment 拦截收款（票款一致）；红冲重开后新发票按当前账单额开具，标记自然清除 */
function markInvoiceStale(s, reason) {
  const inv = db.invoices.find((i) => i.settlementId === s.id && i.status === 'issued')
  if (!inv || inv.stale) return
  inv.stale = true
  inv.staleReason = reason
  logAction(
    '发票管理',
    '发票金额陈旧标记',
    `发票 ${inv.invoiceNo} 金额 ${formatMoney(inv.amount)} 与账单金额 ${formatMoney(s.totalAmount)} 不一致（${reason}），需红冲重开`
  )
  notify(`发票 ${inv.invoiceNo} 需红冲重开`, 'settlement', '/settlement/invoice', `账单 ${s.billNo}：${reason}`, toRoles('settlement', 'invoice'))
}

/** 开具发票（统一入口）：结算单 未开票/待开具 → 已开具（RBAC：invoice）
 *  单一开具路径：结算详情页与发票管理页均经由此函数（issueInvoiceRow 为其薄封装）。
 *  - 已有"待开具"发票记录（种子数据）→ 就地更新为已开具（补发票号/日期，金额以当前账单额为准）
 *  - 无记录（运行时新账单）→ 新建已开具记录（发票号按 结算单ID-发票ID 确定性派生）
 *  状态守卫：仅"未开票/待开具"账单可开具，防止重复开票 */
export function issueInvoice(s) {
  const permErr = requireAction('invoice')
  if (permErr) return permErr
  if (s.invoiceStatus !== 'not-issued' && s.invoiceStatus !== 'pending') {
    return { error: `账单 ${s.billNo} 当前开票状态非"未开票/待开具"，无法重复开具发票` }
  }
  let inv = db.invoices.find((i) => i.settlementId === s.id && i.status === 'pending')
  if (inv) {
    // 已有待开具记录（种子）：就地更新
    inv.invoiceNo = inv.invoiceNo || genInvoiceNo(s.id + '-' + inv.id)
    inv.issueDate = dayjs().format('YYYY-MM-DD')
    inv.amount = s.totalAmount
    inv.status = 'issued'
  } else {
    // 无记录（运行时新账单）：新建
    const id = genId('FP-', 4, db.invoices)
    inv = {
      id,
      settlementId: s.id,
      invoiceNo: genInvoiceNo(s.id + '-' + id),
      type: '增值税专用发票',
      amount: s.totalAmount,
      issueDate: dayjs().format('YYYY-MM-DD'),
      status: 'issued',
      remark: ''
    }
    db.invoices.push(inv)
  }
  s.invoiceStatus = 'issued'
  logAction('发票管理', '开具发票', `账单 ${s.billNo} 开具发票 ${inv.invoiceNo}，金额 ${formatMoney(s.totalAmount)}`)
  notify(`账单 ${s.billNo} 已开票`, 'settlement', '/settlement', `发票号码 ${inv.invoiceNo}`, toRoles('settlement', 'invoice'))
  return { ok: true, invoiceNo: inv.invoiceNo }
}

/** 发票开具（发票管理页薄封装）：解析结算单后委托统一入口 issueInvoice，
 *  与结算详情页同一开具路径、同一守卫、同一审计口径（RBAC：invoice） */
export function issueInvoiceRow(inv) {
  const s = db.settlements.find((x) => x.id === inv.settlementId)
  if (!s) return { error: `发票 ${inv.id} 未找到对应结算单，无法开具` }
  return issueInvoice(s)
}

/** 发票红冲（发票管理页：已开具 → 已红冲，须填红冲原因）（RBAC：invoice） */
export function redFlushInvoiceRow(inv, reason) {
  const permErr = requireAction('invoice')
  if (permErr) return permErr
  if (inv.status !== 'issued') return { error: `发票 ${inv.id} 当前非"已开具"状态，无法红冲` }
  inv.status = 'red-flushed'
  inv.remark = reason || inv.remark || ''
  const s = db.settlements.find((x) => x.id === inv.settlementId)
  if (s) s.invoiceStatus = 'not-issued'
  logAction('发票管理', '发票红冲', `发票 ${inv.invoiceNo} 红冲：${reason || '未填写原因'}`)
  return { ok: true }
}

/* ===== 数据导入（G7：Excel/CSV → 客户/商品/车辆，flow 统一守卫+去重+审计） ===== */

/** 客户导入：按客户名称去重（已存在跳过）；必填：客户名称（RBAC：customer） */
export function importCustomers(rows) {
  const permErr = requireAction('customer')
  if (permErr) return permErr
  const created = []
  const skipped = []
  const errors = []
  rows.forEach((row, i) => {
    const name = String(row.name || '').trim()
    if (!name) {
      errors.push({ row: i + 1, reason: '客户名称不能为空' })
      return
    }
    if (db.customers.some((c) => c.name === name)) {
      skipped.push(name)
      return
    }
    const level = ['A', 'B', 'C'].includes(row.level) ? row.level : 'C'
    db.customers.push({
      id: genId('CUS', 3, db.customers),
      name,
      type: { 发货方: 'shipper', 收货方: 'consignee', 双向客户: 'both' }[row.type] || 'shipper',
      region: String(row.region || '').trim() || '其他',
      address: '',
      level,
      contact: String(row.contact || '').trim() || '-',
      phone: String(row.phone || '').trim() || '-',
      creditLimit: Number(row.creditLimit) > 0 ? Math.round(Number(row.creditLimit)) : level === 'A' ? 5000000 : level === 'B' ? 2000000 : 500000,
      totalBusiness: 0,
      joinDate: dayjs().format('YYYY-MM-DD'),
      status: 'active',
      remark: '导入'
    })
    created.push(name)
  })
  if (created.length || skipped.length || errors.length) {
    logAction('客户管理', '数据导入', `导入客户 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`)
    notify('客户数据导入完成', 'system', '/customer', `导入 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`, toRoles('customer'))
  }
  return { created, skipped, errors }
}

/** 商品导入：按商品名称去重（已存在跳过）；必填：商品名称（RBAC：commodity） */
export function importCommodities(rows) {
  const permErr = requireAction('commodity')
  if (permErr) return permErr
  const created = []
  const skipped = []
  const errors = []
  rows.forEach((row, i) => {
    const name = String(row.name || '').trim()
    if (!name) {
      errors.push({ row: i + 1, reason: '商品名称不能为空' })
      return
    }
    if (db.commodities.some((c) => c.name === name)) {
      skipped.push(name)
      return
    }
    db.commodities.push({
      id: genId('CM', 3, db.commodities),
      name,
      category: String(row.category || '').trim() || '煤炭',
      unit: String(row.unit || '').trim() || '吨',
      density: Number(row.density) > 0 ? Number(row.density) : 1,
      price: Number(row.price) > 0 ? Math.round(Number(row.price)) : 0,
      indicators: [{ name: '质量要求', value: '按合同约定' }],
      status: 'active',
      totalVolume: 0,
      remark: '导入'
    })
    created.push(name)
  })
  if (created.length || skipped.length || errors.length) {
    logAction('商品管理', '数据导入', `导入商品 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`)
    notify('商品数据导入完成', 'system', '/commodity', `导入 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`, toRoles('commodity'))
  }
  return { created, skipped, errors }
}

/** 车辆导入：按车牌去重（已存在跳过）；必填：车牌号；新导入车辆默认空闲、年检一年有效（RBAC：vehicle） */
export function importVehicles(rows) {
  const permErr = requireAction('vehicle')
  if (permErr) return permErr
  const created = []
  const skipped = []
  const errors = []
  rows.forEach((row, i) => {
    const plate = String(row.plate || '').trim()
    if (!plate) {
      errors.push({ row: i + 1, reason: '车牌号不能为空' })
      return
    }
    if (db.vehicles.some((v) => v.plate === plate)) {
      skipped.push(plate)
      return
    }
    db.vehicles.push({
      id: genId('V', 3, db.vehicles),
      plate,
      type: String(row.type || '').trim() || '重型半挂车',
      capacity: Number(row.capacity) > 0 ? Number(row.capacity) : 35,
      owner: row.owner === '自有' ? '自有' : '外协',
      fuelType: String(row.fuelType || '').trim() || '柴油',
      status: 'idle',
      version: 1,
      purchaseDate: dayjs().format('YYYY-MM-DD'),
      nextInspection: dayjs().add(365, 'day').format('YYYY-MM-DD'),
      mileage: 0,
      monthlyCost: 0,
      remark: '导入'
    })
    created.push(plate)
  })
  if (created.length || skipped.length || errors.length) {
    logAction('车辆管理', '数据导入', `导入车辆 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`)
    notify('车辆数据导入完成', 'system', '/vehicle', `导入 ${created.length} 条，跳过重复 ${skipped.length} 条，失败 ${errors.length} 条`, toRoles('vehicle'))
  }
  return { created, skipped, errors }
}

/* ===== 银行对账核销（G8：银行流水 → 账单核销，收款闭环） ===== */

/** 手动核销：待核销银行流水核销至指定账单（写收款流水，超未付余额拦截）
 *  守卫：RBAC（settlement）；流水须待核销；流水金额不可超过账单未付余额 */
export function matchBankRecord(b, s) {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  if (!b) return { error: '请选择银行流水' }
  if (b.status !== 'unmatched') return { error: `银行流水 ${b.id} 已核销，不能重复核销` }
  if (!s) return { error: '请选择核销账单' }
  const unpaid = s.totalAmount - s.paidAmount
  if (b.amount > unpaid) {
    return { error: `银行流水金额 ${formatMoney(b.amount)} 超过账单 ${s.billNo} 未付余额 ${formatMoney(unpaid)}` }
  }
  const real = recordPayment(s, b.amount, '银行转账')
  b.status = 'matched'
  b.settlementId = s.id
  b.matchTime = dayjs().format('YYYY-MM-DD HH:mm')
  b.matchBy = operator.name
  logAction('结算管理', '银行核销', `银行流水 ${b.id}（${b.counterparty} ${formatMoney(b.amount)}）核销至账单 ${s.billNo}`)
  return { ok: true, real }
}

/** 自动核销：待核销流水中，对手方+金额与账单（已结算/逾期）未付余额精确一致者自动核销
 *  口径：金额精确匹配（容差 0.01 元），避免误核销；其余流水保留待人工处理（RBAC：settlement） */
export function autoMatchBank() {
  const permErr = requireAction('settlement')
  if (permErr) return permErr
  const matched = []
  for (const b of db.bankRecords.filter((x) => x.status === 'unmatched')) {
    const c = db.customers.find((x) => x.name === b.counterparty)
    const s = db.settlements.find(
      (x) =>
        (x.status === 'settled' || x.status === 'overdue') &&
        x.customerId === c?.id &&
        Math.abs(x.totalAmount - x.paidAmount - b.amount) < 0.01
    )
    if (!s) continue
    const r = matchBankRecord(b, s)
    if (r && !r.error) matched.push(b)
  }
  if (matched.length) logAction('结算管理', '自动核销', `自动核销完成，${matched.length} 笔银行流水已核销`)
  return matched
}

/* ===== 写操作下沉（P2：视图不再直接写 db，新建/状态变更统一经服务层：RBAC + 守卫 + 审计） ===== */

/** 新建合同（RBAC：contract）
 *  status: 'draft' 草稿 / 'pending' 提交审批（信用校验 + 生成审批链）
 *  守卫：必填要素、发货方/收货方类型与冻结状态、数量单价为正 */
export function createContract(payload, status = 'draft') {
  const permErr = requireAction('contract')
  if (permErr) return permErr
  if (!payload.name || !String(payload.name).trim()) return { error: '请输入合同名称' }
  const shipper = db.customers.find((c) => c.id === payload.shipperId)
  const consignee = db.customers.find((c) => c.id === payload.consigneeId)
  if (!shipper || !['shipper', 'both'].includes(shipper.type)) return { error: '请选择发货方客户' }
  if (!consignee || !['consignee', 'both'].includes(consignee.type)) return { error: '请选择收货方客户' }
  if (shipper.status === 'frozen') return { error: `发货方 ${shipper.name} 已冻结，不可新建合同` }
  if (!payload.commodityId) return { error: '请选择商品' }
  if (!payload.loadTerminalId || !payload.unloadTerminalId) return { error: '请选择装/卸货场站' }
  if (!payload.quantity || payload.quantity <= 0) return { error: '计划数量须大于 0' }
  if (!payload.unitPrice || payload.unitPrice <= 0) return { error: '合同单价须大于 0' }
  const amount = Math.round(payload.quantity * payload.unitPrice)
  if (status === 'pending') {
    const check = creditCheck(shipper.id, amount)
    if (!check.ok) return { error: check.message }
  }
  const contract = {
    id: genId('HT-', 4, db.contracts),
    name: String(payload.name).trim(),
    shipperId: shipper.id,
    consigneeId: consignee.id,
    commodityId: payload.commodityId,
    mode: payload.mode || '公路',
    loadTerminalId: payload.loadTerminalId,
    unloadTerminalId: payload.unloadTerminalId,
    quantity: payload.quantity,
    unitPrice: payload.unitPrice,
    amount,
    paymentDays: payload.paymentDays || 30,
    startDate: payload.startDate || dayjs().format('YYYY-MM-DD'),
    endDate: payload.endDate || dayjs().add(180, 'day').format('YYYY-MM-DD'),
    signDate: dayjs().format('YYYY-MM-DD'),
    status: status === 'pending' ? 'pending' : 'draft',
    progress: 0,
    approvalChain: null,
    contact: payload.contact || shipper.contact || '—',
    phone: payload.phone || shipper.phone || '—',
    remark: payload.remark || ''
  }
  db.contracts.unshift(contract)
  logAction('合同管理', '新建合同', `合同 ${contract.id} 创建（${contract.name}，${contract.quantity} 吨，${status === 'pending' ? '提交审批' : '草稿'}）`)
  if (status === 'pending') {
    // 提交审批走多级审批流（部门→公司），生成审批链（同属 contract 权限，直接调用）
    const r = submitContractApproval(contract)
    if (r && r.error) return { error: r.error, id: contract.id }
  }
  return { ok: true, id: contract.id, contract }
}

/* ===== P2 运价管理（线路运价表：合同查表取价 / 调价 / 启停） ===== */

/** 运价表查询（只读，无 RBAC，同 report.js 口径） */
export function listRateCards() {
  return [...db.rateCards]
}

/** 查线路运价（按 商品+装/卸场站+方式 匹配启用中的运价卡；返回运价卡或 null）
 *  合同新建/变更"按运价表取价"用；不消耗随机序列 */
export function rateOf(commodityId, loadTerminalId, unloadTerminalId, mode) {
  return (
    db.rateCards.find(
      (r) =>
        r.status === 'active' &&
        r.commodityId === commodityId &&
        r.loadTerminalId === loadTerminalId &&
        r.unloadTerminalId === unloadTerminalId &&
        (r.mode || '公路') === (mode || '公路')
    ) || null
  )
}

/** 新建运价卡（RBAC：rate）；同线路启用中运价卡唯一（重复则提示走调价） */
export function createRateCard(payload) {
  const permErr = requireAction('rate')
  if (permErr) return permErr
  if (!payload.commodityId) return { error: '请选择商品' }
  if (!payload.loadTerminalId || !payload.unloadTerminalId) return { error: '请选择装/卸货场站' }
  if (payload.loadTerminalId === payload.unloadTerminalId) return { error: '装货场站与卸货场站不能相同' }
  if (!payload.unitPrice || payload.unitPrice <= 0) return { error: '运价须大于 0' }
  const dup = db.rateCards.find(
    (r) =>
      r.status === 'active' &&
      r.commodityId === payload.commodityId &&
      r.loadTerminalId === payload.loadTerminalId &&
      r.unloadTerminalId === payload.unloadTerminalId &&
      (r.mode || '公路') === (payload.mode || '公路')
  )
  if (dup) return { error: `该线路已有启用中的运价卡 ${dup.id}，请勿重复创建（如需调价请编辑原卡）` }
  const rc = {
    id: genId('YJ-', 3, db.rateCards),
    commodityId: payload.commodityId,
    loadTerminalId: payload.loadTerminalId,
    unloadTerminalId: payload.unloadTerminalId,
    mode: payload.mode || '公路',
    unitPrice: payload.unitPrice,
    effectiveDate: payload.effectiveDate || dayjs().format('YYYY-MM-DD'),
    status: 'active',
    remark: payload.remark || '',
    history: []
  }
  db.rateCards.unshift(rc)
  logAction('运价管理', '新建运价卡', `运价卡 ${rc.id} 创建（${rc.commodityId} ${rc.loadTerminalId}→${rc.unloadTerminalId}，${rc.unitPrice} 元/吨）`)
  return { ok: true, id: rc.id, card: rc }
}

/** 运价卡调价/编辑（RBAC：rate）：调整单价/生效日期/备注，留变更历史；仅影响后续新签合同（已派车批次不追溯） */
export function updateRateCard(id, fields) {
  const permErr = requireAction('rate')
  if (permErr) return permErr
  const rc = db.rateCards.find((r) => r.id === id)
  if (!rc) return { error: `运价卡 ${id} 不存在` }
  const changes = []
  if (fields.unitPrice != null && fields.unitPrice !== rc.unitPrice) {
    if (fields.unitPrice <= 0) return { error: '运价须大于 0' }
    changes.push(`单价 ${rc.unitPrice}→${fields.unitPrice} 元/吨`)
    rc.unitPrice = fields.unitPrice
  }
  if (fields.effectiveDate && fields.effectiveDate !== rc.effectiveDate) {
    changes.push(`生效日期 ${rc.effectiveDate}→${fields.effectiveDate}`)
    rc.effectiveDate = fields.effectiveDate
  }
  if (fields.remark != null && fields.remark !== rc.remark) rc.remark = fields.remark
  if (!changes.length) return { changed: false }
  rc.history = rc.history || []
  rc.history.push({ time: dayjs().format('YYYY-MM-DD HH:mm'), operator: operator.name, changes: changes.join('；') })
  logAction('运价管理', '运价调整', `运价卡 ${rc.id} 调价：${changes.join('；')}`)
  notify(`运价卡 ${rc.id} 已调价`, 'system', '/contract', `${changes.join('；')}（仅影响后续新签合同，已派车批次不追溯）`, toRoles('rate', 'contract'))
  return { changed: true, changes }
}

/** 运价卡启停（RBAC：rate）：停用后不再被新合同查表引用 */
export function toggleRateCard(id) {
  const permErr = requireAction('rate')
  if (permErr) return permErr
  const rc = db.rateCards.find((r) => r.id === id)
  if (!rc) return { error: `运价卡 ${id} 不存在` }
  rc.status = rc.status === 'active' ? 'inactive' : 'active'
  logAction('运价管理', rc.status === 'active' ? '启用运价卡' : '停用运价卡', `运价卡 ${rc.id} ${rc.status === 'active' ? '启用' : '停用'}`)
  return { ok: true, status: rc.status }
}

/** 新建运输计划（RBAC：plan）
 *  守卫：合同须执行中；批次数量不超过合同剩余可计划量 */
export function createPlan(payload) {
  const permErr = requireAction('plan')
  if (permErr) return permErr
  const c = contractOf(payload.contractId)
  if (!c) return { error: '请选择合同' }
  if (c.status !== 'executing') return { error: `合同 ${c.id} 当前非"执行中"状态，不可新建计划` }
  if (!payload.quantity || payload.quantity <= 0) return { error: '批次数量须大于 0' }
  const remain = contractRemaining(c.id)
  if (payload.quantity > remain) return { error: `批次数量超出合同剩余可计划量（剩余 ${remain} 吨）` }
  const p = {
    id: genId('YH-', 4, db.plans),
    contractId: c.id,
    commodityId: c.commodityId,
    quantity: payload.quantity,
    loadTerminalId: c.loadTerminalId,
    unloadTerminalId: c.unloadTerminalId,
    mode: c.mode,
    planDate: payload.planDate || dayjs().add(1, 'day').format('YYYY-MM-DD'),
    unitPrice: c.unitPrice,
    status: 'pending',
    progress: 0,
    remark: payload.remark || ''
  }
  db.plans.unshift(p)
  logAction('运输计划', '新建计划', `计划 ${p.id} 创建（合同 ${c.id}，${p.quantity} 吨）`)
  return { ok: true, id: p.id, plan: p }
}

/** 取消计划（RBAC：plan）；守卫：仅"待执行"计划可取消 */
export function cancelPlan(p) {
  const permErr = requireAction('plan')
  if (permErr) return permErr
  if (p.status !== 'pending') return { error: `计划 ${p.id} 当前非"待执行"状态，无法取消` }
  p.status = 'cancelled'
  logAction('运输计划', '取消计划', `计划 ${p.id} 取消（${contractOf(p.contractId)?.name || p.contractId}）`)
  return { ok: true }
}

/** 新建/编辑商品（RBAC：commodity）；守卫：名称必填，新建时重名拦截 */
export function saveCommodity(payload) {
  const permErr = requireAction('commodity')
  if (permErr) return permErr
  const name = String(payload.name || '').trim()
  if (!name) return { error: '请输入商品名称' }
  if (payload.id) {
    const c = db.commodities.find((x) => x.id === payload.id)
    if (!c) return { error: '商品不存在' }
    if (db.commodities.some((x) => x.id !== c.id && x.name === name)) return { error: `商品名称「${name}」已存在` }
    Object.assign(c, {
      name,
      category: payload.category || c.category,
      unit: payload.unit || c.unit,
      density: payload.density || c.density,
      price: payload.price || 0
    })
    logAction('商品管理', '编辑商品', `商品 ${c.id} 更新：${name}`)
    return { ok: true, id: c.id }
  }
  if (db.commodities.some((x) => x.name === name)) return { error: `商品名称「${name}」已存在` }
  const c = {
    id: genId('CM', 3, db.commodities),
    name,
    category: payload.category || '煤炭',
    unit: payload.unit || '吨',
    density: payload.density || 1,
    price: payload.price || 0,
    indicators: [{ name: '质量要求', value: '按合同约定' }],
    status: 'active',
    totalVolume: 0,
    remark: ''
  }
  db.commodities.push(c)
  logAction('商品管理', '新建商品', `商品 ${c.id} 创建：${name}`)
  return { ok: true, id: c.id }
}

/** 商品启用/停用（RBAC：commodity） */
export function toggleCommodityStatus(c) {
  const permErr = requireAction('commodity')
  if (permErr) return permErr
  c.status = c.status === 'active' ? 'inactive' : 'active'
  logAction('商品管理', c.status === 'active' ? '启用商品' : '停用商品', `商品 ${c.name} ${c.status === 'active' ? '启用' : '停用'}`)
  return { ok: true }
}

/** 客户冻结/解冻（RBAC：customer） */
export function toggleCustomerStatus(c) {
  const permErr = requireAction('customer')
  if (permErr) return permErr
  if (c.status === 'active') {
    c.status = 'frozen'
    logAction('客户管理', '客户冻结', `客户 ${c.name} 冻结，不可新建合同`)
  } else {
    c.status = 'active'
    logAction('客户管理', '客户解冻', `客户 ${c.name} 解冻，恢复合作`)
  }
  return { ok: true }
}

/** 司机停用/启用（RBAC：driver）
 *  守卫：有执行中车次（装货/在途/卸货）的司机不可停用；停用联动司机账号（G5 driverId 绑定） */
export function toggleDriverStatus(d) {
  const permErr = requireAction('driver')
  if (permErr) return permErr
  if (d.status === 'disabled') {
    d.status = 'available'
    logAction('司机管理', '司机启用', `司机 ${d.name} 启用，恢复可派单`)
  } else {
    if (db.dispatches.some((x) => x.driverId === d.id && ACTIVE.includes(x.status))) {
      return { error: `司机 ${d.name} 有执行中车次，无法停用` }
    }
    d.status = 'disabled'
    logAction('司机管理', '司机停用', `司机 ${d.name} 停用，不可派单`)
  }
  const u = db.users.find((x) => x.driverId === d.id)
  if (u) u.status = d.status === 'disabled' ? 'disabled' : 'active'
  return { ok: true }
}

/** 车辆报修（RBAC：vehicle）；守卫：仅空闲车辆可报修 */
export function sendVehicleRepair(v, reason) {
  const permErr = requireAction('vehicle')
  if (permErr) return permErr
  if (v.status !== 'idle') return { error: `车辆 ${v.plate} 当前非"空闲"状态，无法报修` }
  v.status = 'maintenance'
  logAction('车辆管理', '车辆报修', `车辆 ${v.plate} 报修：${reason || '未填写原因'}`)
  return { ok: true }
}

/** 车辆维修完成恢复空闲（RBAC：vehicle）；守卫：仅维修中车辆可恢复 */
export function resumeVehicle(v) {
  const permErr = requireAction('vehicle')
  if (permErr) return permErr
  if (v.status !== 'maintenance') return { error: `车辆 ${v.plate} 当前非"维修中"状态，无法恢复` }
  v.status = 'idle'
  logAction('车辆管理', '车辆恢复', `车辆 ${v.plate} 维修完成，恢复空闲`)
  return { ok: true }
}

/** 库存批次状态操作（RBAC：warehouse）；守卫：状态合法且不重复
 *  status: locked 锁定 / normal 解锁 / near-expiry 标记临期
 *  环节7：锁定/标记临期会减少可发库存，若因此跌破安全库存下限（穿越阈值）发出预警 */
export function setInventoryStatus(inv, status) {
  const permErr = requireAction('warehouse')
  if (permErr) return permErr
  if (!['locked', 'normal', 'near-expiry'].includes(status)) return { error: '无效的库存状态' }
  if (inv.status === status) return { error: `批次 ${inv.batch} 已处于该状态，无需重复操作` }
  const wh = db.warehouses.find((w) => w.id === inv.warehouseId)
  const beforeAvail = availableStockOf(inv.warehouseId, inv.commodityId)
  inv.status = status
  const label = { locked: '库存锁定', normal: '库存解锁', 'near-expiry': '标记临期' }[status]
  logAction('仓储管理', label, `批次 ${inv.batch} ${label} ${inv.quantity} 吨`)
  if (wh && status !== 'normal') checkInventoryAlert(wh, inv.commodityId, beforeAvail)
  return { ok: true }
}

/** 设置安全库存下限（RBAC：warehouse）；按仓库×商品 upsert，minQty 为可发库存告警下限（吨） */
export function setSafetyStock(warehouseId, commodityId, minQty) {
  const permErr = requireAction('warehouse')
  if (permErr) return permErr
  const wh = db.warehouses.find((w) => w.id === warehouseId)
  if (!wh) return { error: '仓库不存在' }
  const cm = db.commodities.find((c) => c.id === commodityId)
  if (!cm) return { error: '商品不存在' }
  const qty = Number(minQty)
  if (!Number.isFinite(qty) || qty < 0) return { error: '安全库存下限须为不小于 0 的数字' }
  db.safetyStocks = db.safetyStocks || []
  let sq = safetyStockOf(warehouseId, commodityId)
  if (sq) {
    sq.minQty = Math.round(qty)
  } else {
    sq = { id: genId('SQ-', 4, db.safetyStocks), warehouseId, commodityId, minQty: Math.round(qty) }
    db.safetyStocks.push(sq)
  }
  logAction('仓储管理', '设置安全库存', `${wh.name} ${cm.name} 安全库存下限设为 ${sq.minQty} 吨`)
  return { ok: true, id: sq.id }
}

/** 新建/编辑用户（RBAC：user）；守卫：账号查重、新建须设密码 */
export function saveUser(payload) {
  const permErr = requireAction('user')
  if (permErr) return permErr
  const username = String(payload.username || '').trim()
  if (!String(payload.name || '').trim()) return { error: '请填写姓名' }
  if (!username) return { error: '请填写登录账号' }
  if (payload.id) {
    const u = db.users.find((x) => x.id === payload.id)
    if (!u) return { error: '用户不存在' }
    Object.assign(u, {
      name: String(payload.name).trim(),
      role: payload.role || u.role,
      phone: payload.phone || u.phone,
      email: payload.email || u.email
    })
    logAction('系统管理', '编辑用户', `用户 ${u.username} 信息更新`)
    return { ok: true, id: u.id }
  }
  if (db.users.some((x) => x.username === username)) return { error: `账号 ${username} 已存在，请更换登录账号` }
  if (!payload.password) return { error: '请设置登录密码' }
  const u = {
    id: genId('U', 3, db.users),
    username,
    name: String(payload.name).trim(),
    // 环节9：只存密码哈希，不落明文
    passwordHash: hashPassword(payload.password),
    role: payload.role || '调度员',
    phone: payload.phone || '-',
    email: payload.email || '-',
    status: 'active',
    lastLogin: '-',
    createdAt: dayjs().format('YYYY-MM-DD')
  }
  db.users.push(u)
  logAction('系统管理', '新增用户', `新增用户 ${u.username}（${u.role}）`)
  return { ok: true, id: u.id }
}

/** 删除用户（RBAC：user）；守卫：不可删除当前登录账号 */
export function removeUser(u) {
  const permErr = requireAction('user')
  if (permErr) return permErr
  if (u.username === operator.username) return { error: '不能删除当前登录账号' }
  const idx = db.users.findIndex((x) => x.id === u.id)
  if (idx > -1) db.users.splice(idx, 1)
  logAction('系统管理', '删除用户', `删除用户 ${u.username}`)
  return { ok: true }
}

/** 用户启用/停用（RBAC：user）；守卫：不可停用当前登录账号 */
export function toggleUserStatus(u, active) {
  const permErr = requireAction('user')
  if (permErr) return permErr
  if (u.username === operator.username && !active) return { error: '不能停用当前登录账号' }
  u.status = active ? 'active' : 'disabled'
  logAction('系统管理', active ? '启用用户' : '停用用户', `用户 ${u.username} ${active ? '启用' : '停用'}`)
  return { ok: true }
}

/** 新建角色（RBAC：role）；守卫：名称/编码查重；新建角色默认无任何权限（deny） */
export function saveRole(payload) {
  const permErr = requireAction('role')
  if (permErr) return permErr
  const name = String(payload.name || '').trim()
  const code = String(payload.code || '').trim()
  if (!name || !code) return { error: '请填写角色名称和编码' }
  if (db.roles.some((r) => r.name === name || r.code === code)) return { error: '角色名称或编码已存在，请更换' }
  const r = {
    id: genId('R', 3, db.roles),
    name,
    code,
    userCount: 0,
    description: payload.description || '—',
    builtIn: false
  }
  db.roles.push(r)
  db.rolePerms[name] = { menus: [], actions: [] }
  logAction('系统管理', '新增角色', `新增角色 ${name}（${code}），默认无权限`)
  return { ok: true, id: r.id }
}

/** 删除角色（RBAC：role）；守卫：内置角色不可删；角色下仍有用户不可删 */
export function removeRole(role) {
  const permErr = requireAction('role')
  if (permErr) return permErr
  if (role.builtIn) return { error: `内置角色 ${role.name} 不可删除` }
  const count = db.users.filter((u) => u.role === role.name).length
  if (count > 0) return { error: `角色下还有 ${count} 名用户，无法删除` }
  const idx = db.roles.findIndex((r) => r.id === role.id)
  if (idx > -1) db.roles.splice(idx, 1)
  delete db.rolePerms[role.name]
  logAction('系统管理', '删除角色', `删除角色 ${role.name}`)
  return { ok: true }
}

/** 更新角色权限（RBAC：role）；perm: { menus: null|[], actions: null|[] }，null=全部，[]=无 */
export function updateRolePerms(roleName, perm) {
  const permErr = requireAction('role')
  if (permErr) return permErr
  db.rolePerms[roleName] = perm
  logAction(
    '系统管理',
    '角色权限更新',
    `角色 ${roleName} 权限更新：${perm.menus === null && perm.actions === null ? '全部权限' : `菜单 ${perm.menus?.length || 0} 项、操作 ${perm.actions?.length || 0} 项`}`
  )
  return { ok: true }
}

/** 启动时全量校准：计划/合同进度与调度实际执行对齐 */
export function recalcAll() {
  // 多式联运口径校准：调度单补运输方式；铁路/水运/管道按运输单元执行，不绑定车辆/司机
  for (const d of db.dispatches) {
    if (!d.mode) d.mode = contractOf(d.contractId)?.mode || '公路'
    if (!isRoadMode(d.mode)) {
      d.vehicleId = null
      d.driverId = null
      if (!d.unitNo) d.unitNo = unitNoOf(d.mode, d.id)
    }
  }
  // 车辆/司机状态与实际执行对齐（N-2 关联修复：种子在途车次须占用车辆/司机，
  // 杜绝"在途但标空闲"被二次派车；运行时占用/释放口径不变——发车占用、完成释放）
  for (const v of db.vehicles) {
    if (v.status === 'scrapped' || v.status === 'maintenance') continue
    const active = db.dispatches.some((x) => x.vehicleId === v.id && ACTIVE.includes(x.status))
    if (active && v.status !== 'inuse') v.status = 'inuse'
    else if (!active && v.status === 'inuse') v.status = 'idle'
  }
  for (const dr of db.drivers) {
    if (dr.status === 'disabled') continue
    const active = db.dispatches.some((x) => x.driverId === dr.id && ACTIVE.includes(x.status))
    if (active && dr.status !== 'onduty') dr.status = 'onduty'
    else if (!active && dr.status === 'onduty') dr.status = 'available'
  }
  for (const p of db.plans) {
    if (p.status === 'cancelled') continue
    const ds = db.dispatches.filter((x) => x.planId === p.id)
    if (!ds.length) {
      p.progress = 0
      continue
    }
    const doneQty = ds.filter((x) => x.status === 'completed').reduce((s, x) => s + x.quantity, 0)
    p.progress = Math.min(100, Math.round((doneQty / p.quantity) * 100))
    const allDone = ds.every((x) => x.status === 'completed')
    const active = ds.some((x) => ACTIVE.includes(x.status) || x.status === 'exception')
    if (allDone) p.status = 'completed'
    else if (active || doneQty > 0) p.status = 'intransit'
    else p.status = 'dispatched'
  }
  for (const c of db.contracts) {
    if (c.status !== 'executing') continue
    const doneQty = db.dispatches
      .filter((x) => x.contractId === c.id && x.status === 'completed')
      .reduce((s, x) => s + x.quantity, 0)
    c.progress = Math.min(100, Math.round((doneQty / c.quantity) * 100))
    if (c.progress >= 100) c.status = 'completed'
  }
  for (const s of db.settlements) recalcSettlementStatus(s)
}

recalcAll()
