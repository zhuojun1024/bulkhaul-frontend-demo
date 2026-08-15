<template>
  <div class="page" v-loading="loading">
    <div class="panel plan-detail__header">
      <div class="plan-detail__head">
        <el-button :icon="ArrowLeft" circle @click="$router.back()" />
        <div>
          <div class="plan-detail__name">
            运输计划 {{ plan?.id }}
            <StatusTag v-if="plan" :status="plan.status" :map="statusMap" />
          </div>
          <div class="plan-detail__meta">
            所属合同
            <span class="link" @click="$router.push(`/contract/${plan?.contractId}`)">{{ plan?.contractId }}</span>
            · 计划日期 {{ plan?.planDate }}
          </div>
        </div>
        <div class="plan-detail__actions">
          <el-button v-if="plan?.status === 'pending'" type="primary" :icon="Position" @click="dispatch">
            立即调度
          </el-button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__body">
        <el-descriptions :column="3" border>
          <el-descriptions-item label="商品">{{ commodity?.name }}（{{ commodity?.category }}）</el-descriptions-item>
          <el-descriptions-item label="运输方式">
            <el-tag size="small">{{ plan?.mode }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="计划数量">
            <span class="num">{{ formatNum(plan?.quantity) }} 吨</span>
          </el-descriptions-item>
          <el-descriptions-item label="装货场站">{{ find.terminal(plan?.loadTerminalId)?.name }}</el-descriptions-item>
          <el-descriptions-item label="卸货场站">{{ find.terminal(plan?.unloadTerminalId)?.name }}</el-descriptions-item>
          <el-descriptions-item label="合同单价">
            <span class="num">{{ plan?.unitPrice }} 元/吨</span>
          </el-descriptions-item>
        </el-descriptions>

        <div class="desc-title">执行进度</div>
        <el-steps :active="stepActive" align-center finish-status="success" style="margin-bottom: 24px">
          <el-step title="计划下达" :description="plan?.planDate" />
          <el-step title="调度派车" :description="dispatches.length ? `${dispatches.length} 车次` : '待调度'" />
          <el-step title="装货过磅" :description="loadedCount ? `${loadedCount} 车已装` : '—'" />
          <el-step title="在途运输" :description="intransitCount ? `${intransitCount} 车在途` : '—'" />
          <el-step title="卸货完成" :description="completedCount ? `${completedCount} 车完成` : '—'" />
        </el-steps>

        <div class="desc-title">调度单列表</div>
        <el-table :data="dispatches" stripe size="small">
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
          <el-table-column prop="dispatchTime" label="下发时间" min-width="150" />
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="dispatchStatusMap" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="$router.push(`/dispatch/${row.id}`)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!dispatches.length" description="尚未生成调度单" :image-size="80" />
      </div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'PlanDetail' })
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Position } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { createDispatches, creditCheck } from '@/mock/flow'
import { formatNum } from '@/utils'

const route = useRoute()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 200))

const plan = computed(() => find.plan(route.params.id))
const commodity = computed(() => find.commodity(plan.value?.commodityId))
const dispatches = computed(() => db.dispatches.filter((d) => d.planId === plan.value?.id))
const loadedCount = computed(() => dispatches.value.filter((d) => d.loadTime).length)
const intransitCount = computed(() => dispatches.value.filter((d) => d.status === 'intransit').length)
const completedCount = computed(() => dispatches.value.filter((d) => d.status === 'completed').length)

const stepActive = computed(() => {
  if (!plan.value) return 0
  if (plan.value.status === 'pending') return 0
  if (plan.value.status === 'dispatched') return 1
  if (completedCount.value === dispatches.value.length && dispatches.value.length) return 5
  if (intransitCount.value) return 3
  if (loadedCount.value) return 2
  return 1
})

const statusMap = {
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

function dispatch() {
  const contract = find.contract(plan.value.contractId)
  const check = creditCheck(contract?.shipperId, plan.value.quantity * (plan.value.unitPrice || 0))
  if (!check.ok) {
    ElMessageBox.alert(check.message, '信用校验未通过', { type: 'warning', confirmButtonText: '知道了' })
    return
  }
  ElMessageBox.confirm(
    `为计划 ${plan.value.id} 生成 3 张调度单（自动匹配空闲车辆，数量按批次均摊）？`,
    '计划调度',
    { type: 'info', confirmButtonText: '确认调度' }
  ).then(() => {
    const { created, error } = createDispatches(plan.value, 3)
    if (error) {
      ElMessage.warning(error)
      return
    }
    ElMessage.success(`已生成 ${created.length} 张调度单`)
  }).catch(() => {})
}
</script>

<style scoped>
.plan-detail__header {
  padding: 16px 20px;
}

.plan-detail__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.plan-detail__name {
  font-size: 17px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}

.plan-detail__meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.link {
  color: var(--color-primary);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
</style>
