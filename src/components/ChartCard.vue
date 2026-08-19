<template>
  <div class="chart-card panel" :class="{ 'chart-card--fluid': fluid }">
    <div v-if="title" class="chart-card__header">
      <span class="panel__title">{{ title }}</span>
      <slot name="extra" />
    </div>
    <div ref="chartRef" class="chart-card__body" :style="bodyStyle" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  title: { type: String, default: '' },
  option: { type: Object, required: true },
  height: { type: Number, default: 300 },
  /* fluid：撑满父容器高度（图表体自动拉伸），用于行内等高布局 */
  fluid: { type: Boolean, default: false }
})

const chartRef = ref(null)
let chart = null
let resizeObserver = null

const bodyStyle = computed(() => (props.fluid ? {} : { height: props.height + 'px' }))

function applyOption() {
  const el = chartRef.value
  if (!el) return
  // 容器尚不可见（如非激活页签）时延迟初始化，避免 0×0 画布；可见后由 ResizeObserver 触发
  if (!chart && !el.clientWidth) return
  if (!chart) {
    chart = echarts.init(el)
    el.style.visibility = 'visible'
  }
  chart.setOption(props.option, true)
}

function resize() {
  const el = chartRef.value
  if (!el || !el.clientWidth) return
  if (!chart) return applyOption()
  chart.resize()
}

onMounted(() => {
  applyOption()
  window.addEventListener('resize', resize)
  // 监听容器尺寸变化同步图表：fluid 模式高度由行布局决定；
  // 固定高度模式下，页签切换（display:none → 可见）时容器从 0 变为实际尺寸，也依赖它触发初始化/resize
  if (chartRef.value) {
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(chartRef.value)
  }
})

watch(
  () => props.option,
  () => nextTick(applyOption),
  { deep: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  resizeObserver && resizeObserver.disconnect()
  chart && chart.dispose()
  chart = null
})
</script>

<style scoped>
.chart-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 0;
}

.chart-card__body {
  /* 图表初始化完成前隐藏，避免页签切换首帧出现空白画布闪烁 */
  visibility: hidden;
  padding: 8px 12px 12px;
}

/* fluid：撑满父容器，图表体占满剩余高度（min-height 保证行内无更高兄弟时不塌陷） */
.chart-card--fluid {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.chart-card--fluid .chart-card__body {
  flex: 1;
  min-height: 240px;
}
</style>
