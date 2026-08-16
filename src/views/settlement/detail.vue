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
            <template v-if="paymentDays">· 账期 {{ paymentDays }} 天</template>
          </div>
        </div>
        <div class="settlement-detail__actions">
          <el-button
            v-if="settlement?.status === 'pending' && can('settlement')"
            type="warning" :icon="DocumentChecked" @click="startReconcile"
          >
            发起对账
          </el-button>
          <el-button
            v-if="settlement?.status === 'reconciling' && can('settlement')"
            type="success" :icon="CircleCheck" @click="settle"
          >
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
              <el-step
                title="结算收款"
                :description="settlement?.settleDate ? `结算日 ${settlement.settleDate} · 已付 ${formatNum(settlement.paidAmount)} / ${formatNum(settlement.totalAmount)}` : '—'"
              />
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
              v-if="settlement?.status === 'settled' && settlement?.invoiceStatus === 'not-issued' && can('invoice')"
              type="primary"
              size="small"
              style="margin-top: 12px"
              @click="issueInvoice"
            >开具发票</el-button>
          </div>
        </div>

        <!-- 收款记录 -->
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">收款记录</span>
            <el-button v-if="canRecordPayment && can('settlement')" type="primary" size="small" :icon="Money" @click="openPayDialog">
              登记收款
            </el-button>
          </div>
          <div class="panel__body">
            <el-table v-if="payments.length" :data="payments" stripe size="small">
              <el-table-column prop="payTime" label="收款时间" width="140" />
              <el-table-column label="金额(元)" width="110" align="right">
                <template #default="{ row }">
                  <span class="num">{{ formatMoney(row.amount) }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="method" label="方式" width="90" />
              <el-table-column prop="remark" label="备注" min-width="80" />
            </el-table>
            <el-empty v-else description="暂无收款记录，结算确认后可登记收款" :image-size="60" />
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 对账明细：调度量 vs 磅单净重 vs 结算量 -->
    <div class="panel" style="margin-top: 16px">
      <div class="panel__header">
        <span class="panel__title">对账明细</span>
        <span v-if="settlement?.reconciliation" class="recon-summary">
          对账时间 {{ settlement.reconciliation.date }} · 共 {{ settlement.reconciliation.items.length }} 车次
          · 损耗合计 {{ settlement.reconciliation.lossQty }} 吨（约 {{ formatMoney(settlement.reconciliation.lossAmount) }}，已扣减）
          <template v-if="settlement.reconciliation.diffCount">
            · <span class="text-warning">{{ settlement.reconciliation.diffCount }} 车次结算量与磅单不一致，需确认</span>
          </template>
          <template v-else>· <span class="text-success">结算量与磅单一致</span></template>
        </span>
      </div>
      <div class="panel__body">
        <el-table v-if="settlement?.reconciliation" :data="settlement.reconciliation.items" stripe size="small">
          <el-table-column prop="dispatchId" label="调度单号" width="110" />
          <el-table-column prop="plate" label="车牌" width="120" />
          <el-table-column label="调度量(吨)" width="110" align="right">
            <template #default="{ row }"><span class="num">{{ row.dispatchQty }}</span></template>
          </el-table-column>
          <el-table-column label="进磅净重(吨)" width="120" align="right">
            <template #default="{ row }"><span class="num">{{ row.inNet ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column label="出磅净重(吨)" width="120" align="right">
            <template #default="{ row }"><span class="num">{{ row.outNet ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column label="结算量(吨)" width="110" align="right">
            <template #default="{ row }"><span class="num">{{ row.settleQty }}</span></template>
          </el-table-column>
          <el-table-column label="损耗(吨)" width="100" align="right">
            <template #default="{ row }">
              <span class="num" :class="row.loss > 0.5 ? 'text-warning' : ''">{{ row.loss }}</span>
            </template>
          </el-table-column>
          <el-table-column label="差异(吨)" width="100" align="right">
            <template #default="{ row }">
              <span class="num" :class="row.status === 'diff' ? 'text-danger' : ''">{{ row.diff > 0 ? '+' : '' }}{{ row.diff }}</span>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="100" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'diff' ? 'warning' : 'success'" effect="plain">
                {{ row.status === 'diff' ? '需确认' : '一致' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-empty
          v-else
          description="尚未发起对账，发起后将展示调度量、磅单净重、结算量三方比对结果"
          :image-size="60"
        />
      </div>
    </div>

    <!-- 登记收款 -->
    <el-dialog v-model="payDialog" title="登记收款" width="440px">
      <el-form label-width="90px">
        <el-form-item label="未付余额">
          <span class="num amount">{{ formatMoney(unpaid) }}</span>
        </el-form-item>
        <el-form-item label="收款金额">
          <el-input-number v-model="payAmount" :min="1" :max="unpaid" :precision="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="收款方式">
          <el-select v-model="payMethod" style="width: 100%">
            <el-option v-for="m in payMethods" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="payDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmPay">确认收款</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'SettlementDetail' })
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, DocumentChecked, CircleCheck, Printer, Money } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { startReconcile as flowStartReconcile, confirmSettle, recordPayment, issueInvoice as flowIssueInvoice } from '@/mock/flow'
import { usePerm } from '@/permission'
import { formatMoney, formatNum } from '@/utils'

