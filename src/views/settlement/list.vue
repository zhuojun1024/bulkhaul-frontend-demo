<template>
  <div class="page" v-loading="loading">
    <PageHeader title="结算管理" desc="按合同月度汇总运费，对账、结算与逾期跟踪">
      <el-button v-if="can('settlement')" type="primary" :icon="DocumentAdd" @click="openGenerate">生成结算单</el-button>
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
      <el-button v-if="can('invoice')" :icon="Postcard" @click="$router.push('/settlement/invoice')">发票管理</el-button>
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
            <el-input v-model="filter.keyword" placeholder="账单号 / 合同号 / 客户" :prefix-icon="Search" clearable style="width: 220px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.status" placeholder="结算状态" clearable>
              <el-option v-for="(v, k) in statusMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.period" placeholder="结算周期" clearable>
              <el-option v-for="p in periods" :key="p" :label="p" :value="p" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe @row-click="goDetail">
          <el-table-column prop="billNo" label="账单编号" width="140" fixed>
            <template #default="{ row }">
              <span class="link" @click.stop="goDetail(row)">{{ row.billNo }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="contractId" label="合同编号" width="100" />
          <el-table-column label="客户" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ find.customer(row.customerId)?.name }}</template>
          </el-table-column>
          <el-table-column prop="period" label="结算周期" width="100" />
          <el-table-column label="车次" width="80" align="right">
            <template #default="{ row }">{{ row.dispatchCount }}</template>
          </el-table-column>
          <el-table-column label="运量(吨)" width="100" align="right">
            <template #default="{ row }">{{ formatNum(row.totalQuantity) }}</template>
          </el-table-column>
          <el-table-column label="结算金额" width="140" align="right">
            <template #default="{ row }">
              <span class="num amount">{{ formatMoney(row.totalAmount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="已付金额" width="140" align="right">
            <template #default="{ row }">
              <span class="num">{{ formatMoney(row.paidAmount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="发票" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="invoiceType(row.invoiceStatus)" effect="plain">
                {{ invoiceMap[row.invoiceStatus] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <el-button
                v-if="row.status === 'pending' && can('settlement')"
                link type="warning" size="small"
                @click.stop="startReconcile(row)"
              >对账</el-button>
              <el-button
                v-if="row.status === 'reconciling' && can('settlement')"
                link type="success" size="small"
                @click.stop="settle(row)"
              >结算</el-button>
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

    <!-- 生成结算单 -->
    <el-dialog v-model="genDialog" title="生成结算单" width="760px">
      <el-alert type="info" :closable="false" style="margin-bottom: 12px">
        按「合同 + 月份（卸货时间）」聚合已完成且未入账单的车次，生成后账单进入"待对账"，可发起对账三方比对。
      </el-alert>
      <el-table ref="genTableRef" :data="candidates" stripe size="small" @selection-change="onGenSelect">
        <el-table-column type="selection" width="45" />
        <el-table-column prop="contractId" label="合同编号" width="110" />
        <el-table-column label="客户" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ find.customer(row.customerId)?.name }}</template>
        </el-table-column>
        <el-table-column prop="period" label="结算周期" width="100" />
        <el-table-column label="车次" width="80" align="right">
          <template #default="{ row }">{{ row.dispatchCount }}</template>
        </el-table-column>
        <el-table-column label="运量(吨)" width="100" align="right">
          <template #default="{ row }">{{ formatNum(row.quantity) }}</template>
        </el-table-column>
        <el-table-column label="预估运费(元)" width="130" align="right">
          <template #default="{ row }">
            <span class="num">{{ formatMoney(row.freight) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="genDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!selectedGroups.length" @click="confirmGenerate">
          生成{{ selectedGroups.length ? `（${selectedGroups.length}）` : '' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'Settlement' })
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Download, Refresh, Postcard, DocumentAdd } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { settlementCandidates, generateSettlements, startReconcile as flowStartReconcile, confirmSettle } from '@/mock/flow'
import { usePerm } from '@/permission'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()

const { can } = usePerm()

const router = useRouter()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 300))

const statusMap = {
  pending: { label: '待对账', type: 'info' },
  reconciling: { label: '对账中', type: 'warning' },
  settled: { label: '已结算', type: 'success' },
  overdue: { label: '已逾期', type: 'danger' }
}
const invoiceMap = { 'not-issued': '未开票', issued: '已开票', pending: '开票中' }

const filter = reactive({ keyword: '', status: '', period: '' })
const page = ref(1)
const pageSize = ref(10)

const periods = computed(() => [...new Set(db.settlements.map((s) => s.period))].sort().reverse())

const statItems = computed(() => {
  const count = (s) => db.settlements.filter((x) => x.status === s).length
  return [
    { key: '', label: '全部账单', count: db.settlements.length, color: tokens.primary },
    { key: 'pending', label: '待对账', count: count('pending'), color: tokens.info },
    { key: 'reconciling', label: '对账中', count: count('reconciling'), color: tokens.warning },
    { key: 'settled', label: '已结算', count: count('settled'), color: tokens.success },
    { key: 'overdue', label: '已逾期', count: count('overdue'), color: tokens.danger }
  ]
})

const filtered = computed(() =>
  db.settlements.filter((s) => {
    if (filter.status && s.status !== filter.status) return false
    if (filter.period && s.period !== filter.period) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      const customerName = find.customer(s.customerId)?.name || ''
      if (!s.billNo.toLowerCase().includes(kw) && !s.contractId.toLowerCase().includes(kw) && !customerName.includes(filter.keyword)) return false
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
  filter.period = ''
  page.value = 1
}

function goDetail(row) {
  router.push(`/settlement/${row.id}`)
}

function invoiceType(status) {
  return { issued: 'success', pending: 'warning', 'not-issued': 'info' }[status] || 'info'
}

function startReconcile(row) {
  ElMessageBox.confirm(`开始对账 ${row.billNo}？将执行调度量 vs 磅单净重 vs 结算量三方比对。`, '发起对账', { type: 'info' }).then(() => {
    const r = flowStartReconcile(row)
    ElMessage.success(r.diffCount ? `对账完成：${r.diffCount} 车次存在差异` : '对账完成：无差异')
  }).catch(() => {})
}

function settle(row) {
  const r = row.reconciliation
  const lossWarn =
    r && r.lossQty > 0
      ? `<br/><span style="color:var(--color-warning)">本期损耗合计 ${r.lossQty} 吨（约 ${formatMoney(r.lossAmount)}），按出磅净重结算，损耗已扣减。</span>`
      : ''
  const diffWarn =
    r && r.diffCount
      ? `<br/><span style="color:var(--color-danger)">${r.diffCount} 车次结算量与磅单不一致，请确认后再结算。</span>`
      : ''
  ElMessageBox.confirm(
    `确认结算 ${row.billNo}？<br/>结算金额 ${formatMoney(row.totalAmount)}，结算后进入收款。${lossWarn}${diffWarn}`,
    '确认结算',
    { dangerouslyUseHTMLString: true, type: 'success', confirmButtonText: '确认结算' }
  ).then(() => {
    const r = confirmSettle(row)
    if (r && r.error) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success('结算完成，进入收款')
  }).catch(() => {})
}

/* ===== 生成结算单 ===== */
const genDialog = ref(false)
const genTableRef = ref()
const candidates = ref([])
const selectedGroups = ref([])

function openGenerate() {
  candidates.value = settlementCandidates()
  if (!candidates.value.length) {
    ElMessage.info('暂无已完成且未入账单的车次')
    return
  }
  genDialog.value = true
  nextTick(() => {
    genTableRef.value?.clearSelection()
    candidates.value.forEach((row) => genTableRef.value?.toggleRowSelection(row, true))
  })
}

function onGenSelect(rows) {
  selectedGroups.value = rows
}

function confirmGenerate() {
  const created = generateSettlements(selectedGroups.value.map((g) => g.key))
  genDialog.value = false
  ElMessage.success(`已生成 ${created.length} 张结算单，可发起对账`)
}

function exportCsv() {
  const headers = ['账单编号', '合同编号', '客户', '结算周期', '车次', '运量(吨)', '结算金额(元)', '已付(元)', '状态']
  const rows = filtered.value.map((s) => [
    s.billNo, s.contractId, find.customer(s.customerId)?.name || '', s.period, s.dispatchCount, s.totalQuantity, s.totalAmount, s.paidAmount, statusMap[s.status].label
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `结算单_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条结算单`)
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

.amount {
  font-weight: 600;
}
</style>
