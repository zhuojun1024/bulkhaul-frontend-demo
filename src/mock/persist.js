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
const VERSION = 2

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
    Object.assign(db, data)
    return true
  } catch (e) {
    return false
  }
}

/** 写快照（深拷贝，避免 reactive 代理引用） */
export function saveDb() {
  if (!canUse) return
  try {
    const plain = JSON.parse(JSON.stringify(db))
    localStorage.setItem(KEY, JSON.stringify({ __v: VERSION, ...plain }))
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