const route = useRoute()
const { can } = usePerm()
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
  const price = find.contract(s.contractId)?.unitPrice || '-'
  const rows = [
    { name: '运输费', rule: `结算量 ${formatNum(s.totalQuantity)} 吨 × 合同单价（${price} 元/吨，按出磅净重）`, amount: s.freight },
    { name: '装货费', rule: '结算量 × 8 元/吨', amount: s.loadingFee },
    { name: '卸货费', rule: '结算量 × 6 元/吨', amount: s.unloadingFee },
    { name: '过路过桥费', rule: '按实际发生', amount: s.tollFee },
    { name: '附加费', rule: '加急/夜间/特殊作业', amount: s.surcharge }
  ]
  if (s.lossDeduction > 0) {
    rows.push({ name: '损耗扣减', rule: `损耗 ${s.lossQty} 吨 × ${price} 元/吨（磅单结算）`, amount: -s.lossDeduction })
  }
  if (s.exceptionLoss > 0) {
    rows.push({ name: '异常损失', rule: '关联已关闭异常成本扣减', amount: -s.exceptionLoss })
  }
  return rows
})

const unpaid = computed(() => (settlement.value ? settlement.value.totalAmount - settlement.value.paidAmount : 0))
const paymentDays = computed(() => find.contract(settlement.value?.contractId)?.paymentDays)
const payments = computed(() => db.payments.filter((p) => p.settlementId === settlement.value?.id))
const canRecordPayment = computed(() => {
  const s = settlement.value
  return s && (s.status === 'settled' || s.status === 'overdue') && s.totalAmount - s.paidAmount > 0
})

/* ===== 登记收款 ===== */
const payDialog = ref(false)
const payAmount = ref(0)
const payMethod = ref('银行转账')
const payMethods = ['银行转账', '支票', '承兑汇票']

function openPayDialog() {
  payAmount.value = settlement.value.totalAmount - settlement.value.paidAmount
  payMethod.value = '银行转账'
  payDialog.value = true
}

function confirmPay() {
  const real = recordPayment(settlement.value, payAmount.value, payMethod.value)
  payDialog.value = false
  ElMessage.success(`已登记收款 ${formatMoney(real)}`)
}

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
  ElMessageBox.confirm('确认发起对账？将执行调度量 vs 磅单净重 vs 结算量三方比对。', '发起对账', { type: 'info' }).then(() => {
    const r = flowStartReconcile(settlement.value)
    ElMessage.success(r.diffCount ? `对账完成：${r.diffCount} 车次存在差异` : '对账完成：无差异')
  }).catch(() => {})
}

function settle() {
  const s = settlement.value
  const r = s.reconciliation
  const lossWarn =
    r && r.lossQty > 0
      ? `<br/><span style="color:var(--color-warning)">本期损耗合计 ${r.lossQty} 吨（约 ${formatMoney(r.lossAmount)}），按出磅净重结算，损耗已扣减。</span>`
      : ''
  const diffWarn =
    r && r.diffCount
      ? `<br/><span style="color:var(--color-danger)">${r.diffCount} 车次结算量与磅单不一致，请确认后再结算。</span>`
      : ''
  ElMessageBox.confirm(
    `确认结算 ${s.billNo}？结算金额 ${formatMoney(s.totalAmount)}，账期 ${paymentDays.value || 30} 天，到期未付清将标记逾期。${lossWarn}${diffWarn}`,
    '确认结算',
    { dangerouslyUseHTMLString: true, type: 'success', confirmButtonText: '确认结算' }
  ).then(() => {
    const r = confirmSettle(s)
    if (r && r.error) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success('结算完成，进入收款')
  }).catch(() => {})
}

function issueInvoice() {
  const no = flowIssueInvoice(settlement.value)
  ElMessage.success(`发票已开具：${no}`)
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

.text-warning {
  color: var(--color-warning) !important;
}

.text-danger {
  color: var(--color-danger) !important;
}

.recon-summary {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
