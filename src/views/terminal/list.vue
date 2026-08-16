<template>
  <div class="page">
    <PageHeader title="场站管理" desc="装/卸货场站运行状态、吞吐量与排队情况">
      <el-button type="primary" :icon="ScaleToOriginal" @click="$router.push('/terminal/weighing')">
        磅单记录
      </el-button>
    </PageHeader>

    <div class="stat-row">
      <StatCard title="场站总数" :value="db.terminals.length" unit="个" icon="OfficeBuilding" color="var(--color-primary)" :sub="'运营中 ' + operatingCount + ' 个'" />
      <StatCard title="今日总吞吐" :value="formatNum(totalThroughput)" unit="吨" icon="DataLine" color="var(--color-success)" :trend="8.6" trend-label="较昨日" />
      <StatCard title="排队车辆" :value="totalQueue" unit="辆" icon="Van" color="var(--color-warning)" :sub="'全部场站合计'" />
      <StatCard title="场站利用率" :value="utilization" unit="%" icon="PieChart" color="var(--color-info)" :trend="3.2" trend-label="较昨日" />
    </div>

    <div class="terminal-grid">
      <div v-for="t in terminals" :key="t.id" class="terminal-card panel">
        <div class="terminal-card__head">
          <div class="terminal-card__type" :class="'type--' + t.type">
            {{ typeMap[t.type] }}
          </div>
          <StatusTag :status="t.status" :map="statusMap" />
        </div>
        <div class="terminal-card__name">{{ t.name }}</div>
        <div class="terminal-card__addr">
          <el-icon :size="13"><Location /></el-icon>
          {{ t.address }}
        </div>
        <div class="terminal-card__stats">
          <div class="terminal-card__stat">
            <div class="terminal-card__num num">{{ formatNum(t.todayThroughput) }}</div>
            <div class="terminal-card__label">今日吞吐(吨)</div>
          </div>
          <div class="terminal-card__stat">
            <div class="terminal-card__num num">{{ t.queueVehicles }}</div>
            <div class="terminal-card__label">排队车辆</div>
          </div>
          <div class="terminal-card__stat">
            <div class="terminal-card__num num">{{ formatNum(t.capacity) }}</div>
            <div class="terminal-card__label">日能力(吨)</div>
          </div>
        </div>
        <el-progress
          :percentage="Math.round((t.todayThroughput / t.capacity) * 100)"
          :stroke-width="8"
          :color="progressColor(t)"
        />
        <div class="terminal-card__footer">
          <span class="terminal-card__contact">
            <el-icon :size="13"><Phone /></el-icon>
            {{ t.contact }} {{ t.phone }}
          </span>
          <el-button size="small" text type="primary" @click="$router.push('/terminal/weighing')">
            磅单
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'Terminal' })
import { computed } from 'vue'
import { ScaleToOriginal, Location, Phone } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
import { formatNum } from '@/utils'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()


const typeMap = { loading: '装货场', unloading: '卸货场', both: '装卸一体' }
const statusMap = {
  operating: { label: '运营中', type: 'success' },
  maintenance: { label: '检修中', type: 'warning' }
}

const terminals = computed(() => db.terminals)
const operatingCount = computed(() => db.terminals.filter((t) => t.status === 'operating').length)
const totalThroughput = computed(() => db.terminals.reduce((s, t) => s + t.todayThroughput, 0))
const totalQueue = computed(() => db.terminals.reduce((s, t) => s + t.queueVehicles, 0))
const utilization = computed(() => {
  const cap = db.terminals.reduce((s, t) => s + t.capacity, 0)
  return Math.round((totalThroughput.value / cap) * 1000) / 10
})

function progressColor(t) {
  const ratio = t.todayThroughput / t.capacity
  if (ratio > 0.85) return tokens.danger
  if (ratio > 0.6) return tokens.warning
  return tokens.success
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.terminal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.terminal-card {
  padding: 18px 20px;
  transition: all 0.2s;
}

.terminal-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(16, 24, 40, 0.1);
}

.terminal-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.terminal-card__type {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
}

.type--loading {
  background: rgba(0, 180, 42, 0.1);
  color: var(--color-success);
}

.type--unloading {
  background: rgba(255, 125, 0, 0.1);
  color: var(--color-warning);
}

.type--both {
  background: rgba(43, 92, 230, 0.1);
  color: var(--color-primary);
}

.terminal-card__name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 6px;
}

.terminal-card__addr {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 14px;
}

.terminal-card__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.terminal-card__stat {
  text-align: center;
  background: var(--color-neutral-50);
  border-radius: 8px;
  padding: 10px 4px;
}

.terminal-card__num {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}

.terminal-card__label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.terminal-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}

.terminal-card__contact {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
