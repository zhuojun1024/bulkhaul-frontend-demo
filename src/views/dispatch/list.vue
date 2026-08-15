<template>
  <div class="page" v-loading="loading">
    <PageHeader title="调度管理" desc="调度单是运输执行的指令，覆盖派车、装货、在途、卸货全流程">
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

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="单号 / 车牌 / 司机" :prefix-icon="Search" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.status" placeholder="执行状态" clearable>
              <el-option v-for="(v, k) in statusMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.commodityId" placeholder="商品" clearable>
              <el-option v-for="c in db.commodities" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-date-picker v-model="filter.dateRange" type="daterange" range-separator="至" start-placeholder="下发开始" end-placeholder="下发结束" value-format="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe @row-click="goDetail">
          <el-table-column prop="id" label="调度单号" width="110" fixed>
            <template #default="{ row }">
              <span class="link" @click.stop="goDetail(row)">{{ row.id }}</span>
            </template>
          </el-table-column>
          <el-table-column label="车牌号" width="120">
            <template #default="{ row }">{{ find.vehicle(row.vehicleId)?.plate }}</template>
          </el-table-column>
          <el-table-column label="司机" width="90">
            <template #default="{ row }">{{ find.driver(row.driverId)?.name }}</template>
          </el-table-column>
          <el-table-column label="商品" width="90" align="center">
            <template #default="{ row }">{{ find.commodity(row.commodityId)?.name }}</template>
          </el-table-column>
          <el-table-column label="数量(吨)" width="90" align="right">
            <template #default="{ row }">{{ row.quantity }}</template>
          </el-table-column>
          <el-table-column label="装货场站" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ find.terminal(row.loadTerminalId)?.name }}</template>
          </el-table-column>
          <el-table-column label="卸货场站" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ find.terminal(row.unloadTerminalId)?.name }}</template>
          </el-table-column>
          <el-table-column prop="dispatchTime" label="下发时间" width="150" />
          <el-table-column prop="eta" label="预计到达" width="150">
            <template #default="{ row }">{{ row.eta || '—' }}</template>
          </el-table-column>
          <el-table-column label="进度" width="120">
            <template #default="{ row }">
              <el-progress :percentage="row.progress" :stroke-width="6" :color="progressColor(row.status)" />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="210" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <template v-if="can('dispatch')">
                <el-button
                  v-if="row.status === 'pending'"
                  link type="warning" size="small"
                  @click.stop="confirmLoad(row)"
                >确认装货</el-button>
                <el-button
                  v-if="row.status === 'loading'"
                  link type="primary" size="small"
                  @click.stop="depart(row)"
                >发车</el-button>
                <el-button
                  v-if="row.status === 'intransit'"
                  link type="success" size="small"
                  @click.stop="arrive(row)"
                >到达</el-button>
                <el-button
                  v-if="row.status === 'unloading'"
                  link type="success" size="small"
                  @click.stop="confirmUnload(row)"
                >确认卸货</el-button>
                <el-button
                  v-if="row.status === 'exception'"
                  link type="warning" size="small"
                  @click.stop="resume(row)"
                >恢复</el-button>
              </template>
              <el-button
                v-if="['pending', 'loading', 'intransit'].includes(row.status) && can('exception')"
                link type="danger" size="small"
                @click.stop="reportException(row)"
              >报异常</el-button>
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
defineOptions({ name: 'Dispatch' })
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import {
  confirmLoad as flowConfirmLoad,
  depart as flowDepart,
  arrive as flowArrive,
  confirmUnload as flowConfirmUnload,
  reportException as flowReportException,
  resumeDispatch
} from '@/mock/flow'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()

const router = useRouter()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 300))

