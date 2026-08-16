<template>
  <div class="page">
    <PageHeader title="客户门户" desc="查看本方合同执行、账单对账与回款进度，并对对账结果进行确认">
      <el-tag v-if="customer" effect="light" round>{{ customer.name }}</el-tag>
    </PageHeader>

    <el-empty v-if="!customer" description="当前账号未绑定客户，无法访问门户" :image-size="80" />

    <template v-else>
      <!-- 客户概览 -->
      <div class="stat-row">
        <StatCard title="合同总数" :value="contracts.length" unit="份" icon="Document" color="var(--color-primary)" :sub="'执行中 ' + executingCount + ' 份'" />
        <StatCard title="累计运量" :value="formatNum(totalVolume)" unit="吨" icon="Van" color="var(--color-success)" sub="按实际完成车次" />
        <StatCard title="未付余额" :value="formatMoney(outstanding)" icon="Wallet" color="var(--color-warning)" sub="全部账单未付部分" />
        <StatCard
          title="授信占用"
          :value="creditPct"
          unit="%"
          icon="CreditCard"
          :color="creditPct >= 100 ? 'var(--color-danger)' : 'var(--color-info)'"
          :sub="'额度 ' + formatMoney(customer.creditLimit)"
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

      <el-row :gutter="16">
        <!-- 账单与对账确认 -->
        <el-col :span="14">
          <div class="panel">
            <div class="panel__header">
              <span class="panel__title">账单与对账</span>
              <el-tag size="small" type="info" effect="plain">共 {{ settlements.length }} 笔</el-tag>
            </div>
            <div class="panel__body">
              <el-table :data="settlements" size="small" stripe>
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
                <el-table-column label="对账确认" width="150" align="center">
                  <template #default="{ row }">
                    <el-tag v-if="row.customerConfirmed" size="small" type="success" effect="light">已确认</el-tag>
                    <el-button
                      v-else-if="row.status === 'reconciling' && can('customer-confirm')"
                      size="small"
                      type="primary"
                      plain
                      @click="confirmReconcile(row)"
                    >
                      确认对账
                    </el-button>
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
    </template>
  </div>
</template>

<script setup>
defineOptions({ name: 'Portal' })
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
import { customerConfirm, outstandingOf } from '@/mock/flow'
import { useUserStore } from '@/store'
import { usePerm } from '@/permission'
import { formatMoney, formatNum } from '@/utils'

const userStore = useUserStore()
const { can } = usePerm()

/** 当前登录账号绑定的客户（客户角色账号携带 customerId） */
const user = computed(() => db.users.find((u) => u.username === userStore.userInfo.username))
const customer = computed(() => (user.value?.customerId ? db.customers.find((c) => c.id === user.value.customerId) : null))

const contracts = computed(() => db.contracts.filter((c) => c.shipperId === customer.value?.id))
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
const creditPct = computed(() => {
  const limit = customer.value?.creditLimit
  if (!limit) return 0
  return Math.round((outstanding.value / limit) * 100)
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
    .then(() => {
      const r = customerConfirm(s)
      if (r && r.error) {
        ElMessage.error(r.error)
        return
      }
      ElMessage.success('已确认对账结果')
    })
    .catch(() => {})
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
  grid-template-columns: repeat(4, 1fr);
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
</style>
