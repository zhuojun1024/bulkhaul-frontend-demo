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

function render() {
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  chart.setOption(props.option, true)
}

function resize() {
  chart && chart.resize()
}

onMounted(() => {
  render()
  window.addEventListener('resize', resize)
  // fluid 模式：容器高度由行布局决定，监听尺寸变化同步图表
  if (props.fluid && chartRef.value) {
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(chartRef.value)
  }
})

watch(
  () => props.option,
  () => nextTick(render),
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
