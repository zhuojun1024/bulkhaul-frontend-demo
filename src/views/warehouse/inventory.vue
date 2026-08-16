<template>
  <div class="page">
    <PageHeader title="库存管理" desc="各仓库商品批次库存，支持锁定与临期预警">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
    </PageHeader>

    <div class="stat-row">
      <StatCard title="库存批次" :value="db.inventories.length" unit="批" icon="Tickets" color="var(--color-primary)" />
      <StatCard title="库存总量" :value="formatNum(totalQuantity)" unit="吨" icon="Box" color="var(--color-success)" />
      <StatCard title="锁定库存" :value="formatNum(lockedQuantity)" unit="吨" icon="Lock" color="var(--color-warning)" :sub="'已分配未出库'" />
      <StatCard title="临期批次" :value="nearExpiryCount" unit="批" icon="AlarmClock" color="var(--color-danger)" :sub="'入库超 60 天'" />
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
          <el-table-column label="操作" width="130" align="center" fixed="right">
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
defineOptions({ name: 'Inventory' })
import { ref, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { logAction } from '@/mock/flow'
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

function ageDays(inDate) {
  return dayjs().diff(dayjs(inDate), 'day')
}

function lockRow(row) {
  row.status = 'locked'
  logAction('仓储管理', '库存锁定', `批次 ${row.batch} 锁定 ${row.quantity} 吨（${find.warehouse(row.warehouseId)?.name || '-'}）`)
  ElMessage.success(`批次 ${row.batch} 已锁定`)
}

function unlockRow(row) {
  row.status = 'normal'
  logAction('仓储管理', '库存解锁', `批次 ${row.batch} 解锁 ${row.quantity} 吨（${find.warehouse(row.warehouseId)?.name || '-'}）`)
  ElMessage.success(`批次 ${row.batch} 已解锁`)
}

function expireRow(row) {
  row.status = 'near-expiry'
  logAction('仓储管理', '标记临期', `批次 ${row.batch} 标记临期（库龄 ${ageDays(row.inDate)} 天）`)
  ElMessage.warning(`批次 ${row.batch} 已标记临期`)
}

function exportCsv() {
  const headers = ['库存编号', '仓库', '商品', '批次号', '库存量(吨)', '入库日期', '状态']
  const rows = filtered.value.map((i) => [
    i.id,
    find.warehouse(i.warehouseId)?.name || '',
    find.commodity(i.commodityId)?.name || '',
    i.batch,
    i.quantity,
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
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.text-danger {
  color: var(--color-danger);
  font-weight: 600;
}
</style>
