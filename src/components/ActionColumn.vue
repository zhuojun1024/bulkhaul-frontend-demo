<template>
  <el-table-column v-bind="colProps">
    <template #default="scope">
      <div class="action-cell" :ref="(el) => trackCell(el)">
        <slot v-bind="scope" />
      </div>
    </template>
  </el-table-column>
</template>

<script setup>
/**
 * ActionColumn —— 自适应宽度的"操作"列表格列
 *
 * 背景：操作列按钮受 RBAC（can()）+ 行状态（v-if row.status）双重控制，
 * 不同账号/不同行可见按钮数量不同。写死 width 会导致：
 *   - 权限少的账号（如只有"详情"）看到过宽的空白列；
 *   - 权限多的账号按钮多时可能溢出。
 *
 * 原理：包一层 el-table-column，列宽绑定响应式 cur；
 *   每行单元格内用 MutationObserver 监听按钮增删（v-if 变化），
 *   列宽 = clamp(当前页所有行按钮总宽 + 16, minWidth, maxWidth)。
 *   按钮宽度与列宽无关（link 按钮按内容定宽），无布局反馈环。
 *
 * 用法（替换原 <el-table-column label="操作" width="300" ...>）：
 *   <ActionColumn width="300" fixed="right"> ...按钮... </ActionColumn>
 *   width 仅作初始值（避免首帧闪烁），随后按实测收敛。
 */
defineOptions({ name: 'ActionColumn' })
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  label: { type: String, default: '操作' },
  /** 初始列宽（px），渲染后按实测按钮宽度收敛 */
  width: { type: [Number, String], default: 120 },
  minWidth: { type: [Number, String], default: 80 },
  maxWidth: { type: [Number, String], default: 420 },
  align: { type: String, default: 'center' },
  fixed: { type: [Boolean, String], default: false }
})

const cur = ref(Math.max(Number(props.width) || 120, Number(props.minWidth) || 80))
const colProps = computed(() => ({
  label: props.label,
  width: cur.value,
  align: props.align,
  fixed: props.fixed
}))

const cells = new Set()
const mos = new WeakMap()

/** 单元格内按钮总宽 = Σ按钮宽 + 12px 间距 ×（按钮数-1）（.el-button+.el-button 的 margin-left） */
function measureCell(el) {
  const btns = el.querySelectorAll('.el-button')
  if (!btns.length) return 0
  let w = 0
  btns.forEach((b) => { w += b.offsetWidth })
  return w + 12 * (btns.length - 1)
}

function recompute() {
  // 清理已卸载的单元格（callback ref 卸载时传 null，无法定位具体元素）
  for (const el of [...cells]) if (!el.isConnected) cells.delete(el)
  let max = 0
  for (const el of cells) max = Math.max(max, measureCell(el))
  const lo = Number(props.minWidth) || 80
  const hi = Number(props.maxWidth) || 420
  const target = Math.min(hi, Math.max(lo, max + 16))
  if (Math.abs(target - cur.value) >= 2) cur.value = target
}

function trackCell(el) {
  if (el) {
    cells.add(el)
    // 按钮 v-if 增删时单元格自身尺寸不变（撑满列宽），须监听子树 DOM 变化
    const mo = new MutationObserver(recompute)
    mo.observe(el, { childList: true, subtree: true })
    mos.set(el, mo)
    recompute()
  } else {
    // 某行卸载：清理并重算（最宽行消失时列宽应收窄）
    recompute()
  }
}

onBeforeUnmount(() => {
  for (const el of cells) {
    const mo = mos.get(el)
    if (mo) mo.disconnect()
  }
  cells.clear()
})
</script>

<style scoped>
.action-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  flex-wrap: nowrap;
}
</style>
