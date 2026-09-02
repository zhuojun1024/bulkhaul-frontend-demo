<template>
  <div class="page">
    <PageHeader title="车辆管理" desc="自有与外协运力资源管理，含维保与年检状态跟踪">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
      <el-button v-if="can('vehicle')" :icon="Upload" @click="openImport">导入</el-button>
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
            <el-input v-model="filter.keyword" placeholder="车牌号 / 车辆ID" :prefix-icon="Search" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.type" placeholder="车辆类型" clearable>
              <el-option v-for="t in types" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.owner" placeholder="归属" clearable>
              <el-option label="自有" value="自有" />
              <el-option label="外协" value="外协" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe @row-click="goDetail">
          <el-table-column prop="plate" label="车牌号" width="130" fixed>
            <template #default="{ row }">
              <span class="link" @click.stop="goDetail(row)">{{ row.plate }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="type" label="类型" width="110" align="center" />
          <el-table-column label="核定载重" width="100" align="right">
            <template #default="{ row }">{{ row.capacity }} t</template>
          </el-table-column>
          <el-table-column prop="owner" label="归属" width="80" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.owner === '自有' ? 'primary' : 'info'" effect="plain">
                {{ row.owner }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="fuelType" label="燃料" width="80" align="center" />
          <el-table-column prop="purchaseDate" label="购置日期" min-width="110" />
          <el-table-column label="下次年检" width="110">
            <template #default="{ row }">
              <span :class="{ 'text-danger': isSoon(row.nextInspection) }">{{ row.nextInspection }}</span>
            </template>
          </el-table-column>
          <el-table-column label="累计里程" width="110" align="right">
            <template #default="{ row }">{{ formatNum(row.mileage) }} km</template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
            </template>
          </el-table-column>
          <ActionColumn width="160" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <el-button
                v-if="row.status === 'idle' && can('vehicle')"
                link type="warning" size="small"
                @click.stop="sendRepair(row)"
              >报修</el-button>
              <el-button
                v-if="row.status === 'maintenance' && can('vehicle')"
                link type="success" size="small"
                @click.stop="backToService(row)"
              >恢复</el-button>
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

    <!-- 数据导入（Excel/CSV） -->
    <ImportDialog
      v-model="importVisible"
      title="导入车辆"
      :columns="importColumns"
      :sample="importSample"
      :result="importResult"
      @confirm="doImport"
    />
  </div>
</template>

<script setup>
defineOptions({ name: 'Vehicle' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Download, Refresh, Upload } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import ImportDialog from '@/components/ImportDialog.vue'
import { db } from '@/data'
import { useCollection } from '@/composables/useCollection'
import { api } from '@/api'
import { formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()

const router = useRouter()

const statusMap = {
  inuse: { label: '运输中', type: 'primary' },
  idle: { label: '空闲', type: 'success' },
  maintenance: { label: '维修中', type: 'warning' },
  overload: { label: '超载预警', type: 'danger' },
  scrapped: { label: '已报废', type: 'info' }
}
const types = ['重型半挂车', '重型自卸车', '罐式运输车', '铁路敞车', '散货船']

const filter = reactive({ keyword: '', type: '', owner: '', status: '' })
const page = ref(1)
const pageSize = ref(10)

/* ===== Phase 4 灰度：生产模式（薄客户端）——车辆列表读后端 /api/coll/vehicles ===== */
const listCol = useCollection('vehicles', () => ({ key: 'vehicles:list' }))
const rows = computed(() => listCol.data.value)

const statItems = computed(() => {
  const count = (s) => rows.value.filter((v) => v.status === s).length
  return [
    { key: '', label: '全部车辆', count: rows.value.length, color: tokens.primary },
    { key: 'inuse', label: '运输中', count: count('inuse'), color: tokens.primary },
    { key: 'idle', label: '空闲', count: count('idle'), color: tokens.success },
    { key: 'maintenance', label: '维修中', count: count('maintenance'), color: tokens.warning },
    { key: 'overload', label: '超载预警', count: count('overload'), color: tokens.danger }
  ]
})

const filtered = computed(() =>
  rows.value.filter((v) => {
    if (filter.status && v.status !== filter.status) return false
    if (filter.type && v.type !== filter.type) return false
    if (filter.owner && v.owner !== filter.owner) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      if (!v.plate.toLowerCase().includes(kw) && !v.id.toLowerCase().includes(kw)) return false
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
  filter.type = ''
  filter.owner = ''
  filter.status = ''
  page.value = 1
}

onMounted(() => { listCol.refresh() })
const onRefreshed = () => { listCol.refresh() }
window.addEventListener('blms:refreshed', onRefreshed)
onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))

/* ===== Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 列表重取 =====
 * 后端业务错误经 ApiResult.success 包装为 data.error（HTTP 200），须检查 r.data.error。 */
async function prodWrite(path, body) {
  const r = await api('POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return null
  }
  await listCol.refresh()
  return r.data
}

function goDetail(row) {
  router.push(`/vehicle/${row.id}`)
}

function isSoon(date) {
  return dayjs(date).isBefore(dayjs().add(30, 'day'))
}

function sendRepair(row) {
  ElMessageBox.prompt('请输入报修原因', `车辆报修 - ${row.plate}`, {
    inputPattern: /.{2,}/,
    inputErrorMessage: '原因至少 2 个字符'
  }).then(async ({ value }) => {
    // Phase 4 引擎移除：生产模式写操作 = 后端权威（状态守卫 + RBAC + 审计）
    const d = await prodWrite('/admin/vehicle/' + row.id + '/repair', { reason: value })
    if (d) ElMessage.success(`${row.plate} 已报修，进入维修状态`)
  }).catch(() => {})
}

function backToService(row) {
  ElMessageBox.confirm(`确认 ${row.plate} 维修完成，恢复为空闲状态？`, '恢复车辆', { type: 'info' }).then(async () => {
    const d = await prodWrite('/admin/vehicle/' + row.id + '/resume')
    if (d) ElMessage.success(`${row.plate} 已恢复空闲`)
  }).catch(() => {})
}

/* ===== 数据导入（Excel/CSV → flow.importVehicles） ===== */
const importVisible = ref(false)
const importResult = ref(null)
const importColumns = [
  { key: 'plate', label: '车牌号', required: true },
  { key: 'type', label: '类型' },
  { key: 'capacity', label: '核定载重(吨)' },
  { key: 'owner', label: '归属(自有/外协)' },
  { key: 'fuelType', label: '燃料' }
]
const importSample = [['冀B·D12345', '重型半挂车', 35, '外协', '柴油']]

function openImport() {
  importResult.value = null
  importVisible.value = true
}

async function doImport(rows) {
  const r = await api('POST', '/admin/vehicle/import', rows)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '导入失败')
    return
  }
  importResult.value = r.data
  await listCol.refresh()
  ElMessage.success(`导入完成：新增 ${(r.data.created || []).length} 条，跳过重复 ${(r.data.skipped || []).length} 条${(r.data.errors || []).length ? `，失败 ${r.data.errors.length} 条` : ''}`)
}

function exportCsv() {
  const headers = ['车牌号', '类型', '核定载重(吨)', '归属', '燃料', '购置日期', '下次年检', '累计里程(km)', '状态']
  const rows = filtered.value.map((v) => [
    v.plate, v.type, v.capacity, v.owner, v.fuelType, v.purchaseDate, v.nextInspection, v.mileage, statusMap[v.status].label
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `车辆列表_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条车辆`)
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

.text-danger {
  color: var(--color-danger);
  font-weight: 600;
}
</style>
