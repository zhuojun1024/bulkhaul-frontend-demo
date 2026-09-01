<template>
  <div class="page">
    <PageHeader title="客户门户" desc="查看本方合同执行、账单对账与回款进度，确认对账结果，或发起运输需求">
      <el-tag v-if="customer" effect="light" round>{{ customer.name }}</el-tag>
      <el-button v-if="customer && can('customer-request')" type="primary" :icon="Plus" @click="openRequest">
        发起运输需求
      </el-button>
    </PageHeader>

    <el-empty v-if="!customer" description="当前账号未绑定客户，无法访问门户" :image-size="80" />

    <template v-else>
      <!-- 客户概览 -->
      <div class="stat-row">
        <StatCard title="合同总数" :value="contracts.length" unit="份" icon="Document" color="var(--color-primary)" :sub="'执行中 ' + executingCount + ' 份'" />
        <StatCard title="累计运量" :value="formatNum(totalVolume)" unit="吨" icon="Van" color="var(--color-success)" sub="按实际完成车次" />
        <StatCard title="未付余额" :value="formatMoney(outstanding)" icon="Wallet" color="var(--color-warning)" sub="全部账单未付部分" />
        <StatCard title="可用预付款" :value="formatMoney(prepayAvailable)" icon="CreditCard" color="var(--color-success)" sub="预付货款，可抵扣账单" />
        <StatCard
          title="授信占用"
          :value="creditPct"
          unit="%"
          icon="CreditCard"
          :color="creditPct >= 100 ? 'var(--color-danger)' : 'var(--color-info)'"
          :sub="'额度 ' + formatMoney(customer.creditLimit) + '（已扣预付）'"
        />
      </div>

      <!-- 合同记录 -->
      <div class="panel">
        <div class="panel__header">
          <span class="panel__title">合同记录</span>
          <el-tag size="small" type="info" effect="plain">共 {{ contracts.length }} 份</el-tag>
        </div>
        <div class="panel__body">
          <el-table :data="contracts" size="small" stripe>
            <el-table-column prop="id" label="合同编号" width="100" />
            <el-table-column prop="name" label="合同名称" min-width="240" show-overflow-tooltip />
            <el-table-column label="数量(吨)" width="100" align="right">
              <template #default="{ row }">{{ formatNum(row.quantity) }}</template>
            </el-table-column>
            <el-table-column label="金额" width="130" align="right">
              <template #default="{ row }">{{ formatMoney(row.amount) }}</template>
            </el-table-column>
            <el-table-column label="执行进度" width="140" align="center">
              <template #default="{ row }">
                <el-progress :percentage="row.progress" :stroke-width="6" :show-text="false" />
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <StatusTag :status="row.status" :map="contractStatusMap" />
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!contracts.length" description="暂无合同" :image-size="60" />
        </div>
      </div>

      <!-- 我的运输需求 -->
      <div class="panel">
        <div class="panel__header">
          <span class="panel__title">我的运输需求</span>
          <el-tag size="small" type="info" effect="plain">共 {{ myRequests.length }} 条</el-tag>
        </div>
        <div class="panel__body">
          <el-table :data="myRequests" size="small" stripe>
            <el-table-column prop="id" label="需求编号" width="100" />
            <el-table-column label="商品" width="100" align="center">
              <template #default="{ row }">{{ find.commodity(row.commodityId)?.name }}</template>
            </el-table-column>
            <el-table-column label="数量(吨)" width="100" align="right">
              <template #default="{ row }">{{ formatNum(row.quantity) }}</template>
            </el-table-column>
            <el-table-column label="线路" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                {{ find.terminal(row.loadTerminalId)?.name }} → {{ find.terminal(row.unloadTerminalId)?.name }}
              </template>
            </el-table-column>
            <el-table-column prop="mode" label="方式" width="90" align="center" />
            <el-table-column label="期望单价" width="100" align="right">
              <template #default="{ row }">{{ row.unitPrice ? row.unitPrice + ' 元/吨' : '—' }}</template>
            </el-table-column>
            <el-table-column prop="expectDate" label="期望开始" width="110" />
            <el-table-column prop="createTime" label="提交时间" width="140" />
            <el-table-column label="状态" width="100" align="center">
              <template #default="{ row }">
                <StatusTag :status="row.status" :map="requestStatusMap" />
              </template>
            </el-table-column>
            <el-table-column label="处理结果" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.status === 'converted'" class="text-success">已转合同 {{ row.contractId }}</span>
                <span v-else-if="row.status === 'rejected'" class="text-danger">{{ row.rejectReason }}</span>
                <span v-else class="text-muted">待平台处理</span>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!myRequests.length" description="暂无运输需求，点击右上角「发起运输需求」" :image-size="60" />
        </div>
      </div>

      <el-row :gutter="16">
        <!-- 账单与对账确认 -->
        <el-col :span="14">
          <div class="panel">
            <div class="panel__header">
              <span class="panel__title">账单与对账</span>
              <el-tag size="small" type="info" effect="plain">共 {{ settlements.length }} 笔</el-tag>
            </div>
            <div class="panel__body">
              <el-table :data="settlements" size="small" stripe row-key="id">
                <!-- F3：对账明细展开行——逐车次展示 调度量/进磅/出磅/结算量/损耗/质量扣重/差异，确认与异议有据可依 -->
                <el-table-column type="expand">
                  <template #default="{ row }">
                    <div v-if="row.reconciliation" class="recon-detail">
                      <div class="recon-detail__summary">
                        对账时间：{{ row.reconciliation.date }} · 差异车次 {{ row.reconciliation.diffCount }} · 
                        损耗 {{ row.reconciliation.lossQty }} 吨（{{ formatMoney(row.reconciliation.lossAmount) }}） · 
                        质量扣重 {{ row.reconciliation.qualityQty }} 吨（{{ formatMoney(row.reconciliation.qualityAmount) }}）
                      </div>
                      <el-table :data="row.reconciliation.items" size="small" stripe>
                        <el-table-column prop="dispatchId" label="调度单号" width="110" />
                        <el-table-column prop="plate" label="车牌/单元" width="110" />
                        <el-table-column label="调度量(吨)" width="100" align="right">
                          <template #default="{ row: i }"><span class="num">{{ i.dispatchQty }}</span></template>
                        </el-table-column>
                        <el-table-column label="进磅(吨)" width="90" align="right">
                          <template #default="{ row: i }"><span class="num">{{ i.inNet != null ? i.inNet : '—' }}</span></template>
                        </el-table-column>
                        <el-table-column label="出磅(吨)" width="90" align="right">
                          <template #default="{ row: i }"><span class="num">{{ i.outNet != null ? i.outNet : '—' }}</span></template>
                        </el-table-column>
                        <el-table-column label="结算量(吨)" width="100" align="right">
                          <template #default="{ row: i }"><span class="num">{{ i.settleQty }}</span></template>
                        </el-table-column>
                        <el-table-column label="损耗(吨)" width="90" align="right">
                          <template #default="{ row: i }"><span class="num">{{ i.loss }}</span></template>
                        </el-table-column>
                        <el-table-column label="质量扣重(吨)" width="110" align="right">
                          <template #default="{ row: i }"><span class="num">{{ i.qualityQty }}</span></template>
                        </el-table-column>
                        <el-table-column label="差异(吨)" width="90" align="right">
                          <template #default="{ row: i }">
                            <span class="num" :class="{ 'text-danger': i.status === 'diff' }">{{ i.diff }}</span>
                          </template>
                        </el-table-column>
                        <el-table-column label="签收" width="70" align="center">
                          <template #default="{ row: i }">
                            <el-tag v-if="i.hasReceipt === true" size="small" type="success" effect="light">已签收</el-tag>
                            <el-tag v-else-if="i.hasReceipt === false" size="small" type="danger" effect="light">未签收</el-tag>
                            <span v-else class="text-muted">—</span>
                          </template>
                        </el-table-column>
                        <el-table-column label="比对" width="80" align="center">
                          <template #default="{ row: i }">
                            <el-tag v-if="i.status === 'diff'" size="small" type="danger" effect="light">差异</el-tag>
                            <el-tag v-else size="small" type="success" effect="light">一致</el-tag>
                          </template>
                        </el-table-column>
                      </el-table>
                    </div>
                    <div v-else class="recon-detail__empty">该账单尚未对账，暂无明细</div>
                  </template>
                </el-table-column>
                <el-table-column prop="billNo" label="账单编号" min-width="140" />
                <el-table-column prop="period" label="周期" width="90" />
                <el-table-column label="金额" width="130" align="right">
                  <template #default="{ row }"><span class="num amount">{{ formatMoney(row.totalAmount) }}</span></template>
                </el-table-column>
                <el-table-column label="状态" width="90" align="center">
                  <template #default="{ row }">
                    <StatusTag :status="row.status" :map="settleStatusMap" />
                  </template>
                </el-table-column>
                <el-table-column label="对账确认" width="190" align="center">
                  <template #default="{ row }">
                    <el-tag v-if="row.customerConfirmed" size="small" type="success" effect="light">已确认</el-tag>
                    <template v-else-if="row.status === 'reconciling' && can('customer-confirm')">
                      <el-button size="small" type="primary" plain @click="confirmReconcile(row)">确认对账</el-button>
                      <el-button size="small" type="danger" plain @click="openObjection(row)">异议</el-button>
                    </template>
                    <el-tag v-else-if="hasOpenObjection(row)" size="small" type="danger" effect="light">已异议 · 待重新对账</el-tag>
                    <span v-else class="text-muted">—</span>
                  </template>
                </el-table-column>
              </el-table>
              <el-empty v-if="!settlements.length" description="暂无账单" :image-size="60" />
            </div>
          </div>

          <!-- 回款记录 -->
          <div class="panel">
            <div class="panel__header">
              <span class="panel__title">回款记录</span>
              <el-tag size="small" type="info" effect="plain">共 {{ payments.length }} 笔</el-tag>
            </div>
            <div class="panel__body">
              <el-table :data="payments" size="small" stripe max-height="260">
                <el-table-column prop="id" label="流水号" width="100" />
                <el-table-column label="账单" width="140">
                  <template #default="{ row }">{{ billNoOf(row.settlementId) }}</template>
                </el-table-column>
                <el-table-column label="金额" width="130" align="right">
                  <template #default="{ row }"><span class="num amount">{{ formatMoney(row.amount) }}</span></template>
                </el-table-column>
                <el-table-column prop="method" label="方式" width="100" align="center" />
                <el-table-column label="状态" width="80" align="center">
                  <template #default="{ row }">
                    <el-tag v-if="row.reversed" size="small" type="info" effect="plain">已冲正</el-tag>
                    <span v-else class="text-muted">正常</span>
                  </template>
                </el-table-column>
                <el-table-column prop="payTime" label="时间" min-width="140" />
              </el-table>
              <el-empty v-if="!payments.length" description="暂无回款" :image-size="60" />
            </div>
          </div>
        </el-col>

        <!-- 发票 -->
        <el-col :span="10">
          <div class="panel">
            <div class="panel__header">
              <span class="panel__title">发票</span>
              <el-tag size="small" type="info" effect="plain">共 {{ invoices.length }} 张</el-tag>
            </div>
            <div class="panel__body">
              <el-table :data="invoices" size="small" stripe max-height="480">
                <el-table-column prop="invoiceNo" label="发票号码" min-width="150">
                  <template #default="{ row }">{{ row.invoiceNo || '待开具' }}</template>
                </el-table-column>
                <el-table-column label="金额" width="130" align="right">
                  <template #default="{ row }"><span class="num amount">{{ formatMoney(row.amount) }}</span></template>
                </el-table-column>
                <el-table-column label="状态" width="90" align="center">
                  <template #default="{ row }">
                    <StatusTag :status="row.status" :map="invoiceStatusMap" />
                  </template>
                </el-table-column>
              </el-table>
              <el-empty v-if="!invoices.length" description="暂无发票" :image-size="60" />
            </div>
          </div>
        </el-col>
      </el-row>

      <!-- 发起运输需求 -->
      <el-dialog v-model="requestDialog" title="发起运输需求" width="560px">
        <el-alert
          title="提交后由平台销售审核，通过后将为您生成运输合同草稿并进入审批流程"
          type="info"
          :closable="false"
          show-icon
        />
        <el-form label-width="100px" style="margin-top: 16px">
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="商品" required>
                <el-select v-model="requestForm.commodityId" filterable placeholder="请选择" style="width: 100%">
                  <el-option
                    v-for="c in commodities.filter((x) => x.status === 'active')"
                    :key="c.id"
                    :label="c.name + '（' + c.category + '）'"
                    :value="c.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="计划数量(吨)" required>
                <el-input-number v-model="requestForm.quantity" :min="1" :step="35" style="width: 100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="装货场站" required>
                <el-select v-model="requestForm.loadTerminalId" filterable placeholder="请选择" style="width: 100%">
                  <el-option
                    v-for="t in terminals.filter((x) => x.type !== 'unloading' && x.status === 'operating')"
                    :key="t.id"
                    :label="t.name"
                    :value="t.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="卸货场站" required>
                <el-select v-model="requestForm.unloadTerminalId" filterable placeholder="请选择" style="width: 100%">
                  <el-option
                    v-for="t in terminals.filter((x) => x.type !== 'loading' && x.status === 'operating')"
                    :key="t.id"
                    :label="t.name"
                    :value="t.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="收货方" required>
                <el-select v-model="requestForm.consigneeId" filterable placeholder="请选择" style="width: 100%">
                  <el-option
                    v-for="c in customers.filter((x) => (x.type === 'consignee' || x.type === 'both') && x.status === 'active')"
                    :key="c.id"
                    :label="c.name"
                    :value="c.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="运输方式" required>
                <el-select v-model="requestForm.mode" style="width: 100%">
                  <el-option v-for="m in modes" :key="m" :label="m" :value="m" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="期望开始日期">
                <el-date-picker v-model="requestForm.expectDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="期望单价">
                <el-input-number v-model="requestForm.unitPrice" :min="0" :step="1" :precision="1" placeholder="元/吨（选填）" style="width: 100%" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="requestForm.remark" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="货物特性、装卸要求等（选填）" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="requestDialog = false">取消</el-button>
          <el-button type="primary" @click="submitRequest">提交需求</el-button>
        </template>
      </el-dialog>

      <!-- 客户异议（环节2：对对账结果有异议时提交，账单回待对账并触发重新对账） -->
      <el-dialog v-model="objDialog" title="提交对账异议" width="480px">
        <div v-if="objTarget">
          <el-alert
            :title="'账单 ' + objTarget.billNo + '：提交异议后账单回到“待对账”，平台重新对账后需再次确认新结果'"
            type="warning"
            :closable="false"
            show-icon
          />
          <el-form label-width="90px" style="margin-top: 16px">
            <el-form-item label="异议原因" required>
              <el-input
                v-model="objForm.reason"
                type="textarea"
                :rows="3"
                maxlength="200"
                show-word-limit
                placeholder="请描述对对账结果的具体异议（差异/损耗/签收等）"
              />
            </el-form-item>
          </el-form>
        </div>
        <template #footer>
          <el-button @click="objDialog = false">取消</el-button>
          <el-button type="danger" @click="submitObjection">提交异议</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<script setup>
