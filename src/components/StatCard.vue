<template>
  <div class="stat-card" :style="{ '--sc-color': color }">
    <div class="stat-card__icon">
      <el-icon :size="22"><component :is="icon" /></el-icon>
    </div>
    <div class="stat-card__body">
      <div class="stat-card__title">{{ title }}</div>
      <div class="stat-card__value num">
        {{ value }}
        <span v-if="unit" class="stat-card__unit">{{ unit }}</span>
      </div>
      <div v-if="trend !== null && trend !== undefined" class="stat-card__trend" :class="trend >= 0 ? 'up' : 'down'">
        <el-icon :size="12">
          <Top v-if="trend >= 0" />
          <Bottom v-else />
        </el-icon>
        {{ Math.abs(trend) }}%
        <span v-if="trendLabel" class="stat-card__trend-label">{{ trendLabel }}</span>
      </div>
      <div v-else-if="sub" class="stat-card__sub">{{ sub }}</div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  value: { type: [String, Number], required: true },
  unit: { type: String, default: '' },
  icon: { type: String, default: 'DataLine' },
  color: { type: String, default: 'var(--color-primary)' },
  trend: { type: Number, default: null },
  trendLabel: { type: String, default: '' },
  sub: { type: String, default: '' }
})
</script>

<style scoped>
.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg-card);
  border-radius: 8px;
  padding: 18px 20px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
  transition: box-shadow 0.2s, transform 0.2s;
}

.stat-card:hover {
  box-shadow: 0 4px 16px rgba(16, 24, 40, 0.1);
  transform: translateY(-2px);
}

.stat-card__icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--sc-color) 10%, var(--bg-card));
  color: var(--sc-color);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-card__title {
  font-size: 13px;
  color: var(--text-secondary);
}

.stat-card__value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin-top: 2px;
}

.stat-card__unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 4px;
}

.stat-card__trend {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  margin-top: 2px;
}

.stat-card__trend.up {
  color: var(--color-success);
}

.stat-card__trend.down {
  color: var(--color-danger);
}

.stat-card__trend-label {
  color: var(--text-secondary);
  margin-left: 4px;
}

.stat-card__sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
</style>
