<template>
  <div class="page">
    <div class="panel customer-detail__header">
      <div class="customer-detail__head">
        <el-button :icon="ArrowLeft" circle @click="$router.back()" />
        <div class="customer-detail__logo">{{ customer?.name?.charAt(0) }}</div>
        <div>
          <div class="customer-detail__name">
            {{ customer?.name }}
            <el-tag size="small" :type="levelTag(customer?.level)" effect="dark">{{ customer?.level }} 级客户</el-tag>
            <StatusTag v-if="customer" :status="customer.status" :map="statusMap" />
          </div>
          <div class="customer-detail__meta">
            {{ typeMap[customer?.type] }} · {{ customer?.region }} · 合作始于 {{ customer?.joinDate }}
          </div>
        </div>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="8">
        <div class="panel">
          <div class="panel__header"><span class="panel__title">客户档案</span></div>
          <div class="panel__body">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="联系人">{{ customer?.contact }}</el-descriptions-item>
              <el-descriptions-item label="电话">{{ customer?.phone }}</el-descriptions-item>
              <el-descriptions-item label="地址">{{ customer?.address }}</el-descriptions-item>
              <el-descriptions-item label="累计业务额">
                <span class="num amount">{{ formatMoney(customer?.totalBusiness) }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="授信额度">
                <span class="num">{{ formatMoney(customer?.creditLimit) }}</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </div>

        <div class="panel">
          <div class="panel__header"><span class="panel__title">业务概览</span></div>
          <div class="panel__body">
            <div class="biz-item">
              <span>合同总数</span>
              <b class="num">{{ contracts.length }}</b>
            </div>
            <div class="biz-item">
              <span>执行中合同</span>
              <b class="num text-primary">{{ executingCount }}</b>
            </div>
            <div class="biz-item">
              <span>累计运量</span>
              <b class="num">{{ formatNum(totalVolume) }} 吨</b>
            </div>
            <div class="biz-item">
              <span>结算中金额</span>
              <b class="num text-warning">{{ formatMoney(pendingAmount) }}</b>
            </div>
            <div class="biz-item">
              <span>未付余额</span>
              <b class="num text-warning">{{ formatMoney(outstanding) }}</b>
            </div>
            <div class="biz-item">
              <span>可用预付款</span>
              <b class="num text-success">{{ formatMoney(prepayAvailable) }}</b>
            </div>
            <div class="biz-item biz-item--block">
              <div class="biz-item__line">
                <span>授信占用（额度 {{ formatMoney(customer?.creditLimit) }}）</span>
                <b class="num" :class="creditPct >= 100 ? 'text-danger' : ''">{{ creditPct }}%</b>
              </div>
              <el-progress
                :percentage="Math.min(100, creditPct)"
                :status="creditPct >= 100 ? 'exception' : creditPct >= 80 ? 'warning' : 'success'"
                :stroke-width="6"
              />
            </div>
          </div>
        </div>

        <!-- 环节5：预付款台账（收取 / 抵扣） -->
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">预付款台账</span>
            <el-button v-if="can('settlement')" type="primary" size="small" :icon="Money" @click="openCollect">
              收取预付款
            </el-button>
          </div>
          <div class="panel__body">
            <el-table :data="prepayments" size="small" stripe max-height="240">
              <el-table-column prop="id" label="编号" width="90" />
              <el-table-column prop="time" label="收取时间" width="140" />
              <el-table-column label="金额(元)" width="110" align="right">
                <template #default="{ row }"><span class="num">{{ formatMoney(row.amount) }}</span></template>
              </el-table-column>
              <el-table-column label="已抵扣(元)" width="110" align="right">
                <template #default="{ row }"><span class="num">{{ formatMoney(row.used) }}</span></template>
              </el-table-column>
              <el-table-column label="可用(元)" width="110" align="right">
                <template #default="{ row }">
                  <span class="num" :class="row.amount - row.used > 0 ? 'text-success' : ''">{{ formatMoney(row.amount - row.used) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.used >= row.amount ? 'info' : row.used > 0 ? 'warning' : 'success'" effect="plain">
                    {{ row.used >= row.amount ? '已抵扣' : row.used > 0 ? '部分抵扣' : '可用' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="method" label="方式" min-width="80" />
            </el-table>
            <el-empty v-if="!prepayments.length" description="暂无预付款记录，可点击右上角「收取预付款」" :image-size="60" />
          </div>
        </div>
      </el-col>

      <el-col :span="16">
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">合同记录</span>
            <el-tag size="small" type="info" effect="plain">共 {{ contracts.length }} 份</el-tag>
          </div>
          <div class="panel__body">
            <el-table :data="contracts" size="small" stripe max-height="300">
              <el-table-column prop="id" label="合同编号" width="100" />
              <el-table-column prop="name" label="合同名称" min-width="220" show-overflow-tooltip />
              <el-table-column label="数量(吨)" width="100" align="right">
                <template #default="{ row }">{{ formatNum(row.quantity) }}</template>
              </el-table-column>
              <el-table-column label="金额" width="120" align="right">
                <template #default="{ row }">{{ formatMoney(row.amount) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <StatusTag :status="row.status" :map="contractStatusMap" />
                </template>
              </el-table-column>
              <ActionColumn width="70">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="$router.push(`/contract/${row.id}`)">详情</el-button>
                </template>
              </ActionColumn>
            </el-table>
            <el-empty v-if="!contracts.length" description="暂无合同" :image-size="60" />
          </div>
        </div>

        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">结算记录</span>
            <el-tag size="small" type="info" effect="plain">共 {{ settlements.length }} 笔</el-tag>
          </div>
          <div class="panel__body">
            <el-table :data="settlements" size="small" stripe max-height="300">
              <el-table-column prop="billNo" label="账单编号" min-width="140" />
              <el-table-column prop="period" label="周期" width="90" />
              <el-table-column label="金额" width="130" align="right">
                <template #default="{ row }">{{ formatMoney(row.totalAmount) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <StatusTag :status="row.status" :map="settleStatusMap" />
                </template>
              </el-table-column>
              <ActionColumn width="70">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="$router.push(`/settlement/${row.id}`)">详情</el-button>
                </template>
              </ActionColumn>
            </el-table>
            <el-empty v-if="!settlements.length" description="暂无结算记录" :image-size="60" />
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 环节5：收取预付款 -->
    <el-dialog v-model="collectDialog" title="收取预付款" width="440px">
      <el-form label-width="90px">
        <el-form-item label="客户">
          <span>{{ customer?.name }}</span>
        </el-form-item>
        <el-form-item label="预付金额">
          <el-input-number v-model="collectForm.amount" :min="1" :precision="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="收款方式">
          <el-select v-model="collectForm.method" style="width: 100%">
            <el-option v-for="m in payMethods" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="collectForm.remark" maxlength="50" show-word-limit placeholder="如：季度预付款" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="collectDialog = false">取消</el-button>
        <el-button type="primary" @click="submitCollect">确认收取</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'CustomerDetail' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Money } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
// 本视图交叉引用查找（原 @/mock find 下沉，仅声明本视图用到的键）
const find = {
  customer: (id) => db.customers.find((c) => c.id === id),
}
import { outstandingOf, prepaymentOf, prepaymentAvailable } from '@/mock/derived'
import { api, refreshDb } from '@/api'
import { usePerm } from '@/permission'
import { formatMoney, formatNum } from '@/utils'

const route = useRoute()
const { can } = usePerm()

/* ===== Phase 4 灰度：生产模式（薄客户端）——客户详情读后端 /api/coll/customers/{id} + contracts/settlements/dispatches ===== */
const customerRec = ref(null)
async function loadDetail() {
  const r = await api('GET', '/coll/customers/' + route.params.id)
  customerRec.value = r.ok ? r.data : null
}
const customer = computed(() => customerRec.value || find.customer(route.params.id))
const contracts = computed(() =>
  db.contracts.filter((c) => c.shipperId === customer.value?.id || c.consigneeId === customer.value?.id)
)
const settlements = computed(() => db.settlements.filter((s) => s.customerId === customer.value?.id))
const executingCount = computed(() => contracts.value.filter((c) => c.status === 'executing').length)
/** 累计运量：按实际已完成车次运量汇总（非合同计划量之和） */
const totalVolume = computed(() => {
  const ids = new Set(contracts.value.map((c) => c.id))
  return db.dispatches.filter((d) => d.status === 'completed' && ids.has(d.contractId)).reduce((s, d) => s + d.quantity, 0)
})
onMounted(loadDetail)
watch(() => route.params.id, loadDetail)
const pendingAmount = computed(() =>
  settlements.value.filter((s) => s.status !== 'settled').reduce((s, x) => s + (x.totalAmount - x.paidAmount), 0)
)
const outstanding = computed(() => outstandingOf(customer.value?.id))
/** 环节5：预付款台账与可用余额（预付冲减信用占用，与 creditCheck 同口径） */
const prepayments = computed(() => prepaymentOf(customer.value?.id))
const prepayAvailable = computed(() => prepaymentAvailable(customer.value?.id))
const creditPct = computed(() => {
  const limit = customer.value?.creditLimit
  if (!limit) return 0
  const occupied = Math.max(0, outstanding.value - prepayAvailable.value)
  return Math.round((occupied / limit) * 100)
})

/* ===== 环节5：收取预付款 ===== */
const collectDialog = ref(false)
const collectForm = reactive({ amount: 100000, method: '银行转账', remark: '' })
const payMethods = ['银行转账', '支票', '承兑汇票']

function openCollect() {
  collectForm.amount = 100000
  collectForm.method = '银行转账'
  collectForm.remark = ''
  collectDialog.value = true
}

async function submitCollect() {
  // Phase 4 引擎移除：生产模式写操作 = 后端权威（冻结守卫 + RBAC + 审计）
  const r = await api('POST', '/settlement/prepayment/collect', {
    customerId: customer.value.id,
    amount: collectForm.amount,
    method: collectForm.method,
    remark: collectForm.remark
  })
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '收取预付款失败')
    return
  }
  await refreshDb()
  await loadDetail()
  collectDialog.value = false
  ElMessage.success(`预付款已收取：${(r.data && r.data.id) || ''}`)
}

const typeMap = { shipper: '发货方', consignee: '收货方', both: '双向客户' }
const statusMap = {
  active: { label: '正常', type: 'success' },
  frozen: { label: '已冻结', type: 'danger' }
}
const contractStatusMap = {
  draft: { label: '草稿', type: 'info' },
  pending: { label: '待审批', type: 'warning' },
  executing: { label: '执行中', type: 'primary' },
  completed: { label: '已完成', type: 'success' },
  terminated: { label: '已终止', type: 'danger' }
}
const settleStatusMap = {
  pending: { label: '待对账', type: 'info' },
  reconciling: { label: '对账中', type: 'warning' },
  settled: { label: '已结算', type: 'success' },
  overdue: { label: '已逾期', type: 'danger' }
}

function levelTag(level) {
  return { A: 'danger', B: 'warning', C: 'info' }[level] || 'info'
}
</script>

<style scoped>
.customer-detail__header {
  padding: 16px 20px;
}

.customer-detail__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.customer-detail__logo {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-400));
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
}

.customer-detail__name {
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
}

.customer-detail__meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.amount {
  font-weight: 600;
}

.biz-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border-color);
  font-size: 13px;
  color: var(--text-secondary);
}

.biz-item:last-child {
  border-bottom: none;
}

.biz-item b {
  font-size: 15px;
  color: var(--text-primary);
}

.text-primary {
  color: var(--color-primary) !important;
}

.text-warning {
  color: var(--color-warning) !important;
}

.text-danger {
  color: var(--color-danger) !important;
}

.biz-item--block {
  display: block;
}

.biz-item__line {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}
</style>