defineOptions({ name: 'Portal' })
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { useCollection } from '@/composables/useCollection'
import { outstandingOf, prepaymentAvailable } from '@/mock/flow'
import { api, refreshDb } from '@/api'
import { useUserStore } from '@/store'
import { usePerm } from '@/permission'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'

const userStore = useUserStore()
const { can } = usePerm()

/* ===== Phase 4 灰度：生产模式（薄客户端）——发起运输需求表单的商品/场站/收货方下拉为只读引用，读后端集合；本方合同/需求/账单保留本地 db（确认对账/异议/发起需求写后断言依赖乐观态） ===== */
const commoditiesCol = useCollection('commodities', () => ({ key: 'portal:commodities' }))
const terminalsCol = useCollection('terminals', () => ({ key: 'portal:terminals' }))
const customersCol = useCollection('customers', () => ({ key: 'portal:customers' }))
const commodities = computed(() => commoditiesCol.data.value)
const terminals = computed(() => terminalsCol.data.value)
const customers = computed(() => customersCol.data.value)
onMounted(() => { commoditiesCol.refresh(); terminalsCol.refresh(); customersCol.refresh() })
const onRefreshed = () => { commoditiesCol.refresh(); terminalsCol.refresh(); customersCol.refresh() }
window.addEventListener('blms:refreshed', onRefreshed)
onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))

