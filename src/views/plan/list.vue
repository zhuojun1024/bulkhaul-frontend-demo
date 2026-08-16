<template>
  <div class="page" v-loading="loading">
    <PageHeader title="运输计划" desc="合同批次化拆解，计划是调度的依据">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
      <el-button type="primary" :icon="Plus" @click="$router.push('/plan/create')">新建计划</el-button>
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

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="计划编号 / 合同编号" :prefix-icon="Search" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.status" placeholder="计划状态" clearable>
              <el-option v-for="(v, k) in statusMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.commodityId" placeholder="商品" clearable>
              <el-option v-for="c in db.commodities" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-date-picker v-model="filter.dateRange" type="daterange" range-separator="至" start-placeholder="计划开始" end-placeholder="计划结束" value-format="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe @row-click="goDetail">
          <el-table-column prop="id" label="计划编号" width="110" fixed>
            <template #default="{ row }">
              <span class="link" @click.stop="goDetail(row)">{{ row.id }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="contractId" label="所属合同" width="110" />
          <el-table-column label="商品" width="90" align="center">
            <template #default="{ row }">{{ find.commodity(row.commodityId)?.name }}</template>
          </el-table-column>
          <el-table-column label="装货场站" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ find.terminal(row.loadTerminalId)?.name }}</template>
          </el-table-column>
          <el-table-column label="卸货场站" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ find.terminal(row.unloadTerminalId)?.name }}</template>
          </el-table-column>
          <el-table-column label="数量(吨)" width="100" align="right">
            <template #default="{ row }">{{ formatNum(row.quantity) }}</template>
          </el-table-column>
          <el-table-column prop="planDate" label="计划日期" width="110" />
          <el-table-column prop="mode" label="方式" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ row.mode }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="执行进度" width="130">
            <template #default="{ row }">
              <el-progress :percentage="row.progress" :stroke-width="6" :color="progressColor(row.status)" />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <el-button
                v-if="row.status === 'pending' && can('dispatch')"
                link type="warning" size="small"
                @click.stop="openDispatch(row)"
              >调度</el-button>
              <el-button
                v-if="row.status === 'pending' && can('plan')"
                link type="danger" size="small"
                @click.stop="cancel(row)"
              >取消</el-button>
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

    <!-- 调度弹窗 -->
    <el-dialog v-model="dispatchVisible" title="计划调度" width="520px">
      <div v-if="currentPlan" class="dispatch-dialog">
        <el-alert :title="'计划 ' + currentPlan.id + '：' + (find.commodity(currentPlan.commodityId)?.name || '') + ' ' + formatNum(currentPlan.quantity) + ' 吨'" type="info" :closable="false" show-icon />
        <el-alert
          v-if="!isRoad"
          :title="currentPlan.mode + '方式按运输单元执行（车号/船名/管段），无需匹配车辆与司机，不产生公路磅单'"
          type="warning"
          :closable="false"
          show-icon
          style="margin-top: 10px"
        />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item :label="isRoad ? '调度车次' : '运输单元数'">
            <el-input-number v-model="dispatchCount" :min="1" :max="10" />
            <span class="dispatch-dialog__tip">每{{ isRoad ? '车' : '单元' }}约 {{ perTripQuantity }} 吨</span>
          </el-form-item>
          <template v-if="isRoad">
            <el-form-item label="车辆来源">
              <el-radio-group v-model="vehicleSource">
                <el-radio value="auto">自动匹配空闲车辆</el-radio>
                <el-radio value="manual">手动指定</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="vehicleSource === 'manual'" label="选择车辆">
              <el-select v-model="selectedVehicles" multiple filterable placeholder="选择车辆" style="width: 100%">
                <el-option v-for="v in idleVehicles" :key="v.id" :label="v.plate + '（' + v.type + '）'" :value="v.id" />
              </el-select>
            </el-form-item>
          </template>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" :loading="dispatching" @click="confirmDispatch">确认调度</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'Plan' })
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { createDispatches, creditCheck, isRoadMode, logAction } from '@/mock/flow'
import { formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()

const router = useRouter()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 300))

