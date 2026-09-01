<template>
  <div class="page">
    <PageHeader title="调度管理" desc="调度单是运输执行的指令，覆盖派车、装货、在途、卸货全流程">
      <el-tag v-if="scopeRegions.length" type="warning" effect="plain">数据范围：{{ scopeRegions.join('、') }}（装货侧）</el-tag>
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
          <el-table-column label="车辆/单元" width="130">
            <template #default="{ row }">
              <span v-if="row.unitNo" :title="row.mode + ' · 运输单元'">{{ row.unitNo }}</span>
              <span v-else>{{ find.vehicle(row.vehicleId)?.plate || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="司机" width="90">
            <template #default="{ row }">{{ find.driver(row.driverId)?.name || '—' }}</template>
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
          <ActionColumn width="300" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <template v-if="can('dispatch')">
                <el-button
                  v-if="row.status === 'pending'"
                  link type="warning" size="small"
                  @click.stop="confirmLoad(row)"
                >确认装货</el-button>
                <el-button
                  v-if="row.status === 'pending' && isRoadMode(row.mode)"
                  link type="primary" size="small"
                  @click.stop="reassign(row)"
                >改派</el-button>
                <el-button
                  v-if="row.status === 'pending'"
                  link type="danger" size="small"
                  @click.stop="cancel(row)"
                >取消</el-button>
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
                @click.stop="openReport(row)"
              >报异常</el-button>
            </template>
          </ActionColumn>
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

    <!-- 上报异常（类型 + 级别 + 描述） -->
    <el-dialog v-model="excDialog" title="上报异常" width="480px">
      <div v-if="excTarget">
        <el-alert :title="'调度单 ' + excTarget.id + '（' + unitLabel(excTarget) + '）'" type="warning" :closable="false" show-icon />
        <el-form label-width="80px" style="margin-top: 16px">
          <el-form-item label="异常类型" required>
            <el-select v-model="excForm.type" style="width: 100%">
              <el-option v-for="(v, k) in excTypeMap" :key="k" :label="v" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item label="级别" required>
            <el-select v-model="excForm.level" style="width: 100%">
              <el-option v-for="(v, k) in excLevelMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item label="描述" required>
            <el-input v-model="excForm.description" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请简述异常情况" />
          </el-form-item>
        </el-form>
        <div v-if="excForm.type === 'accident'" class="exc-tip">事故类异常将同步生成事故记录，进入安全管理模块跟踪。</div>
      </div>
      <template #footer>
        <el-button @click="excDialog = false">取消</el-button>
        <el-button type="danger" @click="submitException">上报</el-button>
      </template>
    </el-dialog>

    <!-- 改派调度单（装货前换车/换司机） -->
    <el-dialog v-model="reassignDialog" title="改派调度单" width="460px">
      <div v-if="reassignTarget">
        <el-alert type="info" :closable="false" style="margin-bottom: 12px">
          调度单 {{ reassignTarget.id }} 当前车辆 {{ find.vehicle(reassignTarget.vehicleId)?.plate || '—' }} / 司机 {{ find.driver(reassignTarget.driverId)?.name || '—' }}。改派后需司机重新接单。
        </el-alert>
        <el-form label-width="90px">
          <el-form-item label="目标车辆" required>
            <el-select v-model="reassignVehicle" filterable placeholder="选择空闲车辆" style="width: 100%">
              <el-option v-for="v in reassignVehicles" :key="v.id" :label="v.label" :value="v.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标司机" required>
            <el-select v-model="reassignDriver" filterable placeholder="选择空闲司机" style="width: 100%">
              <el-option v-for="x in reassignDrivers" :key="x.id" :label="x.label" :value="x.id" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="reassignDialog = false">取消</el-button>
        <el-button type="primary" @click="submitReassign">确认改派</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'Dispatch' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
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
  resumeDispatch,
  cancelDispatch as flowCancelDispatch,
  reassignDispatch as flowReassignDispatch,
  isRoadMode,
  visibleDispatches,
  dataScopeOf
} from '@/mock/flow'
import { useCollection } from '@/composables/useCollection'
import { isProduction } from '@/mode'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()

const router = useRouter()

const statusMap = {
  pending: { label: '待装货', type: 'info' },
  loading: { label: '装货中', type: 'warning' },
  intransit: { label: '在途', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  exception: { label: '异常', type: 'danger' },
  cancelled: { label: '已取消', type: 'info' }
}

const filter = reactive({ keyword: '', status: '', commodityId: '', dateRange: [] })
const page = ref(1)
const pageSize = ref(10)

// 环节8：数据权限（行级）——列表只展示当前操作人数据范围内的调度单（装货侧区域）
// Phase 4 灰度：生产模式读后端 /api/coll/dispatches（后端已按当前操作人装货侧区域行级过滤，与 visibleDispatches 同口径）
const PROD = isProduction()
const listCol = useCollection('dispatches', () => ({ key: 'dispatches:list' }))
const scoped = computed(() => PROD ? listCol.data.value : visibleDispatches())
const scopeRegions = computed(() => dataScopeOf().regions)

const statItems = computed(() => {
  const count = (s) => scoped.value.filter((d) => d.status === s).length
  return [
    { key: '', label: '全部调度单', count: scoped.value.length, color: tokens.primary },
    { key: 'pending', label: '待装货', count: count('pending'), color: tokens.info },
    { key: 'loading', label: '装货中', count: count('loading'), color: tokens.warning },
    { key: 'intransit', label: '在途', count: count('intransit'), color: tokens.primary },
    { key: 'completed', label: '已完成', count: count('completed'), color: tokens.success },
    { key: 'exception', label: '异常', count: count('exception'), color: tokens.danger }
  ]
})

const filtered = computed(() =>
  scoped.value.filter((d) => {
    if (filter.status && d.status !== filter.status) return false
    if (filter.commodityId && d.commodityId !== filter.commodityId) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      const plate = (find.vehicle(d.vehicleId)?.plate || '').toLowerCase()
      const unit = (d.unitNo || '').toLowerCase()
      const driver = find.driver(d.driverId)?.name || ''
      if (!d.id.toLowerCase().includes(kw) && !plate.includes(kw) && !unit.includes(kw) && !driver.includes(filter.keyword)) return false
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

if (PROD) {
  onMounted(() => { listCol.refresh() })
  const onRefreshed = () => { listCol.refresh() }
  window.addEventListener('blms:refreshed', onRefreshed)
  onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))
}

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

/** 执行主体展示：公路口径取车牌，非公路口径取运输单元号 */
const unitLabel = (d) => find.vehicle(d.vehicleId)?.plate || d.unitNo || d.id

/** 状态机守卫拦截提示（flow 返回 { error } 时） */
function guardError(r) {
  if (r && r.error) {
    ElMessage.error(r.error)
    return true
  }
  return false
}

function confirmLoad(row) {
  const road = isRoadMode(row.mode)
  ElMessageBox.confirm(
    road
      ? `确认 ${unitLabel(row)} 已完成装货？<br/>将自动登记进磅单。`
      : `确认 ${unitLabel(row)} 已完成装货？`,
    '确认装货',
    { dangerouslyUseHTMLString: road, type: 'info', confirmButtonText: '确认装货' }
  ).then(() => {
    if (guardError(flowConfirmLoad(row))) return
    ElMessage.success(road ? '装货确认成功，进磅单已登记' : '装货确认成功')
  }).catch(() => {})
}

function depart(row) {
  ElMessageBox.confirm(
    `确认 ${unitLabel(row)} 发车开始运输？`,
    '发车确认',
    { type: 'info', confirmButtonText: '确认发车' }
  ).then(() => {
    if (guardError(flowDepart(row))) return
    ElMessage.success('已发车，进入在途状态')
  }).catch(() => {})
}

function arrive(row) {
  ElMessageBox.confirm(
    `确认 ${unitLabel(row)} 已到达卸货场站，开始卸货？`,
    '到达确认',
    { type: 'info', confirmButtonText: '确认到达' }
  ).then(() => {
    if (guardError(flowArrive(row))) return
    ElMessage.success('已到达，进入卸货状态')
  }).catch(() => {})
}

function confirmUnload(row) {
  const road = isRoadMode(row.mode)
  ElMessageBox.confirm(
    road
      ? `确认 ${unitLabel(row)} 已完成卸货？<br/>将自动登记出磅单并结算运费。`
      : `确认 ${unitLabel(row)} 已完成卸货？<br/>将按调度量结算运费。`,
    '确认卸货',
    { dangerouslyUseHTMLString: road, type: 'success', confirmButtonText: '确认卸货' }
  ).then(() => {
    if (guardError(flowConfirmUnload(row))) return
    ElMessage.success('卸货确认成功，本次运输已完成')
  }).catch(() => {})
}

/* ===== 取消 / 改派（装货前） ===== */
function cancel(row) {
  ElMessageBox.prompt(`取消调度单 ${row.id}？请填写取消原因（车辆故障/客户改期等）。`, '取消调度单', {
    type: 'warning',
    confirmButtonText: '确认取消',
    inputPlaceholder: '取消原因',
    inputValidator: (v) => (v && v.trim() ? true : '请填写取消原因')
  }).then(({ value }) => {
    if (guardError(flowCancelDispatch(row, value))) return
    ElMessage.success('调度单已取消')
  }).catch(() => {})
}

const reassignDialog = ref(false)
const reassignTarget = ref(null)
const reassignVehicle = ref('')
const reassignDriver = ref('')

/** 可改派车辆：空闲、年检未过期、无其他未完结车次（排除本单） */
const reassignVehicles = computed(() => {
  const t = reassignTarget.value
  const busy = new Set(db.dispatches.filter((x) => x.id !== t?.id && ['pending', 'loading', 'intransit', 'unloading', 'exception'].includes(x.status)).map((x) => x.vehicleId))
  return db.vehicles.filter((v) => v.type !== '铁路敞车' && v.type !== '散货船' && v.status === 'idle' && !busy.has(v.id)).map((v) => ({ id: v.id, label: `${v.plate}（${v.type}）` }))
})
/** 可改派司机：空闲、无其他未完结车次（排除本单） */
const reassignDrivers = computed(() => {
  const t = reassignTarget.value
  const busy = new Set(db.dispatches.filter((x) => x.id !== t?.id && ['pending', 'loading', 'intransit', 'unloading', 'exception'].includes(x.status)).map((x) => x.driverId))
  return db.drivers.filter((x) => x.status === 'available' && !busy.has(x.id)).map((x) => ({ id: x.id, label: x.name }))
})

function reassign(row) {
  reassignTarget.value = row
  reassignVehicle.value = ''
  reassignDriver.value = ''
  reassignDialog.value = true
}

function submitReassign() {
  if (!reassignVehicle.value || !reassignDriver.value) {
    ElMessage.warning('请选择目标车辆与司机')
    return
  }
  if (guardError(flowReassignDispatch(reassignTarget.value, reassignVehicle.value, reassignDriver.value))) return
  reassignDialog.value = false
  ElMessage.success('改派成功，需司机重新接单')
}

function resume(row) {
  ElMessageBox.confirm(
    `确认调度单 ${row.id} 恢复运输？`,
    '恢复运输',
    { type: 'warning', confirmButtonText: '确认恢复' }
  ).then(() => {
    if (guardError(resumeDispatch(row))) return
    ElMessage.success('已恢复运输')
  }).catch(() => {})
}

/* ===== 上报异常（类型 + 级别 + 描述，事故类联动安全模块） ===== */
const excDialog = ref(false)
const excTarget = ref(null)
const excForm = reactive({ type: 'other', level: 'medium', description: '' })
const excTypeMap = { delay: '延误', accident: '事故', damage: '货损', quality: '质量', overload: '超载', other: '其他' }
const excLevelMap = {
  low: { label: '低', type: 'info' },
  medium: { label: '中', type: 'warning' },
  high: { label: '高', type: 'danger' }
}

function openReport(row) {
  excTarget.value = row
  excForm.type = 'other'
  excForm.level = 'medium'
  excForm.description = ''
  excDialog.value = true
}

function submitException() {
  if (!excForm.description.trim() || excForm.description.trim().length < 2) {
    ElMessage.warning('描述至少 2 个字符')
    return
  }
  const r = flowReportException(excTarget.value, excForm.description.trim(), excForm.type, excForm.level)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  excDialog.value = false
  ElMessage.warning('异常已上报，请前往异常处理模块跟进')
}

function exportCsv() {
  const headers = ['调度单号', '车辆/单元', '司机', '商品', '数量(吨)', '装货场站', '卸货场站', '方式', '下发时间', '状态']
  const rows = filtered.value.map((d) => [
    d.id,
    unitLabel(d),
    find.driver(d.driverId)?.name || '',
    find.commodity(d.commodityId)?.name || '',
    d.quantity,
    find.terminal(d.loadTerminalId)?.name || '',
    find.terminal(d.unloadTerminalId)?.name || '',
    d.mode || '公路',
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

.exc-tip {
  font-size: 12px;
  color: var(--text-secondary);
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
