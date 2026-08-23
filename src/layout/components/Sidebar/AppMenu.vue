<template>
  <nav class="app-menu" aria-label="主导航">
    <div ref="scrollRef" class="app-menu__scroll" @keydown="onKeydown">
      <!-- ===== 展开态：文字菜单（手风琴，unique-opened） ===== -->
      <ul v-if="!collapsed" class="app-menu__list" role="menu">
        <template v-for="item in items" :key="item.path">
          <!-- 含子菜单的分组 -->
          <li v-if="item.children" role="none">
            <button
              type="button"
              role="menuitem"
              class="app-menu__group"
              :class="{
                'is-open': expanded === item.path,
                'is-active-group': activeGroup?.path === item.path
              }"
              :data-path="item.path"
              :aria-expanded="expanded === item.path"
              @click="toggleGroup(item.path)"
            >
              <el-icon class="app-menu__icon"><component :is="item.meta.icon" /></el-icon>
              <span class="app-menu__label">{{ item.meta.title }}</span>
              <el-icon class="app-menu__chevron"><ArrowRight /></el-icon>
            </button>
            <!-- 展开动画：grid 0fr→1fr（无需 JS 测量高度）；收起时内容延迟移出 a11y 树 -->
            <div class="app-menu__sub" :class="{ 'is-open': expanded === item.path }">
              <div class="app-menu__sub-inner">
                <ul class="app-menu__sub-list" role="group" :aria-label="item.meta.title">
                  <li v-for="child in item.children" :key="child.path" role="none">
                    <button
                      type="button"
                      role="menuitem"
                      class="app-menu__item"
                      :class="{ 'is-active': active === child.path }"
                      :aria-current="active === child.path ? 'page' : undefined"
                      @click="navigate(child.path)"
                    >
                      <el-icon class="app-menu__icon app-menu__icon--sm">
                        <component :is="child.meta.icon" />
                      </el-icon>
                      <span class="app-menu__label">{{ child.meta.title }}</span>
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </li>
          <!-- 无子菜单的顶级项 -->
          <li v-else role="none">
            <button
              type="button"
              role="menuitem"
              class="app-menu__item app-menu__item--root"
              :class="{ 'is-active': active === item.path }"
              :aria-current="active === item.path ? 'page' : undefined"
              @click="navigate(item.path)"
            >
              <el-icon class="app-menu__icon"><component :is="item.meta.icon" /></el-icon>
              <span class="app-menu__label">{{ item.meta.title }}</span>
            </button>
          </li>
        </template>
      </ul>

      <!-- ===== 收起态：仅图标；分组 hover 弹子菜单，顶级项 hover 显示 tooltip ===== -->
      <ul v-else class="app-menu__list app-menu__list--collapsed" role="menu">
        <template v-for="item in items" :key="item.path">
          <li v-if="item.children" role="none">
            <el-popover
              placement="right-start"
              :width="176"
              trigger="hover"
              :show-after="100"
              :hide-after="100"
              :show-arrow="false"
              popper-class="sidebar-collapsed-popper"
            >
              <template #reference>
                <button
                  type="button"
                  role="menuitem"
                  class="app-menu__icon-btn"
                  :class="{ 'is-active-group': activeGroup?.path === item.path }"
                  :aria-label="item.meta.title"
                >
                  <el-icon class="app-menu__icon"><component :is="item.meta.icon" /></el-icon>
                  <el-icon class="app-menu__chevron app-menu__chevron--collapsed"><ArrowRight /></el-icon>
                </button>
              </template>
              <div class="sidebar-collapsed-popper__title">{{ item.meta.title }}</div>
              <button
                v-for="child in item.children"
                :key="child.path"
                type="button"
                role="menuitem"
                class="sidebar-collapsed-popper__item"
                :class="{ 'is-active': active === child.path }"
                @click="navigate(child.path)"
              >
                <el-icon class="app-menu__icon app-menu__icon--sm">
                  <component :is="child.meta.icon" />
                </el-icon>
                <span>{{ child.meta.title }}</span>
              </button>
            </el-popover>
          </li>
          <li v-else role="none">
            <!-- el-tooltip 的触发元素是默认插槽；#reference 是 el-popover 的插槽，写在 tooltip 里不会渲染 -->
            <el-tooltip :content="item.meta.title" placement="right" :show-after="300">
              <button
                type="button"
                role="menuitem"
                class="app-menu__icon-btn"
                :class="{ 'is-active': active === item.path }"
                :aria-label="item.meta.title"
                @click="navigate(item.path)"
              >
                <el-icon class="app-menu__icon"><component :is="item.meta.icon" /></el-icon>
              </button>
            </el-tooltip>
          </li>
        </template>
      </ul>
    </div>
  </nav>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

