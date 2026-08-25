<template>
  <div class="page">
    <PageHeader title="库存管理" desc="各仓库商品批次库存，支持手工入库、锁定与临期预警">
      <el-button v-if="can('warehouse')" type="primary" :icon="Plus" @click="openInboundDialog">手工入库</el-button>
      <el-button v-if="can('warehouse')" :icon="Setting" @click="openSqDialog">安全库存设置</el-button>
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
    </PageHeader>

    <div class="stat-row">
      <StatCard title="库存批次" :value="db.inventories.length" unit="批" icon="Tickets" color="var(--color-primary)" />
      <StatCard title="库存总量" :value="formatNum(totalQuantity)" unit="吨" icon="Box" color="var(--color-success)" />
      <StatCard title="锁定库存" :value="formatNum(lockedQuantity)" unit="吨" icon="Lock" color="var(--color-warning)" :sub="'已分配未出库'" />
      <StatCard title="临期批次" :value="nearExpiryCount" unit="批" icon="AlarmClock" color="var(--color-danger)" :sub="'入库超 60 天'" />
      <StatCard title="低于安全库存" :value="alerts.length" unit="项" icon="Warning" color="var(--color-danger)" :sub="'可发库存 < 安全库存下限'" />
    </div>

    <!-- 环节7：安全库存预警（可发库存跌破下限的仓库×商品，出库/锁定穿越阈值时定向通知仓储角色） -->
    <div v-if="alerts.length" class="panel sq-alerts">
      <div class="panel__header">
        <span class="panel__title">安全库存预警（{{ alerts.length }} 项）</span>
        <span class="sq-alerts__tip">可发库存低于安全库存下限，请及时安排补库；出库/锁定跌破下限时将自动通知仓储角色</span>
      </div>
      <div class="panel__body">
        <el-table :data="alerts" stripe size="small">
          <el-table-column label="仓库" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ find.warehouse(row.warehouseId)?.name }}</template>
          </el-table-column>
          <el-table-column label="商品" width="120" align="center">
            <template #default="{ row }">{{ find.commodity(row.commodityId)?.name }}</template>
          </el-table-column>
          <el-table-column label="可发库存(吨)" width="130" align="right">
            <template #default="{ row }"><span class="num text-danger">{{ formatNum(row.available) }}</span></template>
          </el-table-column>
          <el-table-column label="安全库存下限(吨)" width="150" align="right">
            <template #default="{ row }"><span class="num">{{ formatNum(row.minQty) }}</span></template>
          </el-table-column>
          <el-table-column label="缺口(吨)" width="120" align="right">
            <template #default="{ row }"><span class="num text-danger">{{ formatNum(row.gap) }}</span></template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="批次号 / 商品" :prefix-icon="Search" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.warehouseId" placeholder="仓库" clearable>
              <el-option v-for="w in db.warehouses" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.commodityId" placeholder="商品" clearable>
              <el-option v-for="c in db.commodities" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.status" placeholder="状态" clearable style="width: 120px">
              <el-option v-for="(v, k) in statusMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe>
          <el-table-column prop="id" label="库存编号" width="110" fixed />
          <el-table-column label="仓库" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ find.warehouse(row.warehouseId)?.name }}</template>
          </el-table-column>
          <el-table-column label="商品" width="100" align="center">
            <template #default="{ row }">{{ find.commodity(row.commodityId)?.name }}</template>
          </el-table-column>
          <el-table-column prop="batch" label="批次号" width="130" />
          <el-table-column label="库存量(吨)" width="110" align="right">
            <template #default="{ row }">
              <span class="num">{{ formatNum(row.quantity) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="安全库存(吨)" width="120" align="right">
            <template #default="{ row }">
              <span class="num">{{ sqOf(row) ? formatNum(sqOf(row).minQty) : '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="inDate" label="入库日期" width="110" />
          <el-table-column label="库龄" width="90" align="center">
            <template #default="{ row }">
              <span :class="{ 'text-danger': ageDays(row.inDate) > 60 }">{{ ageDays(row.inDate) }} 天</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
            </template>
          </el-table-column>
          <ActionColumn width="130" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 'normal' && can('warehouse')"
                link type="warning" size="small"
                @click="lockRow(row)"
              >锁定</el-button>
              <el-button
                v-if="row.status === 'locked' && can('warehouse')"
                link type="success" size="small"
                @click="unlockRow(row)"
              >解锁</el-button>
              <el-button
                v-if="row.status !== 'near-expiry' && can('warehouse')"
                link type="danger" size="small"
                @click="expireRow(row)"
              >标记临期</el-button>
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

    <!-- 环节7：安全库存设置（仓库×商品 可发库存下限，upsert） -->
    <el-dialog v-model="sqDialog" title="安全库存设置" width="440px">
      <el-form :model="sqForm" label-width="90px">
        <el-form-item label="仓库" required>
          <el-select v-model="sqForm.warehouseId" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in db.warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="商品" required>
          <el-select v-model="sqForm.commodityId" placeholder="选择商品" style="width: 100%">
            <el-option v-for="c in db.commodities" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="安全库存" required>
          <el-input-number v-model="sqForm.minQty" :min="0" :step="100" controls-position="right" style="width: 100%" />
          <div class="sq-tip">可发库存（正常批次合计）跌破该下限时发出预警并通知仓储角色</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="sqDialog = false">取消</el-button>
        <el-button type="primary" @click="saveSq">保存</el-button>
      </template>
    </el-dialog>

    <!-- F2：手工入库/补库（采购到货/外采直入，RBAC warehouse） -->
    <el-dialog v-model="inboundDialog" title="手工入库" width="460px">
      <el-form :model="inboundForm" label-width="90px">
        <el-form-item label="仓库" required>
          <el-select v-model="inboundForm.warehouseId" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in db.warehouses" :key="w.id" :label="`${w.name}（占用 ${w.used}/${w.capacity} 吨）`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="商品" required>
          <el-select v-model="inboundForm.commodityId" placeholder="选择商品" style="width: 100%">
            <el-option v-for="c in db.commodities" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="入库量" required>
          <el-input-number v-model="inboundForm.quantity" :min="1" :step="100" controls-position="right" style="width: 100%" />
          <div class="sq-tip">单位：吨。入库后生成新批次（状态正常，可发库存增加）</div>
        </el-form-item>
        <el-form-item label="批次号">
          <el-input v-model="inboundForm.batch" placeholder="缺省自动生成 B{日期}-M{序号}" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="inboundForm.remark" placeholder="如：采购到货 / 外采直入" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="inboundDialog = false">取消</el-button>
        <el-button type="primary" @click="saveInbound">入库</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'Inventory' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search, Download, Refresh, Setting, Plus } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { setInventoryStatus, inventoryAlerts, safetyStockOf, setSafetyStock, manualInbound } from '@/mock/flow'
import { formatNum } from '@/utils'
import dayjs from 'dayjs'
import { usePerm } from '@/permission'

const route = useRoute()
const { can } = usePerm()

const statusMap = {
  normal: { label: '正常', type: 'success' },
  locked: { label: '已锁定', type: 'warning' },
  'near-expiry': { label: '临期', type: 'danger' }
}

const filter = reactive({
  keyword: '',
  warehouseId: route.query.warehouseId || '',
  commodityId: '',
  status: ''
})
const page = ref(1)
const pageSize = ref(10)

const filtered = computed(() =>
  db.inventories.filter((inv) => {
    if (filter.warehouseId && inv.warehouseId !== filter.warehouseId) return false
    if (filter.commodityId && inv.commodityId !== filter.commodityId) return false
    if (filter.status && inv.status !== filter.status) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      const name = find.commodity(inv.commodityId)?.name || ''
      if (!inv.batch.toLowerCase().includes(kw) && !name.includes(filter.keyword)) return false
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
  filter.warehouseId = ''
  filter.commodityId = ''
  filter.status = ''
  page.value = 1
}

const totalQuantity = computed(() => db.inventories.reduce((s, i) => s + i.quantity, 0))
const lockedQuantity = computed(() => db.inventories.filter((i) => i.status === 'locked').reduce((s, i) => s + i.quantity, 0))
const nearExpiryCount = computed(() => db.inventories.filter((i) => i.status === 'near-expiry').length)

/** 环节7：安全库存预警（可发库存 < 下限的仓库×商品）与批次行安全库存 */
const alerts = computed(() => inventoryAlerts())
const sqOf = (row) => safetyStockOf(row.warehouseId, row.commodityId)

/* ===== 安全库存设置（RBAC warehouse，服务层 upsert + 审计） ===== */
const sqDialog = ref(false)
const sqForm = reactive({ warehouseId: '', commodityId: '', minQty: 1000 })

function openSqDialog() {
  Object.assign(sqForm, { warehouseId: '', commodityId: '', minQty: 1000 })
  sqDialog.value = true
}

function saveSq() {
  if (!sqForm.warehouseId || !sqForm.commodityId) {
    ElMessage.warning('请选择仓库和商品')
    return
  }
  const r = setSafetyStock(sqForm.warehouseId, sqForm.commodityId, sqForm.minQty)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  sqDialog.value = false
  ElMessage.success('安全库存下限已保存')
}

/* ===== F2：手工入库/补库（RBAC warehouse，服务层守卫 + 审计） ===== */
const inboundDialog = ref(false)
const inboundForm = reactive({ warehouseId: '', commodityId: '', quantity: 100, batch: '', remark: '' })

function openInboundDialog() {
  Object.assign(inboundForm, { warehouseId: '', commodityId: '', quantity: 100, batch: '', remark: '' })
  inboundDialog.value = true
}

function saveInbound() {
  if (!inboundForm.warehouseId || !inboundForm.commodityId) {
    ElMessage.warning('请选择仓库和商品')
    return
  }
  const r = manualInbound(inboundForm.warehouseId, inboundForm.commodityId, inboundForm.quantity, inboundForm.batch, inboundForm.remark)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  inboundDialog.value = false
  ElMessage.success(`入库成功，批次 ${r.batch}`)
}

function ageDays(inDate) {
  return dayjs().diff(dayjs(inDate), 'day')
}

function lockRow(row) {
  // 写操作下沉服务层（P2）：状态守卫 + RBAC + 审计
  const r = setInventoryStatus(row, 'locked')
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(`批次 ${row.batch} 已锁定`)
}

function unlockRow(row) {
  const r = setInventoryStatus(row, 'normal')
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(`批次 ${row.batch} 已解锁`)
}

function expireRow(row) {
  const r = setInventoryStatus(row, 'near-expiry')
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.warning(`批次 ${row.batch} 已标记临期`)
}

function exportCsv() {
  const headers = ['库存编号', '仓库', '商品', '批次号', '库存量(吨)', '安全库存(吨)', '入库日期', '状态']
  const rows = filtered.value.map((i) => [
    i.id,
    find.warehouse(i.warehouseId)?.name || '',
    find.commodity(i.commodityId)?.name || '',
    i.batch,
    i.quantity,
    sqOf(i) ? sqOf(i).minQty : '',
    i.inDate,
    statusMap[i.status].label
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `库存明细_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条库存`)
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

.sq-alerts {
  margin-top: 12px;
}

.sq-alerts__tip {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}

.sq-tip {
  width: 100%;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.text-danger {
  color: var(--color-danger);
  font-weight: 600;
}
</style>
