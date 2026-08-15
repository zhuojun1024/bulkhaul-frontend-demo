<template>
  <div class="page" v-loading="loading">
    <div class="panel settlement-detail__header">
      <div class="settlement-detail__head">
        <el-button :icon="ArrowLeft" circle @click="$router.back()" />
        <div>
          <div class="settlement-detail__name">
            结算单 {{ settlement?.billNo }}
            <StatusTag v-if="settlement" :status="settlement.status" :map="statusMap" />
          </div>
          <div class="settlement-detail__meta">
            合同
            <span class="link" @click="$router.push(`/contract/${settlement?.contractId}`)">{{ settlement?.contractId }}</span>
            · 结算周期 {{ settlement?.period }} · 客户 {{ customer?.name }}
          </div>
        </div>
        <div class="settlement-detail__actions">
          <el-button v-if="settlement?.status === 'pending'" type="warning" :icon="DocumentChecked" @click="startReconcile">
            发起对账
          </el-button>
          <el-button v-if="settlement?.status === 'reconciling'" type="success" :icon="CircleCheck" @click="settle">
            确认结算
          </el-button>
          <el-button :icon="Printer" @click="printBill">打印对账单</el-button>
        </div>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="14">
        <!-- 费用明细 -->
        <div class="panel">
          <div class="panel__header"><span class="panel__title">费用明细</span></div>
          <div class="panel__body">
            <el-table :data="feeRows" stripe size="small">
              <el-table-column prop="name" label="费用项" width="140" />
              <el-table-column prop="rule" label="计费规则" min-width="200" />
              <el-table-column label="金额(元)" width="150" align="right">
                <template #default="{ row }">
                  <span class="num">{{ formatNum(row.amount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="占比" width="100" align="right">
                <template #default="{ row }">
                  {{ settlement ? Math.round((row.amount / settlement.totalAmount) * 1000) / 10 : 0 }}%
                </template>
              </el-table-column>
            </el-table>
            <div class="fee-total">
              <span>结算总额</span>
              <b class="num fee-total__value">{{ formatMoney(settlement?.totalAmount) }}</b>
            </div>
            <div class="fee-total">
              <span>已付金额</span>
              <b class="num fee-total__value text-success">{{ formatMoney(settlement?.paidAmount) }}</b>
            </div>
            <div class="fee-total">
              <span>未付余额</span>
              <b class="num fee-total__value text-danger">{{ formatMoney(unpaid) }}</b>
            </div>
          </div>
        </div>
      </el-col>

      <el-col :span="10">
        <!-- 对账流程 -->
        <div class="panel">
          <div class="panel__header"><span class="panel__title">对账结算流程</span></div>
          <div class="panel__body">
            <el-steps direction="vertical" :active="stepActive">
              <el-step title="数据归集" :description="`${settlement?.dispatchCount} 车次 / ${formatNum(settlement?.totalQuantity)} 吨`" />
              <el-step title="发起对账" :description="settlement?.status === 'pending' ? '待发起' : '已完成'" />
              <el-step title="客户确认" :description="settlement?.status === 'settled' ? '已确认' : '待客户确认'" />
              <el-step title="结算收款" :description="settlement?.settleDate ? `结算日 ${settlement.settleDate}` : '—'" />
            </el-steps>
          </div>
        </div>

        <!-- 发票 -->
        <div class="panel">
          <div class="panel__header"><span class="panel__title">发票信息</span></div>
          <div class="panel__body">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="开票状态">
                <el-tag size="small" :type="invoiceType(settlement?.invoiceStatus)" effect="light">
                  {{ invoiceMap[settlement?.invoiceStatus] }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="发票号码">
                {{ invoice?.invoiceNo || '—' }}
              </el-descriptions-item>
              <el-descriptions-item label="发票类型">{{ invoice?.type || '—' }}</el-descriptions-item>
              <el-descriptions-item label="开票日期">{{ invoice?.issueDate || '—' }}</el-descriptions-item>
            </el-descriptions>
            <el-button
              v-if="settlement?.status === 'settled' && settlement?.invoiceStatus === 'not-issued'"
              type="primary"
              size="small"
              style="margin-top: 12px"
              @click="issueInvoice"
            >开具发票</el-button>
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
defineOptions({ name: 'SettlementDetail' })
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, DocumentChecked, CircleCheck, Printer } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'

const route = useRoute()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 200))

const settlement = computed(() => find.settlement(route.params.id))
const customer = computed(() => find.customer(settlement.value?.customerId))
const invoice = computed(() => db.invoices.find((i) => i.settlementId === settlement.value?.id))

const statusMap = {
  pending: { label: '待对账', type: 'info' },
  reconciling: { label: '对账中', type: 'warning' },
  settled: { label: '已结算', type: 'success' },
  overdue: { label: '已逾期', type: 'danger' }
}
const invoiceMap = { 'not-issued': '未开票', issued: '已开票', pending: '开票中' }

const feeRows = computed(() => {
  const s = settlement.value
  if (!s) return []
  return [
    { name: '运输费', rule: `运量 × 合同单价（${find.contract(s.contractId)?.unitPrice || '-'} 元/吨）`, amount: s.freight },
    { name: '装货费', rule: '运量 × 8 元/吨', amount: s.loadingFee },
    { name: '卸货费', rule: '运量 × 6 元/吨', amount: s.unloadingFee },
    { name: '过路过桥费', rule: '按实际发生', amount: s.tollFee },
    { name: '附加费', rule: '加急/夜间/特殊作业', amount: s.surcharge }
  ]
})

const unpaid = computed(() => (settlement.value ? settlement.value.totalAmount - settlement.value.paidAmount : 0))

const stepActive = computed(() => {
  const s = settlement.value
  if (!s) return 0
  if (s.status === 'pending') return 1
  if (s.status === 'reconciling') return 2
  return 4
})

function invoiceType(status) {
  return { issued: 'success', pending: 'warning', 'not-issued': 'info' }[status] || 'info'
}

function startReconcile() {
  ElMessageBox.confirm('确认发起对账？', '发起对账', { type: 'info' }).then(() => {
    settlement.value.status = 'reconciling'
    ElMessage.success('对账已发起')
  }).catch(() => {})
}

function settle() {
  ElMessageBox.confirm('确认结算并发起收款？', '确认结算', { type: 'success' }).then(() => {
    settlement.value.status = 'settled'
    settlement.value.paidAmount = settlement.value.totalAmount
    settlement.value.settleDate = dayjs().format('YYYY-MM-DD')
    ElMessage.success('结算完成')
  }).catch(() => {})
}

function issueInvoice() {
  const s = settlement.value
  db.invoices.push({
    id: `FP-${String(db.invoices.length + 1).padStart(4, '0')}`,
    settlementId: s.id,
    invoiceNo: '2410' + String(Math.floor(Math.random() * 900000000000) + 100000000000),
    type: '增值税专用发票',
    amount: s.totalAmount,
    issueDate: dayjs().format('YYYY-MM-DD'),
    status: 'issued',
    remark: ''
  })
  s.invoiceStatus = 'issued'
  ElMessage.success('发票已开具')
}

function printBill() {
  const s = settlement.value
  const rows = feeRows.value
    .map((f) => `<tr><td>${f.name}</td><td>${f.rule}</td><td style="text-align:right">${formatNum(f.amount)}</td></tr>`)
    .join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>对账单 ${s.billNo}</title>
  <style>
    body{font-family:'Microsoft YaHei',sans-serif;padding:40px;color:#1d2129}
    h1{text-align:center;font-size:22px}
    .meta{text-align:center;color:#86909c;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    td,th{border:1px solid #e5e6eb;padding:10px;font-size:14px}
    th{background:#f7f8fa;text-align:left}
    .total{margin-top:16px;font-size:16px;display:flex;justify-content:space-between}
    .sign{display:flex;justify-content:space-between;margin-top:60px}
  </style></head><body>
  <h1>运费结算对账单</h1>
  <div class="meta">账单编号：${s.billNo} &nbsp; 结算周期：${s.period} &nbsp; 客户：${customer.value?.name}</div>
  <table>
    <tr><th>费用项</th><th>计费规则</th><th style="text-align:right">金额(元)</th></tr>
    ${rows}
  </table>
  <div class="total"><span>结算总额</span><b>${formatMoney(s.totalAmount)}</b></div>
  <div class="sign">
    <div>供方（盖章）：__________________</div>
    <div>需方（盖章）：__________________</div>
  </div>
  </body></html>`
  const win = window.open('', '_blank')
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}
</script>

<style scoped>
.settlement-detail__header {
  padding: 16px 20px;
}

.settlement-detail__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.settlement-detail__name {
  font-size: 17px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}

.settlement-detail__meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.settlement-detail__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.link {
  color: var(--color-primary);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}

.fee-total {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-top: 1px dashed var(--border-color);
  margin-top: 8px;
  font-size: 14px;
  color: var(--text-secondary);
}

.fee-total__value {
  font-size: 16px;
  color: var(--text-primary);
}

.text-success {
  color: var(--color-success) !important;
}

.text-danger {
  color: var(--color-danger) !important;
}
</style>
