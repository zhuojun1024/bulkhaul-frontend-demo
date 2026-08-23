import { watch } from 'vue'
import { db } from './base'

/**
 * 数据持久化（localStorage 起步）
 * - 启动时 hydrateDb：若存在同版本快照则恢复 db（覆盖种子数据）
 * - 运行中 enableAutoSave：深度监听 db，防抖 800ms 写快照
 * - resetDb：清除快照并刷新，回到种子数据
 * 快照带版本号，结构升级后自动丢弃旧快照。
 */
const KEY = 'blms_db_snapshot'
// 结构升级（调度单增加 accepted、事故与异常单建立关联等）后递增，自动丢弃旧快照
// v3：角色权限表数据化（db.rolePerms）、结算调整记录（adjustments/settleApplied）、种子磅单皮重按车辆派生
// v4：围栏参数（db.fenceConfig）、围栏事件记忆（dispatch.fenceAlerted）、合同审批链（approvalChain）、
//     培训参训司机（training.driverIds）、客户角色与门户账号（roles/users）、客户确认对账（settlement.customerConfirmed）
// v5：客户运输需求（db.transportRequests）、客户发起需求权限（customer-request）
// v6：司机账号（司机角色 users，手机号登录）、消息中心（db.messages）、银行流水（db.bankRecords）
// v7：车辆/司机乐观锁版本字段（version，P2 并发控制）
// v8：种子车辆/司机状态与实际执行对齐（在途车次占用车辆/司机，N-2 关联修复）
// v9：消息定向（to 字段，M4 修复）；对账差异/损耗金额按车次快照单价（M2）
// v10：登录安全（环节9）——用户表 password 改 passwordHash（SHA-256 哈希，不落明文）
const VERSION = 10

const canUse = typeof window !== 'undefined' && !!window.localStorage

/** 是否存在可用快照 */
export function hasPersisted() {
  if (!canUse) return false
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    const saved = JSON.parse(raw)
    return !!saved && saved.__v === VERSION
  } catch (e) {
    return false
  }
}

/** P3 并发保护：本标签页上次写入快照的时间戳（跨标签页冲突判定基准） */
let lastSavedTs = 0

/** 启动时恢复快照（需在全部种子模块加载完成后调用）；无快照/版本不符返回 false */
export function hydrateDb() {
  if (!canUse) return false
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    const saved = JSON.parse(raw)
    if (!saved || saved.__v !== VERSION) return false
    const data = { ...saved }
    delete data.__v
    delete data.__ts
    Object.assign(db, data)
    lastSavedTs = saved.__ts || 0
    return true
  } catch (e) {
    return false
  }
}

/** 写快照（深拷贝，避免 reactive 代理引用）
 *  P3 并发保护：快照带写入时间戳 __ts；若其他标签页在本页上次保存后写入了更新快照（__ts 更新），
 *  跳过本次写入以避免 last-write-wins 静默覆盖（演示环境轻量保护，提示刷新同步） */
export function saveDb() {
  if (!canUse) return
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      if (saved && saved.__v === VERSION && (saved.__ts || 0) > lastSavedTs) {
        console.warn('[持久化] 检测到其他标签页的更新快照，本次写入已跳过以避免覆盖；请刷新页面同步最新数据')
        return
      }
    }
    const plain = JSON.parse(JSON.stringify(db))
    lastSavedTs = Date.now()
    localStorage.setItem(KEY, JSON.stringify({ __v: VERSION, __ts: lastSavedTs, ...plain }))
  } catch (e) {
    // 存储配额不足等异常：静默忽略，不影响业务
  }
}

let timer = null
/** 开启自动保存：深度监听 db 变化，防抖写快照（浏览器环境生效） */
export function enableAutoSave() {
  if (!canUse) return
  watch(
    db,
    () => {
      clearTimeout(timer)
      timer = setTimeout(saveDb, 800)
    },
    { deep: true }
  )
}

/** 重置演示数据：清除快照并刷新页面 */
export function resetDb() {
  if (!canUse) return
  localStorage.removeItem(KEY)
  window.location.reload()
}
