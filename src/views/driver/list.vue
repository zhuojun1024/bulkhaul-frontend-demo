<template>
  <div class="page">
    <PageHeader title="司机管理" desc="司机档案、证照效期与出勤状态管理">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
    </PageHeader>

    <div class="stat-row">
      <div
        v-for="s in statItems"
        :key="s.key"
        class="stat-chip"
        :class="{ active: filter.status === s.key }"
        :style="{ '--chip-color': s.color }"
        @click="filter.status = filter.status === s.key ? '' : s.key; page = 1"
      >
        <span class="stat-chip__num num">{{ s.count }}</span>
        <span class="stat-chip__label">{{ s.label }}</span>
      </div>
    </div>

    <el-alert
      v-if="expiringSoon.length"
      class="driver-alert"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #title>
        证照预警：{{ expiringSoon.length }} 名司机驾驶证将在 30 天内到期
        （{{ expiringSoon.slice(0, 3).map((d) => d.name).join('、') }}{{ expiringSoon.length > 3 ? ' 等' : '' }}），请及时安排换证
      </template>
    </el-alert>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="姓名 / 手机号" :prefix-icon="Search" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.licenseType" placeholder="驾驶证类型" clearable>
              <el-option label="A2" value="A2" />
              <el-option label="B2" value="B2" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-checkbox v-model="filter.onlyExpiring">仅看证照临期</el-checkbox>
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe @row-click="goDetail">
          <el-table-column prop="name" label="姓名" width="120" fixed>
            <template #default="{ row }">
              <div class="driver-cell">
                <div class="driver-cell__avatar">{{ row.name.charAt(0) }}</div>
                <span class="link" @click.stop="goDetail(row)">{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="phone" label="手机号" min-width="130" />
          <el-table-column prop="licenseType" label="驾照" width="70" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ row.licenseType }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="驾照到期" width="120">
            <template #default="{ row }">
              <span :class="{ 'text-danger': isExpiring(row.licenseExpire) }">{{ row.licenseExpire }}</span>
            </template>
          </el-table-column>
          <el-table-column label="评分" width="180">
            <template #default="{ row }">
              <el-rate :model-value="row.rating" disabled show-score text-color="var(--color-warning)" score-template="{value}" />
            </template>
          </el-table-column>
          <el-table-column label="累计趟次" width="90" align="right">
            <template #default="{ row }">{{ formatNum(row.totalTrips) }}</template>
          </el-table-column>
          <el-table-column prop="joinDate" label="入职日期" width="110" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <el-button
                v-if="row.status !== 'disabled' && can('driver')"
                link type="danger" size="small"
                @click.stop="disable(row)"
              >停用</el-button>
              <el-button
                v-else-if="can('driver')"
                link type="success" size="small"
                @click.stop="enable(row)"
              >启用</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="filtered.length"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next, jumper"
            background
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'Driver' })
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
import { toggleDriverStatus } from '@/mock/flow'
import { formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()

const router = useRouter()

const statusMap = {
  onduty: { label: '出勤中', type: 'primary' },
  available: { label: '可派单', type: 'success' },
  rest: { label: '休息中', type: 'info' },
  disabled: { label: '已停用', type: 'danger' }
}

const filter = reactive({ keyword: '', licenseType: '', status: '', onlyExpiring: false })
const page = ref(1)
const pageSize = ref(10)

const expiringSoon = computed(() =>
  db.drivers.filter((d) => d.status !== 'disabled' && isExpiring(d.licenseExpire))
)

const statItems = computed(() => {
  const count = (s) => db.drivers.filter((d) => d.status === s).length
  return [
    { key: '', label: '全部司机', count: db.drivers.length, color: tokens.primary },
    { key: 'onduty', label: '出勤中', count: count('onduty'), color: tokens.primary },
    { key: 'available', label: '可派单', count: count('available'), color: tokens.success },
    { key: 'rest', label: '休息中', count: count('rest'), color: tokens.info },
    { key: 'disabled', label: '已停用', count: count('disabled'), color: tokens.danger }
  ]
})

const filtered = computed(() =>
  db.drivers.filter((d) => {
    if (filter.status && d.status !== filter.status) return false
    if (filter.licenseType && d.licenseType !== filter.licenseType) return false
    if (filter.onlyExpiring && !isExpiring(d.licenseExpire)) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      if (!d.name.toLowerCase().includes(kw) && !d.phone.includes(kw)) return false
    }
    return true
  })
)

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

function resetFilter() {
  filter.keyword = ''
  filter.licenseType = ''
  filter.status = ''
  filter.onlyExpiring = false
  page.value = 1
}

function goDetail(row) {
  router.push(`/driver/${row.id}`)
}

function isExpiring(date) {
  const d = dayjs(date)
  return d.isBefore(dayjs().add(30, 'day'))
}

function disable(row) {
  ElMessageBox.confirm(`确认停用司机 ${row.name}？停用后不可派单。`, '停用司机', { type: 'warning' }).then(() => {
    // 写操作下沉服务层（P2）：执行中车次守卫 + RBAC + 司机账号联动 + 审计
    const r = toggleDriverStatus(row)
    if (r && r.error) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(`${row.name} 已停用`)
  }).catch(() => {})
}

function enable(row) {
  const r = toggleDriverStatus(row)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(`${row.name} 已启用`)
}

function exportCsv() {
  const headers = ['姓名', '手机号', '驾照类型', '驾照到期', '评分', '累计趟次', '入职日期', '状态']
  const rows = filtered.value.map((d) => [
    d.name, d.phone, d.licenseType, d.licenseExpire, d.rating, d.totalTrips, d.joinDate, statusMap[d.status].label
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `司机列表_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条司机`)
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

.stat-chip {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 14px 18px;
  display: flex;
  align-items: baseline;
  gap: 10px;
  cursor: pointer;
  border: 1px solid transparent;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
  transition: all 0.2s;
}

.stat-chip:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(16, 24, 40, 0.08);
}

.stat-chip.active {
  border-color: var(--chip-color);
  background: color-mix(in srgb, var(--chip-color) 5%, var(--bg-card));
}

.stat-chip__num {
  font-size: 22px;
  font-weight: 700;
  color: var(--chip-color);
}

.stat-chip__label {
  font-size: 13px;
  color: var(--text-secondary);
}

.driver-alert {
  border-radius: 8px;
}

.driver-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.driver-cell__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-success), var(--color-success-400));
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}

.link {
  color: var(--color-primary);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}

.text-danger {
  color: var(--color-danger);
  font-weight: 600;
}
</style>