/**
 * AppMenu · 自研侧边栏菜单
 * ------------------------------------------------------------
 * 能力（对齐原 el-menu 用法）：
 *   - router 模式：点击导航，当前页重复点击忽略（避免重复导航）
 *   - unique-opened：同一时间仅展开一个分组，点击组标题开/合
 *   - 激活项变化时自动展开其所属分组（详情页经 meta.activeMenu 归位父菜单）
 *   - 收起态：仅图标；分组 hover 弹子菜单（含组名标题），顶级项 hover 显示 tooltip
 *   - 键盘（展开态）：↑↓ 移动焦点，Home/End 首尾，→ 展开分组并聚焦首个子项，← 收起
 *
 * 数据契约：items 为权限过滤后的菜单路由
 *   [{ path, meta: { title, icon }, children?: [{ path, meta }] }]
 * icon 为 Element Plus 图标组件名（main.js 已全局注册）
 */
const props = defineProps({
  items: { type: Array, required: true },
  /** 当前激活路径（调用方已将详情页映射到父菜单） */
  active: { type: String, default: '' },
  /** 收起态（仅图标） */
  collapsed: { type: Boolean, default: false }
})

const router = useRouter()

/** unique-opened：当前展开的分组 path，null 为全部收起 */
const expanded = ref(null)
const scrollRef = ref(null)

/** 激活项所属分组（顶级项或不在菜单内时为 null），用于组标题强调 */
const activeGroup = computed(() =>
  props.items.find((g) => g.children && g.children.some((c) => c.path === props.active)) || null
)

/** 激活项变化时自动展开所属分组（仅响应 active 变化，不干扰用户手动收起） */
watch(
  () => props.active,
  (path) => {
    const g = props.items.find((it) => it.children && it.children.some((c) => c.path === path))
    if (g) expanded.value = g.path
  },
  { immediate: true }
)

function toggleGroup(path) {
  expanded.value = expanded.value === path ? null : path
}

/** router 模式：当前页重复点击直接忽略 */
function navigate(path) {
  if (path === props.active) return
  router.push(path)
}

/* ===== 键盘导航（仅展开态；收起态图标按钮仍可 Tab 聚焦） ===== */

/** 当前可见的菜单按钮，DOM 顺序 = 视觉顺序（收起的子菜单 visibility:hidden 被过滤） */
function visibleButtons() {
  if (!scrollRef.value) return []
  const selector = 'button.app-menu__group, button.app-menu__item, button.app-menu__icon-btn'
  return [...scrollRef.value.querySelectorAll(selector)].filter((el) =>
    el.checkVisibility ? el.checkVisibility() : true
  )
}

function focusButton(el) {
  if (!el) return
  el.focus()
  el.scrollIntoView({ block: 'nearest' })
}

function onKeydown(e) {
  if (props.collapsed) return
  const buttons = visibleButtons()
  if (!buttons.length) return
  const current = buttons.indexOf(document.activeElement)
  const el = document.activeElement

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      focusButton(buttons[(current + 1) % buttons.length])
      break
    case 'ArrowUp':
      e.preventDefault()
      focusButton(buttons[current === -1 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length])
      break
    case 'Home':
      e.preventDefault()
      focusButton(buttons[0])
      break
    case 'End':
      e.preventDefault()
      focusButton(buttons[buttons.length - 1])
      break
    case 'ArrowRight':
      // 展开聚焦的分组，焦点移至其首个子项（nextTick 等 DOM 更新后子项才可见可聚焦）
      if (el?.classList.contains('app-menu__group') && el.dataset.path !== expanded.value) {
        e.preventDefault()
        expanded.value = el.dataset.path
        nextTick(() => {
          const sub = el.parentElement?.querySelector(':scope > .app-menu__sub')
          focusButton(sub?.querySelector('button.app-menu__item'))
        })
      }
      break
    case 'ArrowLeft':
      // 收起聚焦的分组
      if (el?.classList.contains('app-menu__group') && el.dataset.path === expanded.value) {
        e.preventDefault()
        expanded.value = null
      }
      break
  }
}
</script>

