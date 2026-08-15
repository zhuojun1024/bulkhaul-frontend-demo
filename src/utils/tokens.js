/**
 * 设计令牌 JS 访问器
 * ------------------------------------------------------------
 * 运行时读取 :root 上的 CSS 自定义属性（src/styles/tokens.css），
 * 供 ECharts / canvas / 组件 prop 等 JS 场景使用。
 *
 * 规则：
 *   - CSS 样式一律直接写 var(--*)，不要经过本模块
 *   - 仅在 JS 中需要真实色值时使用 useTokens()
 *   - 打印窗口等独立文档无法读取 CSS 变量，保留 hex 字面量
 */

const FALLBACKS = {
  '--color-primary': '#2b5ce6',
  '--color-primary-400': '#95aef2',
  '--color-success': '#00b42a',
  '--color-success-200': '#c7eed0',
  '--color-success-400': '#6bd483',
  '--color-warning': '#ff7d00',
  '--color-warning-200': '#ffe2c7',
  '--color-danger': '#f53f3f',
  '--color-danger-200': '#fdd5d5',
  '--color-info': '#86909c',
  '--color-neutral-50': '#f7f8fa',
  '--color-neutral-100': '#f2f3f5',
  '--color-neutral-200': '#e5e6eb',
  '--color-neutral-300': '#c9cdd4',
  '--color-chart-purple': '#722ed1',
  '--color-chart-cyan': '#13c2c2',
  '--color-chart-pink': '#eb2f96',
  '--text-primary': '#1d2129',
  '--text-regular': '#4e5969',
  '--text-secondary': '#86909c',
  '--border-color': '#e5e6eb',
  '--bg-card': '#ffffff'
}

let tokens = null

export function useTokens() {
  if (tokens) return tokens
  const style = getComputedStyle(document.documentElement)
  const read = (name) => style.getPropertyValue(name).trim() || FALLBACKS[name]
  tokens = {
    primary: read('--color-primary'),
    primary400: read('--color-primary-400'),
    success: read('--color-success'),
    success200: read('--color-success-200'),
    success400: read('--color-success-400'),
    warning: read('--color-warning'),
    warning200: read('--color-warning-200'),
    danger: read('--color-danger'),
    danger200: read('--color-danger-200'),
    info: read('--color-info'),
    neutral50: read('--color-neutral-50'),
    neutral100: read('--color-neutral-100'),
    neutral200: read('--color-neutral-200'),
    neutral300: read('--color-neutral-300'),
    chartPurple: read('--color-chart-purple'),
    chartCyan: read('--color-chart-cyan'),
    chartPink: read('--color-chart-pink'),
    textPrimary: read('--text-primary'),
    textRegular: read('--text-regular'),
    textSecondary: read('--text-secondary'),
    border: read('--border-color'),
    card: read('--bg-card')
  }
  return tokens
}

export default useTokens