const statusMap = {
  pending: { label: '待执行', type: 'info' },
  dispatched: { label: '已调度', type: 'primary' },
  intransit: { label: '执行中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  cancelled: { label: '已取消', type: 'danger' }
}

const filter = reactive({ keyword: '', status: '', commodityId: '', dateRange: [] })
const page = ref(1)
const pageSize = ref(10)

const statItems = computed(() => {
  const count = (s) => db.plans.filter((p) => p.status === s).length
  return [
    { key: '', label: '全部计划', count: db.plans.length, color: tokens.primary },
    { key: 'pending', label: '待执行', count: count('pending'), color: tokens.info },
    { key: 'dispatched', label: '已调度', count: count('dispatched'), color: tokens.primary },
    { key: 'intransit', label: '执行中', count: count('intransit'), color: tokens.warning },
    { key: 'completed', label: '已完成', count: count('completed'), color: tokens.success }
  ]
})

const filtered = computed(() =>
  db.plans.filter((p) => {
    if (filter.status && p.status !== filter.status) return false
    if (filter.commodityId && p.commodityId !== filter.commodityId) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      if (!p.id.toLowerCase().includes(kw) && !p.contractId.toLowerCase().includes(kw)) return false
    }
    if (filter.dateRange && filter.dateRange.length === 2) {
      if (p.planDate < filter.dateRange[0] || p.planDate > filter.dateRange[1]) return false
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
  filter.status = ''
  filter.commodityId = ''
  filter.dateRange = []
  page.value = 1
}

function goDetail(row) {
  router.push(`/plan/${row.id}`)
}

function progressColor(status) {
  return { dispatched: tokens.primary, intransit: tokens.warning, completed: tokens.success, cancelled: tokens.danger }[status] || tokens.neutral300
}

function cancel(row) {
  ElMessageBox.confirm(`确认取消计划 ${row.id}？`, '提示', { type: 'warning' }).then(() => {
    row.status = 'cancelled'
    logAction('运输计划', '取消计划', `计划 ${row.id} 取消（${find.contract(row.contractId)?.name || row.contractId}）`)
    ElMessage.success('计划已取消')
  }).catch(() => {})
}

/* ===== 调度 ===== */
const dispatchVisible = ref(false)
const dispatching = ref(false)
const currentPlan = ref(null)
const dispatchCount = ref(3)
const vehicleSource = ref('auto')
const selectedVehicles = ref([])
/** 已有未完结车次（待装货/装货中/异常）的车辆不可再被指定，与 createDispatches 互斥口径一致 */
const busyVehicleIds = computed(() =>
  new Set(db.dispatches.filter((d) => ['pending', 'loading', 'exception'].includes(d.status)).map((d) => d.vehicleId))
)
const idleVehicles = computed(() =>
  db.vehicles.filter(
    (v) => v.status === 'idle' && v.type !== '铁路敞车' && v.type !== '散货船' && !busyVehicleIds.value.has(v.id)
  )
)

/** 公路口径（公路/多式联运）才需要匹配车辆司机 */
const isRoad = computed(() => isRoadMode(currentPlan.value?.mode))

/** 每车/每单元均摊数量（批次量 / 车次） */
const perTripQuantity = computed(() => {
  if (!currentPlan.value || !dispatchCount.value) return 0
  return Math.max(1, Math.round(currentPlan.value.quantity / dispatchCount.value))
})

function openDispatch(row) {
  currentPlan.value = row
  // 公路口径默认车次按单车 35 吨估算；非公路口径默认单个运输单元
  dispatchCount.value = isRoadMode(row.mode) ? Math.min(10, Math.max(1, Math.round(row.quantity / 35))) : 1
  vehicleSource.value = 'auto'
  selectedVehicles.value = []
  dispatchVisible.value = true
}

function confirmDispatch() {
  if (isRoad.value && vehicleSource.value === 'manual' && selectedVehicles.value.length < dispatchCount.value) {
    ElMessage.warning(`请至少选择 ${dispatchCount.value} 辆车`)
    return
  }
  const plan = currentPlan.value
  const contract = find.contract(plan.contractId)
  const check = creditCheck(contract?.shipperId, plan.quantity * (plan.unitPrice || 0))
  if (!check.ok) {
    ElMessageBox.alert(check.message, '信用校验未通过', { type: 'warning', confirmButtonText: '知道了' })
    return
  }
  dispatching.value = true
  setTimeout(() => {
    const { created, error } = createDispatches(
      plan,
      dispatchCount.value,
      vehicleSource.value === 'manual' ? selectedVehicles.value : []
    )
    dispatching.value = false
    dispatchVisible.value = false
    if (error) {
      ElMessage.warning(error)
      return
    }
    ElMessage.success(`已为计划 ${plan.id} 生成 ${created.length} 张调度单`)
  }, 400)
}

function exportCsv() {
  const headers = ['计划编号', '合同编号', '商品', '装货场站', '卸货场站', '数量(吨)', '计划日期', '方式', '状态']
  const rows = filtered.value.map((p) => [
    p.id, p.contractId,
    find.commodity(p.commodityId)?.name || '',
    find.terminal(p.loadTerminalId)?.name || '',
    find.terminal(p.unloadTerminalId)?.name || '',
    p.quantity, p.planDate, p.mode, statusMap[p.status].label
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `运输计划_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条计划`)
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

.link {
  color: var(--color-primary);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}

.dispatch-dialog__tip {
  margin-left: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
