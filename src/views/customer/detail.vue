<template>
  <div class="page" v-loading="loading">
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
              <el-table-column label="操作" width="70" align="center">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="$router.push(`/contract/${row.id}`)">详情</el-button>
                </template>
              </el-table-column>
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
              <el-table-column label="操作" width="70" align="center">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="$router.push(`/settlement/${row.id}`)">详情</el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-if="!settlements.length" description="暂无结算记录" :image-size="60" />
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
defineOptions({ name: 'CustomerDetail' })
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { outstandingOf } from '@/mock/flow'
import { formatMoney, formatNum } from '@/utils'

const route = useRoute()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 200))

const customer = computed(() => find.customer(route.params.id))
const contracts = computed(() =>
  db.contracts.filter((c) => c.shipperId === customer.value?.id || c.consigneeId === customer.value?.id)
)
const settlements = computed(() => db.settlements.filter((s) => s.customerId === customer.value?.id))
const executingCount = computed(() => contracts.value.filter((c) => c.status === 'executing').length)
const totalVolume = computed(() => contracts.value.reduce((s, c) => s + c.quantity, 0))
const pendingAmount = computed(() =>
  settlements.value.filter((s) => s.status !== 'settled').reduce((s, x) => s + (x.totalAmount - x.paidAmount), 0)
)
const outstanding = computed(() => outstandingOf(customer.value?.id))
const creditPct = computed(() => {
  const limit = customer.value?.creditLimit
  if (!limit) return 0
  return Math.round((outstanding.value / limit) * 100)
})

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
