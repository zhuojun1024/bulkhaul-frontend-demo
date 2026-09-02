<template>
  <div class="page">
    <PageHeader title="发票管理" desc="增值税发票开具、红冲与状态跟踪">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
    </PageHeader>

    <div class="stat-row">
      <StatCard title="发票总数" :value="rows.length" unit="张" icon="Postcard" color="var(--color-primary)" />
      <StatCard title="已开具" :value="issuedCount" unit="张" icon="CircleCheck" color="var(--color-success)" :sub="'金额 ' + formatMoney(issuedAmount) + (staleCount ? ' · 金额陈旧 ' + staleCount + ' 张' : '')" />
      <StatCard title="待开具" :value="pendingCount" unit="张" icon="Clock" color="var(--color-warning)" />
      <StatCard title="已红冲" :value="redFlushedCount" unit="张" icon="RefreshLeft" color="var(--color-danger)" />
    </div>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="发票号 / 结算单号" :prefix-icon="Search" clearable style="width: 220px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.status" placeholder="发票状态" clearable>
              <el-option v-for="(v, k) in statusMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.type" placeholder="发票类型" clearable>
              <el-option label="增值税专用发票" value="增值税专用发票" />
              <el-option label="增值税普通发票" value="增值税普通发票" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe>
          <el-table-column prop="id" label="发票ID" width="90" fixed />
          <el-table-column prop="invoiceNo" label="发票号码" width="180">
            <template #default="{ row }">{{ row.invoiceNo || '—' }}</template>
          </el-table-column>
          <el-table-column label="关联结算单" width="150">
            <template #default="{ row }">
              <span class="link" @click="goSettlement(row)">{{ find.settlement(row.settlementId)?.billNo }}</span>
            </template>
          </el-table-column>
          <el-table-column label="客户" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              {{ find.customer(find.settlement(row.settlementId)?.customerId)?.name }}
            </template>
          </el-table-column>
          <el-table-column prop="type" label="发票类型" width="140" />
          <el-table-column label="金额(元)" width="140" align="right">
            <template #default="{ row }">
              <span class="num amount">{{ formatNum(row.amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="issueDate" label="开票日期" width="110">
            <template #default="{ row }">{{ row.issueDate || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="130" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
              <el-tooltip v-if="row.stale && row.status === 'issued'" :content="'金额陈旧：' + (row.staleReason || '账单金额已变化')" placement="top">
                <el-tag size="small" type="danger" effect="dark" style="margin-left: 4px">金额陈旧</el-tag>
              </el-tooltip>
            </template>
          </el-table-column>
          <ActionColumn width="140" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 'pending' && can('invoice')"
                link type="primary" size="small"
                @click="issue(row)"
              >开具</el-button>
              <el-button
                v-if="row.status === 'issued' && can('invoice')"
                link type="danger" size="small"
                @click="redFlush(row)"
              >红冲</el-button>
              <el-button link type="info" size="small" @click="preview(row)">查看</el-button>
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

    <!-- 发票预览 -->
    <el-dialog v-model="previewVisible" title="发票预览" width="560px">
      <div v-if="current" class="invoice-preview">
        <div class="invoice-preview__head">
          <span>电子发票（{{ current.type.replace('增值税', '') }}）</span>
          <el-tag size="small" :type="statusMap[current.status].type" effect="light">
            {{ statusMap[current.status].label }}
          </el-tag>
        </div>
        <div class="invoice-preview__no">发票号码：{{ current.invoiceNo || '待开具' }}</div>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="购买方">{{ find.customer(find.settlement(current.settlementId)?.customerId)?.name }}</el-descriptions-item>
          <el-descriptions-item label="开票日期">{{ current.issueDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="关联结算单">{{ find.settlement(current.settlementId)?.billNo }}</el-descriptions-item>
          <el-descriptions-item label="价税合计">
            <span class="num amount">{{ formatMoney(current.amount) }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <el-alert
          v-if="current.stale && current.status === 'issued'"
          type="warning"
          :closable="false"
          show-icon
          style="margin-top: 12px"
          :title="`发票金额与当前账单金额不一致（${current.staleReason || '账单金额已变化'}），需红冲重开`"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'Invoice' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/data'
// 本视图交叉引用查找（原 @/data find 下沉，仅声明本视图用到的键）
const find = {
  customer: (id) => db.customers.find((c) => c.id === id),
  settlement: (id) => db.settlements.find((s) => s.id === id),
}
import { useCollection } from '@/composables/useCollection'
import { api } from '@/api'
import { usePerm } from '@/permission'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'

const { can } = usePerm()

const router = useRouter()

const statusMap = {
  issued: { label: '已开具', type: 'success' },
  pending: { label: '待开具', type: 'warning' },
  'red-flushed': { label: '已红冲', type: 'danger' }
}

const filter = reactive({ keyword: '', status: '', type: '' })
const page = ref(1)
const pageSize = ref(10)

/* ===== Phase 4 灰度：生产模式（薄客户端）——发票列表读后端 /api/coll/invoices ===== */
const listCol = useCollection('invoices', () => ({ key: 'invoices:list' }))
const rows = computed(() => listCol.data.value)

const filtered = computed(() =>
  rows.value.filter((i) => {
    if (filter.status && i.status !== filter.status) return false
    if (filter.type && i.type !== filter.type) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      const billNo = find.settlement(i.settlementId)?.billNo || ''
      if (!i.id.toLowerCase().includes(kw) && !(i.invoiceNo || '').toLowerCase().includes(kw) && !billNo.toLowerCase().includes(kw)) return false
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
  filter.type = ''
  page.value = 1
}

onMounted(() => { listCol.refresh() })
const onRefreshed = () => { listCol.refresh() }
window.addEventListener('blms:refreshed', onRefreshed)
onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))

/* ===== Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 列表重取 =====
 * 不再依赖本地乐观改态；后端为完整状态机（返回 invoiceNo 与 flow 同形）。 */
async function prodWrite(path, body) {
  const r = await api('POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return null
  }
  await listCol.refresh()
  return r.data
}

const issuedCount = computed(() => rows.value.filter((i) => i.status === 'issued').length)
const issuedAmount = computed(() => rows.value.filter((i) => i.status === 'issued').reduce((s, i) => s + i.amount, 0))
/** M5：金额陈旧发票数（已开具但账单额已变化，需红冲重开） */
const staleCount = computed(() => rows.value.filter((i) => i.status === 'issued' && i.stale).length)
const pendingCount = computed(() => rows.value.filter((i) => i.status === 'pending').length)
const redFlushedCount = computed(() => rows.value.filter((i) => i.status === 'red-flushed').length)

function goSettlement(row) {
  router.push(`/settlement/${row.settlementId}`)
}

async function issue(row) {
  const d = await prodWrite('/settlement/' + row.settlementId + '/issueInvoice')
  if (!d) return
  ElMessage.success(`发票已开具：${d.invoiceNo || ''}`)
}

function redFlush(row) {
  ElMessageBox.prompt('请输入红冲原因', `红冲发票 ${row.invoiceNo}`, {
    inputPattern: /.{2,}/,
    inputErrorMessage: '原因至少 2 个字符'
  }).then(async ({ value }) => {
    const d = await prodWrite('/settlement/invoice/' + row.id + '/redFlush', { reason: value })
    if (d) ElMessage.warning('发票已红冲')
  }).catch(() => {})
}

const previewVisible = ref(false)
const current = ref(null)
function preview(row) {
  current.value = row
  previewVisible.value = true
}

function exportCsv() {
  const headers = ['发票ID', '发票号码', '关联结算单', '客户', '类型', '金额(元)', '开票日期', '状态']
  const rows = filtered.value.map((i) => [
    i.id, i.invoiceNo || '', find.settlement(i.settlementId)?.billNo || '',
    find.customer(find.settlement(i.settlementId)?.customerId)?.name || '',
    i.type, i.amount, i.issueDate || '', statusMap[i.status].label
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `发票列表_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条发票`)
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
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

.invoice-preview__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--color-primary);
}

.invoice-preview__no {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 10px 0 14px;
}
</style>
