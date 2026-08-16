<template>
  <div class="page">
    <PageHeader title="仓储管理" desc="各仓库容量、库存水位与运行状态">
      <el-button type="primary" :icon="Tickets" @click="$router.push('/warehouse/inventory')">
        库存明细
      </el-button>
    </PageHeader>

    <div class="stat-row">
      <StatCard title="仓库总数" :value="db.warehouses.length" unit="个" icon="House" color="var(--color-primary)" :sub="'运营中 ' + operatingCount + ' 个'" />
      <StatCard title="总容量" :value="formatNum(totalCapacity / 10000, 1)" unit="万吨" icon="Box" color="var(--color-success)" />
      <StatCard title="当前库存" :value="formatNum(totalUsed / 10000, 1)" unit="万吨" icon="DataLine" color="var(--color-warning)" :sub="'总库容利用率 ' + utilization + '%'" />
      <StatCard title="高水位仓库" :value="highLevelCount" unit="个" icon="Warning" color="var(--color-danger)" :sub="'利用率超过 85%'" />
    </div>

    <div class="warehouse-grid">
      <div v-for="w in db.warehouses" :key="w.id" class="warehouse-card panel">
        <div class="warehouse-card__head">
          <div class="warehouse-card__icon" :class="'icon--' + w.type">
            <el-icon :size="22"><House /></el-icon>
          </div>
          <div>
            <div class="warehouse-card__name">{{ w.name }}</div>
            <div class="warehouse-card__type">{{ typeMap[w.type] }} · {{ w.manager }}</div>
          </div>
          <StatusTag :status="w.status" :map="statusMap" />
        </div>

        <div class="warehouse-card__body">
          <div class="warehouse-card__level">
            <div class="warehouse-card__level-label">
              <span>库容利用率</span>
              <b class="num">{{ levelPercent(w) }}%</b>
            </div>
            <el-progress :percentage="levelPercent(w)" :stroke-width="10" :color="levelColor(w)" />
            <div class="warehouse-card__level-detail">
              <span class="num">{{ formatNum(w.used) }} t</span> /
              <span class="num">{{ formatNum(w.capacity) }} t</span>
            </div>
          </div>
        </div>

        <div class="warehouse-card__footer">
          <span class="warehouse-card__addr">
            <el-icon :size="13"><Location /></el-icon>
            {{ w.address }}
          </span>
          <el-button size="small" text type="primary" @click="goInventory(w)">
            库存
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'Warehouse' })
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { House, Tickets, Location } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
import { formatNum } from '@/utils'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()

const router = useRouter()

const typeMap = { 煤仓: '煤炭仓储', 矿石仓: '矿石仓储', 粮食仓: '粮食仓储', 化工库: '化工仓储' }
const statusMap = {
  operating: { label: '运营中', type: 'success' },
  maintenance: { label: '检修中', type: 'warning' }
}

const operatingCount = computed(() => db.warehouses.filter((w) => w.status === 'operating').length)
const totalCapacity = computed(() => db.warehouses.reduce((s, w) => s + w.capacity, 0))
const totalUsed = computed(() => db.warehouses.reduce((s, w) => s + w.used, 0))
const utilization = computed(() => Math.round((totalUsed.value / totalCapacity.value) * 1000) / 10)
const highLevelCount = computed(() => db.warehouses.filter((w) => levelPercent(w) > 85).length)

function levelPercent(w) {
  return Math.round((w.used / w.capacity) * 100)
}

function levelColor(w) {
  const p = levelPercent(w)
  if (p > 85) return tokens.danger
  if (p > 70) return tokens.warning
  return tokens.success
}

function goInventory(w) {
  router.push({ path: '/warehouse/inventory', query: { warehouseId: w.id } })
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.warehouse-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}

.warehouse-card {
  padding: 18px 20px;
  transition: all 0.2s;
}

.warehouse-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(16, 24, 40, 0.1);
}

.warehouse-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.warehouse-card__icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon--煤仓 {
  background: rgba(43, 92, 230, 0.1);
  color: var(--color-primary);
}

.icon--矿石仓 {
  background: rgba(255, 125, 0, 0.1);
  color: var(--color-warning);
}

.icon--粮食仓 {
  background: rgba(0, 180, 42, 0.1);
  color: var(--color-success);
}

.icon--化工库 {
  background: rgba(134, 144, 156, 0.12);
  color: var(--text-secondary);
}

.warehouse-card__name {
  font-size: 15px;
  font-weight: 600;
}

.warehouse-card__type {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.warehouse-card__head .status-tag {
  margin-left: auto;
}

.warehouse-card__level-label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.warehouse-card__level-label b {
  color: var(--text-primary);
}

.warehouse-card__level-detail {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.warehouse-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.warehouse-card__addr {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