<style scoped>
.app-menu {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.app-menu__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.app-menu__list {
  list-style: none;
  margin: 0;
  padding: var(--space-sm) var(--space-md) var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ===== 菜单按钮公共 ===== */
.app-menu__group,
.app-menu__item {
  display: flex;
  align-items: center;
  width: 100%;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: var(--sidebar-text);
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.app-menu__group:hover,
.app-menu__item:hover {
  background: var(--sidebar-bg-hover);
}

.app-menu__group:focus-visible,
.app-menu__item:focus-visible,
.app-menu__icon-btn:focus-visible {
  outline: 2px solid var(--color-primary-300);
  outline-offset: -2px;
}

/* 组标题 / 顶级项（40px） */
.app-menu__group {
  height: 40px;
  padding: 0 var(--space-md);
  gap: 10px;
  font-size: var(--text-size-base);
}

/* 子菜单项（36px，左缩进越过引导线） */
.app-menu__item {
  height: 36px;
  padding: 0 var(--space-md) 0 28px;
  gap: 8px;
  font-size: var(--text-size-sm);
}

/* 无子菜单的顶级项：与组标题同规格 */
.app-menu__item--root {
  height: 40px;
  padding: 0 var(--space-md);
  gap: 10px;
  font-size: var(--text-size-base);
}

.app-menu__icon {
  font-size: 18px;
  color: var(--sidebar-icon);
  flex-shrink: 0;
  transition: color var(--duration-fast) var(--ease-standard);
}

.app-menu__icon--sm {
  font-size: 16px;
}

.app-menu__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 激活态：扁平浅蓝 pill（无渐变、无投影、无左色条） */
.app-menu__item.is-active {
  background: var(--sidebar-bg-active);
  color: var(--sidebar-text-active);
  font-weight: var(--font-weight-medium);
}

.app-menu__item.is-active .app-menu__icon {
  color: var(--sidebar-icon-active);
}

/* 激活项在组内时，组标题轻微强调 */
.app-menu__group.is-active-group {
  color: var(--text-primary);
}

.app-menu__group.is-active-group .app-menu__icon {
  color: var(--color-neutral-700);
}

/* chevron：展开时旋转 90° */
.app-menu__chevron {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-neutral-400);
  transition: transform var(--duration-fast) var(--ease-standard);
}

.app-menu__group.is-open .app-menu__chevron {
  transform: rotate(90deg);
}

/* ===== 子菜单展开动画：grid 0fr→1fr（无需 JS 测量高度） ===== */
.app-menu__sub {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-base) var(--ease-standard);
}

.app-menu__sub.is-open {
  grid-template-rows: 1fr;
}

.app-menu__sub-inner {
  overflow: hidden;
  min-height: 0;
  /* 收起时移出 a11y 树与 Tab 序；关闭动画结束后再隐藏，打开时立即可见 */
  visibility: hidden;
  transition: visibility 0s linear var(--duration-base);
}

.app-menu__sub.is-open .app-menu__sub-inner {
  visibility: visible;
  transition-delay: 0s;
}

.app-menu__sub-list {
  list-style: none;
  margin: 0;
  padding: 2px 0 4px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 引导线：穿过父组图标中心（12 列表内边距 + 12 项内边距 + 9 图标半宽） */
.app-menu__sub-list::before {
  content: '';
  position: absolute;
  left: calc(var(--space-md) + 9px);
  top: 2px;
  bottom: 4px;
  width: 1px;
  background: var(--sidebar-border);
}

/* ===== 收起态（64px，仅图标） ===== */
.app-menu__list--collapsed > li {
  display: flex;
  justify-content: center;
}

.app-menu__icon-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  color: var(--sidebar-icon);
  font-family: inherit;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.app-menu__icon-btn:hover {
  background: var(--sidebar-bg-hover);
  color: var(--sidebar-text);
}

.app-menu__icon-btn.is-active {
  background: var(--sidebar-bg-active);
  color: var(--sidebar-icon-active);
}

.app-menu__icon-btn.is-active-group {
  color: var(--sidebar-icon-active);
}

/* 图标自带 color 声明，继承不到按钮颜色，激活态必须直接指定图标颜色（与展开态 is-active 一致） */
.app-menu__icon-btn.is-active .app-menu__icon,
.app-menu__icon-btn.is-active-group .app-menu__icon {
  color: var(--sidebar-icon-active);
}

/* 收起态小箭头提示"含子菜单"：定位到按钮右侧边距区（贴近侧边栏右缘），
   与居中的图标拉开距离；图标位置不变，仍与无子菜单的顶级项对齐 */
.app-menu__chevron--collapsed {
  position: absolute;
  top: 50%;
  right: -2px;
  transform: translateY(-50%);
  margin-left: 0;
  font-size: 10px;
}

/* ===== 动效降级 ===== */
@media (prefers-reduced-motion: reduce) {
  .app-menu__sub,
  .app-menu__sub-inner,
  .app-menu__chevron,
  .app-menu__group,
  .app-menu__item,
  .app-menu__icon-btn {
    transition: none;
  }
}
</style>
