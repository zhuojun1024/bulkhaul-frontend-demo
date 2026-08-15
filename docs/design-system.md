# 设计系统 · 大宗物流综合管理平台

- **品牌色**：`#2b5ce6`
- **风格**：modern（管理后台）
- **栅格**：8pt · **基础字号**：14px
- **组件库**：Element Plus 2.x（主题通过 CSS 变量覆盖）
- **生成日期**：2026-08-15（ui-design-system skill）

## 文件结构

| 文件 | 用途 |
|------|------|
| `src/styles/tokens.css` | 全部设计令牌（CSS 自定义属性），`main.js` 中先于 `index.css` 引入 |
| `src/styles/index.css` | Element Plus 主题映射 + 全局基础样式（只引用令牌） |
| `src/utils/tokens.js` | JS 令牌访问器 `useTokens()`：运行时读取 CSS 变量，供 ECharts/canvas 等 JS 场景使用 |
| `design-tokens.json` | 令牌 JSON 导出，供 Figma（Tokens Studio）/ 工具链使用 |

## 颜色体系

### 结构

```
原始令牌（色阶）          语义令牌（组件使用）
--color-primary-50…900  →  --color-primary / -hover / -active / -light / -text
--color-neutral-50…900  →  --text-primary / -regular / -secondary / --border-color …
--color-success-50…900  →  --color-success / -bg / -text（warning/danger/info 同构）
```

### 色阶使用规则

| 步位 | 用途 |
|------|------|
| 50–100 | 状态背景、选中/hover 浅底（如 `--color-success-bg`） |
| 200–300 | 边框、禁用描边 |
| 400–500 | 图标、装饰图形 |
| 500（主色）/ 600（语义色） | 基准色：按钮、标签、图标 |
| 600–700 | 悬停/按下加深 |
| **700** | **小字号状态文本（唯一满足 AA 的文本色位）** |
| 800–900 | 深色底、标题强调 |

> ⚠️ 语义基准色（600）对比度不足 4.5:1，**禁止用于 14px 及以下文本**，文本一律用 `-text`（700）变体。

### WCAG 对比度（实测）

| 组合 | 对比度 | 结论 |
|------|--------|------|
| `#2b5ce6` 主色 / 白底 | 5.56:1 | ✅ AA（可用于文本、链接） |
| 白字 / 主色按钮 | 5.56:1 | ✅ AA |
| 白字 / 主色 dark-2 `#224ab8` | 7.67:1 | ✅ AAA |
| success-700 `#007e1d` / 白底 | 5.25:1 | ✅ AA |
| warning-700 `#b25800` / 白底 | 4.90:1 | ✅ AA |
| danger-700 `#ac2c2c` / 白底 | 6.67:1 | ✅ AA |
| info-700 `#5e656d` / 白底 | 5.90:1 | ✅ AA |
| 各语义 700 / 对应 50 浅底（徽章） | 4.72–6.32:1 | ✅ AA |
| 文本 900 `#1d2129` / 页面底 `#f4f6fa` | 14.91:1 | ✅ AAA |
| 文本 700 `#4e5969` / 页面底 | 6.56:1 | ✅ AA |
| success 基准 `#00b42a` / 白底 | 2.78:1 | ❌ 仅限图标/图形/大字 |
| warning 基准 `#ff7d00` / 白底 | 2.57:1 | ❌ 仅限图标/图形/大字 |
| danger 基准 `#f53f3f` / 白底 | 3.71:1 | ⚠️ 仅限大字（≥18pt）或图形 |
| info 基准 `#86909c` / 白底 | 3.24:1 | ⚠️ 仅限大字或图形 |
| 次要文本 `#86909c` / 页面底 | 2.99:1 | ⚠️ 现有设计沿用，仅用于低重要文本 |
| 白字 / 侧边栏 `#101a33` | 17.25:1 | ✅ AAA |