/* ===== Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 快照重水合 =====
 * 门户主表（transportRequests/settlements/contracts）读本地 db（快照水合），
 * 写后 refreshDb 拉回权威态。后端业务错误经 ApiResult.success 包装为 data.error（HTTP 200），须检查 r.data.error。 */
async function prodWrite(path, body) {
  const r = await api('POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return null
  }
  await refreshDb()
  return r.data
}

/** 当前登录账号绑定的客户（客户角色账号携带 customerId） */
const user = computed(() => db.users.find((u) => u.username === userStore.userInfo.username))
const customer = computed(() => (user.value?.customerId ? db.customers.find((c) => c.id === user.value.customerId) : null))

const contracts = computed(() => db.contracts.filter((c) => c.shipperId === customer.value?.id))

/** 本客户发起的运输需求（新提交在前） */
const myRequests = computed(() =>
  db.transportRequests
    .filter((r) => r.customerId === customer.value?.id)
    .sort((a, b) => (a.createTime < b.createTime ? 1 : -1))
)
const requestStatusMap = {
  pending: { label: '待处理', type: 'warning' },
  converted: { label: '已转合同', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' }
}

/* ===== 发起运输需求 ===== */
const modes = ['公路', '铁路', '水运', '多式联运', '管道']
const requestDialog = ref(false)
const requestForm = reactive({
  commodityId: '',
  quantity: 350,
  loadTerminalId: '',
  unloadTerminalId: '',
  consigneeId: '',
  mode: '公路',
  expectDate: dayjs().add(14, 'day').format('YYYY-MM-DD'),
  unitPrice: null,
  remark: ''
})

function openRequest() {
  Object.assign(requestForm, {
    commodityId: '',
    quantity: 350,
    loadTerminalId: '',
    unloadTerminalId: '',
    consigneeId: '',
    mode: '公路',
    expectDate: dayjs().add(14, 'day').format('YYYY-MM-DD'),
    unitPrice: null,
    remark: ''
  })
  requestDialog.value = true
}

async function submitRequest() {
  if (!requestForm.commodityId || !requestForm.loadTerminalId || !requestForm.unloadTerminalId || !requestForm.consigneeId) {
    ElMessage.warning('请完整填写商品、装/卸货场站与收货方')
    return
  }
  if (requestForm.loadTerminalId === requestForm.unloadTerminalId) {
    ElMessage.warning('装货场站与卸货场站不能相同')
    return
  }
  const r = await prodWrite('/contract/request', { ...requestForm, customerId: customer.value.id })
  if (!r) return
  requestDialog.value = false
  ElMessage.success(`运输需求 ${r.id} 已提交，请等待平台处理`)
}
const executingCount = computed(() => contracts.value.filter((c) => c.status === 'executing').length)
/** 累计运量：按实际已完成车次运量汇总（与客户详情同口径） */
const totalVolume = computed(() => {
  const ids = new Set(contracts.value.map((c) => c.id))
  return db.dispatches.filter((d) => d.status === 'completed' && ids.has(d.contractId)).reduce((s, d) => s + d.quantity, 0)
})
const settlements = computed(() => db.settlements.filter((s) => s.customerId === customer.value?.id))
const payments = computed(() =>
  db.payments
    .filter((p) => settlements.value.some((s) => s.id === p.settlementId))
    .sort((a, b) => (a.payTime < b.payTime ? 1 : -1))
)
const invoices = computed(() => db.invoices.filter((i) => settlements.value.some((s) => s.id === i.settlementId)))
const outstanding = computed(() => outstandingOf(customer.value?.id))
/** 环节5：可用预付款（客户预付货款，冲减授信占用，与 creditCheck 同口径） */
const prepayAvailable = computed(() => prepaymentAvailable(customer.value?.id))
const creditPct = computed(() => {
  const limit = customer.value?.creditLimit
  if (!limit) return 0
  const occupied = Math.max(0, outstanding.value - prepayAvailable.value)
  return Math.round((occupied / limit) * 100)
})

function billNoOf(id) {
  return db.settlements.find((s) => s.id === id)?.billNo || '—'
}

function confirmReconcile(s) {
  ElMessageBox.confirm(
    `确认账单 ${s.billNo} 的对账结果（差异 ${s.reconciliation?.diffCount ?? 0} 车次，损耗 ${s.reconciliation?.lossQty ?? 0} 吨）？确认后不可撤销。`,
    '确认对账',
    { type: 'info' }
  )
    .then(async () => {
      const r = await prodWrite('/settlement/' + s.id + '/customerConfirm')
      if (r) ElMessage.success('已确认对账结果')
    })
    .catch(() => {})
}

/* ===== 客户异议（环节2：对对账结果有异议时提交，账单回待对账并触发重新对账） ===== */
const objDialog = ref(false)
const objTarget = ref(null)
const objForm = reactive({ reason: '' })

function hasOpenObjection(row) {
  return (row.objections || []).some((o) => o.status === 'open')
}

function openObjection(s) {
  objTarget.value = s
  objForm.reason = ''
  objDialog.value = true
}

async function submitObjection() {
  if (!objForm.reason.trim()) {
    ElMessage.warning('请填写异议原因')
    return
  }
  const r = await prodWrite('/settlement/' + objTarget.value.id + '/customerObjection', { reason: objForm.reason.trim() })
  if (!r) return
  objDialog.value = false
  ElMessage.success('异议已提交，平台将重新对账，请等待新的对账结果')
}

const contractStatusMap = {
  draft: { label: '草稿', type: 'info' },
  pending: { label: '待审批', type: 'warning' },
  executing: { label: '执行中', type: 'primary' },
  completed: { label: '已完成', type: 'success' },
  terminated: { label: '已终止', type: 'danger' },
  archived: { label: '已归档', type: 'info' }
}
const settleStatusMap = {
  pending: { label: '待对账', type: 'info' },
  reconciling: { label: '对账中', type: 'warning' },
  settled: { label: '已结算', type: 'success' },
  overdue: { label: '已逾期', type: 'danger' }
}
const invoiceStatusMap = {
  pending: { label: '待开具', type: 'info' },
  issued: { label: '已开具', type: 'success' },
  'red-flushed': { label: '已红冲', type: 'danger' }
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

/* 列内堆叠面板补间距（.page 的 gap 不作用于 el-col 内部） */
.el-col .panel {
  margin-bottom: 16px;
}

.el-col .panel:last-child {
  margin-bottom: 0;
}

.amount {
  font-weight: 600;
}

.text-muted {
  color: var(--text-secondary);
}

.text-success {
  color: var(--color-success);
}

.text-danger {
  color: var(--color-danger);
}

/* F3：对账明细展开行 */
.recon-detail {
  padding: 8px 16px 4px;
  background: var(--bg-subtle, rgba(0, 0, 0, 0.02));
}

.recon-detail__summary {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.recon-detail__empty {
  padding: 12px 16px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