const statusMap = {
  pending: { label: '待装货', type: 'info' },
  loading: { label: '装货中', type: 'warning' },
  intransit: { label: '在途', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  exception: { label: '异常', type: 'danger' }
}

const filter = reactive({ keyword: '', status: '', commodityId: '', dateRange: [] })
const page = ref(1)
const pageSize = ref(10)

const statItems = computed(() => {
  const count = (s) => db.dispatches.filter((d) => d.status === s).length
  return [
    { key: '', label: '全部调度单', count: db.dispatches.length, color: tokens.primary },
    { key: 'pending', label: '待装货', count: count('pending'), color: tokens.info },
    { key: 'loading', label: '装货中', count: count('loading'), color: tokens.warning },
    { key: 'intransit', label: '在途', count: count('intransit'), color: tokens.primary },
    { key: 'completed', label: '已完成', count: count('completed'), color: tokens.success },
    { key: 'exception', label: '异常', count: count('exception'), color: tokens.danger }
  ]
})

const filtered = computed(() =>
  db.dispatches.filter((d) => {
    if (filter.status && d.status !== filter.status) return false
    if (filter.commodityId && d.commodityId !== filter.commodityId) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      const plate = (find.vehicle(d.vehicleId)?.plate || '').toLowerCase()
      const driver = find.driver(d.driverId)?.name || ''
      if (!d.id.toLowerCase().includes(kw) && !plate.includes(kw) && !driver.includes(filter.keyword)) return false
    }
    if (filter.dateRange && filter.dateRange.length === 2) {
      const day = d.dispatchTime.slice(0, 10)
      if (day < filter.dateRange[0] || day > filter.dateRange[1]) return false
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
  router.push(`/dispatch/${row.id}`)
}

function progressColor(status) {
  return { loading: tokens.warning, intransit: tokens.primary, unloading: tokens.warning, completed: tokens.success, exception: tokens.danger }[status] || tokens.neutral300
}

function confirmLoad(row) {
  ElMessageBox.confirm(
    `确认 ${find.vehicle(row.vehicleId)?.plate} 已完成装货？<br/>将自动登记进磅单。`,
    '确认装货',
    { dangerouslyUseHTMLString: true, type: 'info', confirmButtonText: '确认装货' }
  ).then(() => {
    flowConfirmLoad(row)
    ElMessage.success('装货确认成功，进磅单已登记')
  }).catch(() => {})
}

function depart(row) {
  ElMessageBox.confirm(
    `确认 ${find.vehicle(row.vehicleId)?.plate} 发车开始运输？`,
    '发车确认',
    { type: 'info', confirmButtonText: '确认发车' }
  ).then(() => {
    flowDepart(row)
    ElMessage.success('已发车，进入在途状态')
  }).catch(() => {})
}

function arrive(row) {
  ElMessageBox.confirm(
    `确认 ${find.vehicle(row.vehicleId)?.plate} 已到达卸货场站，开始卸货？`,
    '到达确认',
    { type: 'info', confirmButtonText: '确认到达' }
  ).then(() => {
    flowArrive(row)
    ElMessage.success('已到达，进入卸货状态')
  }).catch(() => {})
}

function confirmUnload(row) {
  ElMessageBox.confirm(
    `确认 ${find.vehicle(row.vehicleId)?.plate} 已完成卸货？<br/>将自动登记出磅单并结算运费。`,
    '确认卸货',
    { dangerouslyUseHTMLString: true, type: 'success', confirmButtonText: '确认卸货' }
  ).then(() => {
    flowConfirmUnload(row)
    ElMessage.success('卸货确认成功，本次运输已完成')
  }).catch(() => {})
}

function resume(row) {
  ElMessageBox.confirm(
    `确认调度单 ${row.id} 恢复运输？`,
    '恢复运输',
    { type: 'warning', confirmButtonText: '确认恢复' }
  ).then(() => {
    resumeDispatch(row)
    ElMessage.success('已恢复运输')
  }).catch(() => {})
}

function reportException(row) {
  ElMessageBox.prompt('请简述异常情况', `上报异常 - ${row.id}`, {
    inputPattern: /.{2,}/,
    inputErrorMessage: '描述至少 2 个字符',
    confirmButtonText: '上报',
    type: 'warning'
  }).then(({ value }) => {
    flowReportException(row, value)
    ElMessage.warning('异常已上报，请前往异常处理模块跟进')
  }).catch(() => {})
}

function exportCsv() {
  const headers = ['调度单号', '车牌号', '司机', '商品', '数量(吨)', '装货场站', '卸货场站', '下发时间', '状态']
  const rows = filtered.value.map((d) => [
    d.id,
    find.vehicle(d.vehicleId)?.plate || '',
    find.driver(d.driverId)?.name || '',
    find.commodity(d.commodityId)?.name || '',
    d.quantity,
    find.terminal(d.loadTerminalId)?.name || '',
    find.terminal(d.unloadTerminalId)?.name || '',
    d.dispatchTime,
    statusMap[d.status].label
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `调度单_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条调度单`)
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
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
</style>