## 字体

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--font-sans` | 系统字体栈（含 PingFang SC / 微软雅黑） | 全局 |
| `--font-numeric` | DIN Alternate / Bahnschrift | 数字（`.num` 类） |
| `--font-mono` | JetBrains Mono / Fira Code | 代码、单号 |

字号：`xs 12 / sm 13 / base 14 / lg 15 / xl 16 / 2xl 18 / 3xl 20 / 4xl 24 / 5xl 30`（px）
字重：`regular 400 / medium 500 / semibold 600 / bold 700`
行高：`tight 1.25 / normal 1.5 / relaxed 1.75`

## 间距（8pt）

数值令牌：`--space-0/1/2/4/8/12/16/20/24/32/40/48/64`
语义令牌：`xs 4 / sm 8 / md 12 / lg 16 / xl 24 / 2xl 32 / 3xl 48`

常用：页面内边距 `lg 16`，卡片内边距 `20`，栅格间隙 `md 12`，区块间距 `lg 16`。

## 圆角 / 阴影 / 动效 / 层级

| 类别 | 令牌 |
|------|------|
| 圆角 | `sm 4 / base 6（输入框、按钮）/ md 8（卡片）/ lg 10（弹窗）/ full` |
| 阴影 | `sm`（卡片）`md` `lg`（下拉）`xl`（弹窗）`2xl` `inner`，统一 `rgba(16,24,40,α)` 冷调 |
| 时长 | `fast 150 / base 250 / slow 350 / slower 500` ms |
| 缓动 | `--ease-standard: cubic-bezier(0.645,0.045,0.355,1)`（与 Element Plus 一致） |
| z-index | `base 0 → notification 1400`；**Element Plus 弹层自管 2000+，自定义元素勿超 1400** |

## Element Plus 映射

`index.css` 中 `:root` 覆盖以下变量（主色混色为精确值：light-N = N% 白，dark-2 = 20% 黑）：

```css
--el-color-primary:            #2b5ce6
--el-color-primary-light-3:    #6b8dee   /* hover */
--el-color-primary-light-5:    #95aef2
--el-color-primary-light-7:    #bfcef8
--el-color-primary-light-8:    #d5defa
--el-color-primary-light-9:    #eaeffc   /* 浅底 */
--el-color-primary-dark-2:     #224ab8   /* active */
--el-color-success/warning/danger/error/info: 语义色 600
--el-border-radius-base:       6px
```

## 使用示例

```css
/* ✅ 正确：只引用令牌 */
.status-tag {
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
}

/* ❌ 错误：硬编码 */
.status-tag { color: #f53f3f; background: #fff7f7; }
```

```vue
<!-- 组件中需要动态状态色时，优先用 el-tag 的 type 属性，
     由 EP 主题变量自动取色，避免手写 hex -->
<el-tag :type="level === 'high' ? 'danger' : 'warning'">高水位</el-tag>
```

## 变更品牌色

1. 修改 `tokens.css` 中 `--color-primary-500`（其余 9 个色阶按同算法重新生成：50–400 向白混合 95/90/80/65/50%，600–900 向黑混合 15/30/50/70%）
2. 更新 `index.css` 中 6 个 `--el-color-primary-*` 混色值
3. 同步 `design-tokens.json`
4. 重新跑对比度校验（主色/白底 ≥ 4.5:1）

## 组件层令牌化（2026-08-15 已完成）

- 32 个 `.vue` 文件的硬编码 hex 已全部替换：CSS → `var(--*)`；模板属性（StatCard/el-icon/el-rate/el-menu）→ `var()` 字符串；ECharts/状态色映射 → `useTokens()`
- SVG 表现属性（stroke/fill/stop-color）改为 `style="…var()"`（表现属性不支持 var()）
- **例外**：3 个详情页（contract/settlement/dispatch）打印窗口的 HTML 字符串保留 hex——独立打印文档读不到 CSS 变量

## 待办（后续迭代）

- [ ] 次要文本 `#86909c` 用于 12–13px 文本处，评估升级为 `--color-neutral-600`（#6b7785，AA 达标）
