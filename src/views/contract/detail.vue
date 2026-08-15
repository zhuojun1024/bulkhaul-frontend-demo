<template>
  <div class="page" v-loading="loading">
    <!-- 头部 -->
    <div class="panel contract-detail__header">
      <div class="contract-detail__head">
        <el-button :icon="ArrowLeft" circle @click="$router.back()" />
        <div class="contract-detail__title">
          <div class="contract-detail__name">
            {{ contract?.name }}
            <StatusTag v-if="contract" :status="contract.status" :map="statusMap" />
          </div>
          <div class="contract-detail__meta">
            合同编号 {{ contract?.id }} · 签约日期 {{ contract?.signDate }}
          </div>
        </div>
        <div class="contract-detail__actions">
          <el-button v-if="contract?.status === 'pending'" type="success" :icon="Check" @click="approve">
            审批通过
          </el-button>
          <el-button v-if="contract?.status === 'executing'" type="danger" plain :icon="CircleClose" @click="terminate">
            终止合同
          </el-button>
          <el-button :icon="Printer" @click="printContract">打印</el-button>
        </div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="contract-detail__tabs">
      <!-- 基本信息 -->
      <el-tab-pane label="基本信息" name="base">
        <div class="panel">
          <div class="panel__body">
            <el-descriptions :column="3" border>
              <el-descriptions-item label="发货方">{{ shipper?.name }}</el-descriptions-item>
              <el-descriptions-item label="收货方">{{ consignee?.name }}</el-descriptions-item>
              <el-descriptions-item label="联系人">{{ contract?.contact }} {{ contract?.phone }}</el-descriptions-item>
              <el-descriptions-item label="商品名称">
                {{ commodity?.name }}（{{ commodity?.category }}）
              </el-descriptions-item>
              <el-descriptions-item label="运输方式">
                <el-tag size="small">{{ contract?.mode }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="计划周期">{{ contract?.startDate }} 至 {{ contract?.endDate }}</el-descriptions-item>
              <el-descriptions-item label="装货场站">{{ loadTerminal?.name }}</el-descriptions-item>
              <el-descriptions-item label="卸货场站">{{ unloadTerminal?.name }}</el-descriptions-item>
              <el-descriptions-item label="计划数量">
                <span class="num">{{ formatNum(contract?.quantity) }} 吨</span>
              </el-descriptions-item>
              <el-descriptions-item label="合同单价">
                <span class="num">{{ contract?.unitPrice }} 元/吨</span>
              </el-descriptions-item>
              <el-descriptions-item label="合同金额">
                <span class="num amount">{{ formatMoney(contract?.amount) }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="备注" :span="3">{{ contract?.remark || '—' }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </div>
      </el-tab-pane>

      <!-- 执行进度 -->
      <el-tab-pane label="执行进度" name="progress">
        <div class="panel">
          <div class="panel__body">
            <div class="exec-summary">
              <div class="exec-summary__item">
                <div class="exec-summary__label">总体进度</div>
                <el-progress type="circle" :percentage="contract?.progress || 0" :width="80" />
              </div>
              <div class="exec-summary__item">
                <div class="exec-summary__label">计划批次</div>
                <div class="exec-summary__value num">{{ plans.length }} 批</div>
              </div>
              <div class="exec-summary__item">
                <div class="exec-summary__label">已调度车次</div>
                <div class="exec-summary__value num">{{ dispatches.length }} 车</div>
              </div>
              <div class="exec-summary__item">
                <div class="exec-summary__label">已执行运量</div>
                <div class="exec-summary__value num">{{ formatNum(executedVolume) }} 吨</div>
              </div>
            </div>

            <div class="desc-title">运输计划批次</div>
            <el-table :data="plans" stripe size="small">
              <el-table-column prop="id" label="计划编号" width="110" />
              <el-table-column prop="planDate" label="计划日期" width="110" />
              <el-table-column label="数量(吨)" width="100" align="right">
                <template #default="{ row }">{{ row.quantity }}</template>
              </el-table-column>
              <el-table-column label="装货场站" min-width="150">
                <template #default="{ row }">{{ find.terminal(row.loadTerminalId)?.name }}</template>
              </el-table-column>
              <el-table-column label="卸货场站" min-width="150">
                <template #default="{ row }">{{ find.terminal(row.unloadTerminalId)?.name }}</template>
              </el-table-column>
              <el-table-column label="状态" width="100" align="center">
                <template #default="{ row }">
                  <StatusTag :status="row.status" :map="planStatusMap" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="80" align="center">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="$router.push(`/plan/${row.id}`)">
                    详情
                  </el-button>
                </template>
              </el-table-column>
            </el-table>

            <div class="desc-title">调度执行记录</div>
            <el-table :data="dispatches" stripe size="small" max-height="400">
              <el-table-column prop="id" label="调度单号" width="110" />
              <el-table-column label="车牌号" width="120">
                <template #default="{ row }">{{ find.vehicle(row.vehicleId)?.plate }}</template>
              </el-table-column>
              <el-table-column label="司机" width="90">
                <template #default="{ row }">{{ find.driver(row.driverId)?.name }}</template>
              </el-table-column>
              <el-table-column label="数量(吨)" width="90" align="right">
                <template #default="{ row }">{{ row.quantity }}</template>
              </el-table-column>
              <el-table-column prop="dispatchTime" label="下发时间" width="150" />
              <el-table-column prop="unloadTime" label="卸货完成" min-width="150">
                <template #default="{ row }">{{ row.unloadTime || '—' }}</template>
              </el-table-column>
              <el-table-column label="状态" width="100" align="center">
                <template #default="{ row }">
                  <StatusTag :status="row.status" :map="dispatchStatusMap" />
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 结算记录 -->
      <el-tab-pane label="结算记录" name="settlement">
        <div class="panel">
          <div class="panel__body">
            <el-table :data="settlements" stripe size="small">
              <el-table-column prop="billNo" label="账单编号" width="150" />
              <el-table-column prop="period" label="结算周期" min-width="110" />
              <el-table-column label="车次" width="80" align="right">
                <template #default="{ row }">{{ row.dispatchCount }}</template>
              </el-table-column>
              <el-table-column label="运量(吨)" width="110" align="right">
                <template #default="{ row }">{{ formatNum(row.totalQuantity) }}</template>
              </el-table-column>
              <el-table-column label="结算金额" width="140" align="right">
                <template #default="{ row }">
                  <span class="num amount">{{ formatMoney(row.totalAmount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="100" align="center">
                <template #default="{ row }">
                  <StatusTag :status="row.status" :map="settleStatusMap" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="80" align="center">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="$router.push(`/settlement/${row.id}`)">
                    详情
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-if="!settlements.length" description="暂无结算记录" :image-size="80" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
defineOptions({ name: 'ContractDetail' })
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Check, CircleClose, Printer } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { formatMoney, formatNum } from '@/utils'

const route = useRoute()
const loading = ref(true)
const activeTab = ref('base')
onMounted(() => setTimeout(() => (loading.value = false), 200))

const contract = computed(() => find.contract(route.params.id))
const shipper = computed(() => find.customer(contract.value?.shipperId))
const consignee = computed(() => find.customer(contract.value?.consigneeId))
const commodity = computed(() => find.commodity(contract.value?.commodityId))
const loadTerminal = computed(() => find.terminal(contract.value?.loadTerminalId))
const unloadTerminal = computed(() => find.terminal(contract.value?.unloadTerminalId))

const plans = computed(() => db.plans.filter((p) => p.contractId === contract.value?.id))
const planIds = computed(() => new Set(plans.value.map((p) => p.id)))
const dispatches = computed(() => db.dispatches.filter((d) => planIds.value.has(d.planId)))
const settlements = computed(() => db.settlements.filter((s) => s.contractId === contract.value?.id))
const executedVolume = computed(() =>
  dispatches.value.filter((d) => d.status === 'completed').reduce((s, d) => s + d.quantity, 0)
)

const statusMap = {
  draft: { label: '草稿', type: 'info' },
  pending: { label: '待审批', type: 'warning' },
  executing: { label: '执行中', type: 'primary' },
  completed: { label: '已完成', type: 'success' },
  terminated: { label: '已终止', type: 'danger' }
}
const planStatusMap = {
  pending: { label: '待执行', type: 'info' },
  dispatched: { label: '已调度', type: 'primary' },
  intransit: { label: '执行中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  cancelled: { label: '已取消', type: 'danger' }
}
const dispatchStatusMap = {
  pending: { label: '待装货', type: 'info' },
  loading: { label: '装货中', type: 'warning' },
  intransit: { label: '在途', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  exception: { label: '异常', type: 'danger' }
}
const settleStatusMap = {
  pending: { label: '待对账', type: 'info' },
  reconciling: { label: '对账中', type: 'warning' },
  settled: { label: '已结算', type: 'success' },
  overdue: { label: '已逾期', type: 'danger' }
}

function approve() {
  ElMessageBox.confirm('确认审批通过该合同？', '合同审批', { type: 'warning' }).then(() => {
    contract.value.status = 'executing'
    ElMessage.success('审批通过，合同已进入执行状态')
  }).catch(() => {})
}

function terminate() {
  ElMessageBox.prompt('请输入终止原因', '终止合同', {
    inputPattern: /.{2,}/,
    inputErrorMessage: '原因至少 2 个字符'
  }).then(({ value }) => {
    contract.value.status = 'terminated'
    contract.value.remark = `【终止】${value}`
    ElMessage.success('合同已终止')
  }).catch(() => {})
}

function printContract() {
  const c = contract.value
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>合同 ${c.id}</title>
  <style>
    body{font-family:'Microsoft YaHei',sans-serif;padding:40px;color:#1d2129}
    h1{text-align:center;font-size:22px}
    .meta{text-align:center;color:#86909c;margin-bottom:24px}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    td,th{border:1px solid #e5e6eb;padding:10px;font-size:14px;text-align:left}
    th{background:#f7f8fa;width:120px}
    .sign{display:flex;justify-content:space-between;margin-top:60px}
    .sign div{width:45%}
  </style></head><body>
  <h1>大宗货物运输合同</h1>
  <div class="meta">合同编号：${c.id} &nbsp;&nbsp; 签约日期：${c.signDate}</div>
  <table>
    <tr><th>合同名称</th><td colspan="3">${c.name}</td></tr>
    <tr><th>发货方</th><td>${shipper.value?.name}</td><th>收货方</th><td>${consignee.value?.name}</td></tr>
    <tr><th>商品</th><td>${commodity.value?.name}</td><th>运输方式</th><td>${c.mode}</td></tr>
    <tr><th>装货场站</th><td>${loadTerminal.value?.name}</td><th>卸货场站</th><td>${unloadTerminal.value?.name}</td></tr>
    <tr><th>计划数量</th><td>${formatNum(c.quantity)} 吨</td><th>合同单价</th><td>${c.unitPrice} 元/吨</td></tr>
    <tr><th>合同金额</th><td colspan="3">${formatMoney(c.amount)}</td></tr>
    <tr><th>计划周期</th><td colspan="3">${c.startDate} 至 ${c.endDate}</td></tr>
  </table>
  <div class="sign">
    <div>发货方（盖章）：__________________</div>
    <div>收货方（盖章）：__________________</div>
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
.contract-detail__header {
  padding: 16px 20px;
}

.contract-detail__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.contract-detail__title {
  flex: 1;
  min-width: 0;
}

.contract-detail__name {
  font-size: 17px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}

.contract-detail__meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.contract-detail__actions {
  display: flex;
  gap: 8px;
}

.exec-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  padding: 16px;
  background: var(--color-neutral-50);
  border-radius: 8px;
  margin-bottom: 8px;
}

.exec-summary__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.exec-summary__label {
  font-size: 13px;
  color: var(--text-secondary);
}

.exec-summary__value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
}

.amount {
  font-weight: 600;
}
</style>
