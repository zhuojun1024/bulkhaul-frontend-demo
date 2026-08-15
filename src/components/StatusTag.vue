<template>
  <el-tag :type="type" effect="light" round size="small" class="status-tag">
    <span class="status-tag__dot" :style="{ background: dotColor }" />
    {{ label }}
  </el-tag>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** 状态值 */
  status: { type: String, required: true },
  /** 状态映射表：{ code: { label, type } }，type 为 el-tag 类型 */
  map: { type: Object, required: true }
})

const item = computed(() => props.map[props.status] || { label: props.status, type: 'info' })
const label = computed(() => item.value.label)
const type = computed(() => item.value.type || 'info')

const dotColors = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)'
}
const dotColor = computed(() => dotColors[type.value] || dotColors.info)
</script>

<style scoped>
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.status-tag__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
</style>
