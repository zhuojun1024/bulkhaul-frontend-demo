import { advanceTelemetry, checkFenceEvents, recalcOverdueAll, escalatePendingExceptions, escalateContractApprovals } from './flow'

/**
 * 后端定时任务模拟层（P2 架构下沉）：
 * 真实系统中围栏事件 / GPS 遥测 / 逾期标记由后端定时任务（cron + 遥测管道）驱动；
 * 演示环境用全局定时器模拟，独立于任何页面生命周期——
 * 围栏异常、在途进度、逾期状态不再依赖"监控页打开"（原实现由监控页 3s tick 驱动，页面不开就不产生围栏异常）。
 * UI 通过 onSchedulerEvent 订阅"后端推送"事件（对接后等价于 WebSocket/长轮询）。
 */

const listeners = new Set()

/** 订阅定时任务事件：{ type: 'fence', created } 围栏异常单生成 / { type: 'tick' } 每轮完成；返回退订函数 */
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

/** 单轮定时任务（导出供冒烟测试同步调用）：遥测推进 → 围栏事件 → 逾期校准 → 异常/审批升级 */
export function runSchedulerTick() {
  advanceTelemetry()
  const created = checkFenceEvents()
  if (created.length) emit({ type: 'fence', created })
  recalcOverdueAll()
  const escalated = escalatePendingExceptions()
  if (escalated.length) emit({ type: 'escalate', created: escalated })
  escalateContractApprovals()
  emit({ type: 'tick' })
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
