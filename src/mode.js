/**
 * 双模式 feature flag（Phase 4 阶段 3：演示模式 / 生产模式）。
 *
 *  - 演示模式（demo）：现有内存引擎（flow.js + 本地响应式 db，快照 hydrate），
 *    现有 556 npm 断言 + 82 verify-ui E2E 继续有效。
 *  - 生产模式（production）：薄客户端——已迁移页面从后端 /api 读权威态（useCollection），
 *    不再依赖本地内存引擎的读；未迁移页面忽略本 flag（仍走内存引擎）。
 *
 * 取值优先级：localStorage（运行时手动切换，调试/E2E 可控）> 构建默认值 DEFAULT_MODE。
 * 过渡期默认 demo；阶段 3 首个列表页（合同管理）迁移并验证后翻转为 production（已拍板决策 2）。
 * 未迁移页面不受翻转影响（按页 opt-in）。
 */
const KEY = 'blms_app_mode'
// 阶段 3（合同管理列表）已迁移并验证（verify-ui scenario 20 全绿）→ 默认 production。
// 未迁移页面按页 opt-in，不受影响；演示模式仍可经 localStorage 运行时切回（调试/E2E）。
export const DEFAULT_MODE = 'production'

export function appMode() {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'demo' || v === 'production') return v
  } catch (e) { /* localStorage 不可用（node）→ 默认 */ }
  return DEFAULT_MODE
}

export function isProduction() {
  return appMode() === 'production'
}

/** 运行时切换模式（写 localStorage；调用方负责刷新页面/重取数据） */
export function setMode(mode) {
  try {
    if (mode === 'demo' || mode === 'production') localStorage.setItem(KEY, mode)
  } catch (e) { /* 忽略 */ }
}

/** 清除运行时覆盖，回到构建默认值 */
export function clearModeOverride() {
  try { localStorage.removeItem(KEY) } catch (e) { /* 忽略 */ }
}
