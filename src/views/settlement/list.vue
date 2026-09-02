<template>
  <div class="page">
    <PageHeader title="结算管理" desc="按合同月度汇总运费，对账、结算与逾期跟踪">
      <el-button v-if="can('settlement')" type="primary" :icon="DocumentAdd" @click="openGenerate">生成结算单</el-button>
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
      <el-button v-if="can('invoice')" :icon="Postcard" @click="$router.push('/settlement/invoice')">发票管理</el-button>
    </PageHeader>

    <el-tabs v-model="activeTab" class="settlement-tabs">
      <el-tab-pane label="结算账单" name="settlement">
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
          <ActionColumn width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <el-button
                v-if="row.status === 'pending' && can('settlement')"
                link type="warning" size="small"
                @click.stop="startReconcile(row)"
              >对账</el-button>
              <el-button
                v-if="row.status === 'pending' && can('settlement')"
                link type="primary" size="small"
                @click.stop="recalc(row)"
              >重算</el-button>
              <el-button
                v-if="row.status === 'reconciling' && can('settlement')"
                link type="success" size="small"
                @click.stop="settle(row)"
              >结算</el-button>
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
      </el-tab-pane>

      <el-tab-pane :label="'银行对账（待核销 ' + unmatchedCount + '）'" name="bank">
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">待核销银行流水</span>
            <span>
              <el-button
                v-if="can('settlement')"
                type="primary"
                size="small"
                :icon="Plus"
                @click="openBankEntry"
              >
                流水录入
              </el-button>
              <el-button
                v-if="can('settlement')"
                type="primary"
                size="small"
                :icon="MagicStick"
                :disabled="!unmatched.length"
                @click="autoMatch"
              >
                自动核销
              </el-button>
            </span>
          </div>
          <div class="panel__body">
            <el-alert type="info" :closable="false" style="margin-bottom: 12px">
              自动核销规则：流水对手方与金额同账单（已结算/逾期）未付余额精确一致时自动核销并登记收款；其余流水需手动核销或线下核实后登记。
            </el-alert>
            <el-table :data="unmatched" stripe size="small">
              <el-table-column prop="id" label="流水号" width="100" />
              <el-table-column prop="time" label="到账时间" width="150" />
              <el-table-column prop="counterparty" label="对手方" min-width="180" show-overflow-tooltip />
              <el-table-column label="金额(元)" width="140" align="right">
                <template #default="{ row }">
                  <span class="num amount">{{ formatMoney(row.amount) }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="summary" label="摘要" min-width="160" show-overflow-tooltip />
              <ActionColumn width="90" fixed="right">
                <template #default="{ row }">
                  <el-button v-if="can('settlement')" link type="primary" size="small" @click="openMatch(row)">核销</el-button>
                </template>
              </ActionColumn>
            </el-table>
            <el-empty v-if="!unmatched.length" description="暂无待核销银行流水" :image-size="60" />
          </div>
        </div>

        <div class="panel" style="margin-top: 16px">
          <div class="panel__header"><span class="panel__title">核销历史</span></div>
          <div class="panel__body">
            <el-table :data="matchedRecords" stripe size="small">
              <el-table-column prop="id" label="流水号" width="100" />
              <el-table-column prop="counterparty" label="对手方" min-width="180" show-overflow-tooltip />
              <el-table-column label="金额(元)" width="140" align="right">
                <template #default="{ row }">
                  <span class="num">{{ formatMoney(row.amount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="核销账单" width="140">
                <template #default="{ row }">{{ find.settlement(row.settlementId)?.billNo || '—' }}</template>
              </el-table-column>
              <el-table-column prop="matchTime" label="核销时间" width="150" />
              <el-table-column prop="matchBy" label="核销人" width="110" />
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="'趟次应付（待付 ' + payableStats.pendingCount + '）'" name="payable">
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">趟次应付台账（司机趟次费 + 外协车运费）</span>
            <el-button v-if="can('settlement')" type="primary" size="small" :icon="Plus" @click="genPayables">生成应付</el-button>
          </div>
          <div class="panel__body">
            <el-alert type="info" :closable="false" style="margin-bottom: 12px">
              公路车次完成即自动生成趟次应付（司机趟次费 + 外协车运费），结算侧付款后核销，闭合成本侧。当前待付 {{ payableStats.pendingCount }} 笔 / 已付 {{ payableStats.paidCount }} 笔。
            </el-alert>
            <el-table :data="payables" stripe size="small">
              <el-table-column prop="id" label="应付单号" width="100" />
              <el-table-column prop="dispatchId" label="调度单号" width="110" />
              <el-table-column prop="plate" label="车牌" width="120" />
              <el-table-column label="司机" width="100">
                <template #default="{ row }">{{ find.driver(row.driverId)?.name || '—' }}</template>
              </el-table-column>
              <el-table-column label="车辆归属" width="90" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.owner === '外协' ? 'warning' : 'info'" effect="light">{{ row.owner }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="司机趟次费" width="110" align="right">
                <template #default="{ row }"><span class="num">{{ formatMoney(row.driverFee) }}</span></template>
              </el-table-column>
              <el-table-column label="外协运费" width="110" align="right">
                <template #default="{ row }"><span class="num">{{ formatMoney(row.outsourceFee) }}</span></template>
              </el-table-column>
              <el-table-column label="应付金额" width="120" align="right">
                <template #default="{ row }"><span class="num amount">{{ formatMoney(row.amount) }}</span></template>
              </el-table-column>
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.status === 'paid' ? 'success' : 'warning'" effect="light">{{ row.status === 'paid' ? '已付' : '待付' }}</el-tag>
                </template>
              </el-table-column>
              <ActionColumn width="100" fixed="right">
                <template #default="{ row }">
                  <el-button v-if="row.status === 'pending' && can('settlement')" link type="primary" size="small" @click="openPay(row)">付款</el-button>
                  <span v-else-if="row.status === 'paid'" class="text-muted">{{ row.payMethod }}</span>
                </template>
              </ActionColumn>
            </el-table>
            <el-empty v-if="!payables.length" description="暂无趟次应付（公路车次完成或点击“生成应付”后生成）" :image-size="60" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

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

    <!-- 银行核销（手动：待核销流水 → 指定账单） -->
    <el-dialog v-model="matchDialog" title="银行核销" width="480px">
      <div v-if="matchTarget">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="流水号">{{ matchTarget.id }}</el-descriptions-item>
          <el-descriptions-item label="对手方">{{ matchTarget.counterparty }}</el-descriptions-item>
          <el-descriptions-item label="金额">
            <span class="num amount">{{ formatMoney(matchTarget.amount) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="摘要">{{ matchTarget.summary }}</el-descriptions-item>
        </el-descriptions>
        <el-form label-width="100px" style="margin-top: 16px">
          <el-form-item label="核销账单">
            <el-select v-model="matchSettlementId" placeholder="选择账单（该客户已结算/逾期且有未付余额）" style="width: 100%">
              <el-option
                v-for="s in matchCandidates"
                :key="s.id"
                :label="s.billNo + ' · 未付 ' + formatMoney(s.totalAmount - s.paidAmount)"
                :value="s.id"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <div class="convert-tip">核销后将按流水金额登记收款（银行转账），流水金额超过账单未付余额将被拦截。</div>
      </div>
      <template #footer>
        <el-button @click="matchDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!matchSettlementId" @click="doMatch">确认核销</el-button>
      </template>
    </el-dialog>

    <!-- F7：银行流水录入（登记客户已转账但平台未登记的到账，闭合核销链路） -->
    <el-dialog v-model="bankEntryDialog" title="银行流水录入" width="480px">
      <el-alert type="info" :closable="false" style="margin-bottom: 12px">
        登记银行侧到账流水（客户已转账、平台未登记）。录入后进入"待核销"，金额与某账单未付余额一致时可自动核销，否则手动核销。
      </el-alert>
      <el-form :model="bankEntryForm" label-width="100px">
        <el-form-item label="对手方" required>
          <el-select v-model="bankEntryForm.counterparty" filterable allow-create default-first-option placeholder="选择或输入付款单位" style="width: 100%">
            <el-option v-for="c in db.customers" :key="c.id" :label="c.name" :value="c.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="到账金额" required>
          <el-input-number v-model="bankEntryForm.amount" :min="1" :step="10000" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="到账时间" required>
          <el-date-picker
            v-model="bankEntryForm.time"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm"
            placeholder="选择到账时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="摘要">
          <el-input v-model="bankEntryForm.summary" placeholder="如：运费付款 / 质量保证金" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bankEntryDialog = false">取消</el-button>
        <el-button type="primary" @click="doBankEntry">录入</el-button>
      </template>
    </el-dialog>

    <!-- 趟次应付付款 -->
    <el-dialog v-model="payDialog" title="趟次应付付款" width="460px">
      <div v-if="payTarget">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="应付单号">{{ payTarget.id }}</el-descriptions-item>
          <el-descriptions-item label="调度单号">{{ payTarget.dispatchId }}</el-descriptions-item>
          <el-descriptions-item label="司机">{{ find.driver(payTarget.driverId)?.name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="司机趟次费"><span class="num">{{ formatMoney(payTarget.driverFee) }}</span></el-descriptions-item>
          <el-descriptions-item label="外协运费"><span class="num">{{ formatMoney(payTarget.outsourceFee) }}</span></el-descriptions-item>
          <el-descriptions-item label="应付金额"><span class="num amount">{{ formatMoney(payTarget.amount) }}</span></el-descriptions-item>
        </el-descriptions>
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="付款方式">
            <el-select v-model="payMethod" style="width: 100%">
              <el-option label="银行转账" value="银行转账" />
              <el-option label="现金" value="现金" />
              <el-option label="微信/支付宝" value="微信/支付宝" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="payDialog = false">取消</el-button>
        <el-button type="primary" @click="doPay">确认付款</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'Settlement' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Download, Refresh, Postcard, DocumentAdd, MagicStick, Plus } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/data'
// 本视图交叉引用查找（原 @/data find 下沉，仅声明本视图用到的键）
const find = {
  customer: (id) => db.customers.find((c) => c.id === id),
  driver: (id) => db.drivers.find((d) => d.id === id),
  settlement: (id) => db.settlements.find((s) => s.id === id),
}
import { settlementCandidates, payableStats as flowPayableStats } from '@/data/derived'
import { useCollection } from '@/composables/useCollection'
import { api } from '@/api'
import { usePerm } from '@/permission'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()

const { can } = usePerm()

const router = useRouter()

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

/* ===== 页签：结算账单 / 银行对账（G8 收款核销） ===== */
const activeTab = ref('settlement')
const unmatched = computed(() => bankRecords.value.filter((b) => b.status === 'unmatched'))
const unmatchedCount = computed(() => unmatched.value.length)
const matchedRecords = computed(() => bankRecords.value.filter((b) => b.status === 'matched'))

const matchDialog = ref(false)
const matchTarget = ref(null)
const matchSettlementId = ref('')
/** 核销候选：该流水对手方名下、已结算/逾期且有未付余额的账单 */
const matchCandidates = computed(() => {
  if (!matchTarget.value) return []
  const c = db.customers.find((x) => x.name === matchTarget.value.counterparty)
  return settlements.value.filter(
    (s) => (s.status === 'settled' || s.status === 'overdue') && s.customerId === c?.id && s.totalAmount - s.paidAmount > 0
  )
})

function openMatch(row) {
  matchTarget.value = row
  matchSettlementId.value = ''
  matchDialog.value = true
}

async function doMatch() {
  const s = find.settlement(matchSettlementId.value)
  const d = await prodWrite('/finance/bank/' + matchTarget.value.id + '/match', { settlementId: matchSettlementId.value })
  if (!d) return
  matchDialog.value = false
  ElMessage.success(`核销完成：${formatMoney(d.real)} 已核销至账单 ${s?.billNo || ''}`)
}

function autoMatch() {
  ElMessageBox.confirm(
    '自动核销将匹配「对手方 + 金额与账单未付余额精确一致」的流水并登记收款，其余流水保留待人工处理。确定执行？',
    '自动核销',
    { type: 'info', confirmButtonText: '确认核销' }
  ).then(async () => {
    const d = await prodWrite('/finance/bank/autoMatch')
    if (!d) return
    const n = Array.isArray(d) ? d.length : (d.matched || 0)
    ElMessage.success(n ? `自动核销完成：${n} 笔银行流水已核销` : '暂无满足自动核销条件的流水')
  }).catch(() => {})
}

/* ===== F7：银行流水录入（RBAC settlement，服务层守卫 + 审计 + 通知） ===== */
const bankEntryDialog = ref(false)
const bankEntryForm = reactive({ counterparty: '', amount: 10000, time: '', summary: '' })

function openBankEntry() {
  Object.assign(bankEntryForm, { counterparty: '', amount: 10000, time: dayjs().format('YYYY-MM-DD HH:mm'), summary: '' })
  bankEntryDialog.value = true
}

async function doBankEntry() {
  if (!bankEntryForm.counterparty) {
    ElMessage.warning('请选择或输入对手方')
    return
  }
  const d = await prodWrite('/finance/bank/statement', { ...bankEntryForm })
  if (!d) return
  bankEntryDialog.value = false
  ElMessage.success(`银行流水 ${d.id} 已录入，进入待核销`)
}

/* ===== 趟次应付（P1 成本侧闭环） ===== */
/* payables 数据源见上方 settlements/bankRecords/payables 三集合（Phase 4 灰度） */
const payableStats = computed(() => flowPayableStats())

const payDialog = ref(false)
const payTarget = ref(null)
const payMethod = ref('银行转账')

function openPay(row) {
  payTarget.value = row
  payMethod.value = '银行转账'
  payDialog.value = true
}

async function doPay() {
  const d = await prodWrite('/finance/payables/' + payTarget.value.id + '/pay', { method: payMethod.value })
  if (!d) return
  payDialog.value = false
  ElMessage.success(`付款完成：${formatMoney(d.amount)} 已核销`)
}

function genPayables() {
  ElMessageBox.confirm('为所有已完成且尚无应付的公路车次批量生成趟次应付？', '生成趟次应付', { type: 'info', confirmButtonText: '生成' }).then(async () => {
    const d = await prodWrite('/finance/payables/generate')
    if (!d) return
    ElMessage.success(d.created ? `已生成 ${d.created} 笔趟次应付` : '暂无需生成的趟次应付')
  }).catch(() => {})
}

/* ===== Phase 4 灰度：生产模式（薄客户端）——结算账单/银行流水/应付读后端 /api/coll ===== */
const settleCol = useCollection('settlements', () => ({ key: 'settlements:list' }))
const bankCol = useCollection('bankRecords', () => ({ key: 'bankRecords:list' }))
const payableCol = useCollection('payables', () => ({ key: 'payables:list' }))
const settlements = computed(() => settleCol.data.value)
const bankRecords = computed(() => bankCol.data.value)
const payables = computed(() => payableCol.data.value)

const periods = computed(() => [...new Set(settlements.value.map((s) => s.period))].sort().reverse())

const statItems = computed(() => {
  const count = (s) => settlements.value.filter((x) => x.status === s).length
  return [
    { key: '', label: '全部账单', count: settlements.value.length, color: tokens.primary },
    { key: 'pending', label: '待对账', count: count('pending'), color: tokens.info },
    { key: 'reconciling', label: '对账中', count: count('reconciling'), color: tokens.warning },
    { key: 'settled', label: '已结算', count: count('settled'), color: tokens.success },
    { key: 'overdue', label: '已逾期', count: count('overdue'), color: tokens.danger }
  ]
})

const filtered = computed(() =>
  settlements.value.filter((s) => {
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

onMounted(() => { settleCol.refresh(); bankCol.refresh(); payableCol.refresh() })
const onRefreshed = () => { settleCol.refresh(); bankCol.refresh(); payableCol.refresh() }
window.addEventListener('blms:refreshed', onRefreshed)
onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))

/* ===== Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 三集合重取 =====
 * 不再依赖本地乐观改态；后端为完整状态机（返回 diffCount/delta/created/real/amount/id 与 flow 同形）。
 * 成功返回 r.data，失败 ElMessage.error 返回 null。结算/银行流水/应付三联动集合全部重取。 */
async function prodWrite(path, body) {
  const r = await api('POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return null
  }
  await Promise.all([settleCol.refresh(), bankCol.refresh(), payableCol.refresh()])
  return r.data
}

function goDetail(row) {
  router.push(`/settlement/${row.id}`)
}

function invoiceType(status) {
  return { issued: 'success', pending: 'warning', 'not-issued': 'info' }[status] || 'info'
}

function startReconcile(row) {
  ElMessageBox.confirm(`开始对账 ${row.billNo}？将执行调度量 vs 磅单净重 vs 结算量三方比对。`, '发起对账', { type: 'info' }).then(async () => {
    const d = await prodWrite('/settlement/' + row.id + '/startReconcile')
    if (!d) return
    const dc = (d.reconciliation && d.reconciliation.diffCount) || d.diffCount || 0
    ElMessage.success(dc ? `对账完成：${dc} 车次存在差异` : '对账完成：无差异')
  }).catch(() => {})
}

/** 重算（仅待对账）：按当前磅单与已关闭异常刷新结算金额，差异记入调整记录 */
function recalc(row) {
  ElMessageBox.confirm(
    `重算 ${row.billNo}？将按当前磅单净重与已关闭异常损失刷新结算金额（适用于生成账单后磅单补录、异常损失变化）。`,
    '重算结算',
    { type: 'info', confirmButtonText: '确认重算' }
  ).then(async () => {
    const d = await prodWrite('/settlement/' + row.id + '/recalc')
    if (!d) return
    ElMessage.success(d.delta ? `重算完成：结算金额调整 ${d.delta > 0 ? '+' : ''}${formatMoney(d.delta)}` : '重算完成：金额无变化')
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
      ? `<br/><span style="color:var(--color-danger)">${r.diffCount} 车次进磅与调度量存在差异，请确认后再结算。</span>`
      : ''
  const receiptWarn =
    r && r.missingReceiptCount
      ? `<br/><span style="color:var(--color-danger)">${r.missingReceiptCount} 车次公路车次尚无电子签收单（收货凭证），签收是结算依据，未补齐前无法确认结算（结算详情对账明细可"补签"）。</span>`
      : ''
  const confirmWarn = row.customerConfirmed
    ? ''
    : `<br/><span style="color:var(--color-danger)">客户尚未确认对账结果，需客户在客户门户确认后方可结算。</span>`
  ElMessageBox.confirm(
    `确认结算 ${row.billNo}？<br/>结算金额 ${formatMoney(row.totalAmount)}，结算后进入收款。${lossWarn}${diffWarn}${receiptWarn}${confirmWarn}`,
    '确认结算',
    { dangerouslyUseHTMLString: true, type: 'success', confirmButtonText: '确认结算' }
  ).then(async () => {
    const d = await prodWrite('/settlement/' + row.id + '/confirmSettle')
    if (d) ElMessage.success('结算完成，进入收款')
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

async function confirmGenerate() {
  const d = await prodWrite('/settlement/generate', { keys: selectedGroups.value.map((g) => g.key) })
  if (!d) return
  const n = Array.isArray(d.created) ? d.created.length : (d.created || 0)
  genDialog.value = false
  ElMessage.success(`已生成 ${n} 张结算单，可发起对账`)
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

.text-muted {
  color: var(--text-secondary);
}

.settlement-tabs :deep(.el-tab-pane) {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* EP 的 .el-tabs__content 带 overflow:hidden，统计卡 hover 上移 2px 会被裁掉上边框，留 4px 顶部空间 */
  padding-top: 4px;
}

.convert-tip {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
