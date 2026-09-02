import { USE_API, api, refreshDb } from '@/api'

/**
 * 定时任务层（薄客户端，Phase 4 F3）：
 * 真实系统中围栏事件 / GPS 遥测 / 逾期标记由后端定时任务驱动；
 * 浏览器中前端每 3s 调 POST /api/scheduler/tick（后端执行 5 心跳）+ 快照刷新 db，
 * UI 通过 onSchedulerEvent 订阅"后端推送"事件（等价 WebSocket/长轮询）。
 * 内存引擎已移除（F3）：不再有本地 runTickLocal，全部由后端权威执行。
 */

const listeners = new Set()

/** 订阅定时任务事件：{ type: 'fence', created } 围栏异常单生成 / { type: 'escalate' } 升级 / { type: 'tick' } 每轮完成；返回取消订阅函数 */
export function onSchedulerEvent(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(e) {
  for (const cb of [...listeners]) {
    try {
      cb(e)
    } catch (err) {
      // 监听器异常不影响定时任务
    }
  }
}

/** 单轮定时任务（导出供冒烟测试调用）：
 * 浏览器态异步调后端 /api/scheduler/tick + 快照刷新，再发 tick 事件驱动 UI 更新；
 * node 态（USE_API=false，纯内存无后端）为空操作。 */
export function runSchedulerTick() {
  if (!USE_API) return
  api('POST', '/scheduler/tick')
    .then(() => refreshDb())
    .then(() => emit({ type: 'tick' }))
    .catch((e) => console.warn('[scheduler] tick 失败：', e && e.message))
}

let timer = null

/** 启动全局定时任务（应用启动时调用一次，重复调用幂等） */
export function startScheduler(intervalMs = 3000) {
  if (timer) return timer
  timer = setInterval(runSchedulerTick, intervalMs)
  return timer
}

/** 停止全局定时任务 */
export function stopScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
