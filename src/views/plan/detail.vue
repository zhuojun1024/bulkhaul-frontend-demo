<template>
  <div class="page">
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
          <el-button v-if="plan?.status === 'pending' && can('dispatch')" type="primary" :icon="Position" @click="dispatch">
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

    <!-- 调度弹窗（与计划列表页同口径：车次可配置 + 车辆来源） -->
    <el-dialog v-model="dispatchVisible" title="计划调度" width="520px">
      <div v-if="plan" class="dispatch-dialog">
        <el-alert :title="'计划 ' + plan.id + '：' + (commodity?.name || '') + ' ' + formatNum(plan.quantity) + ' 吨'" type="info" :closable="false" show-icon />
        <el-alert
          v-if="!isRoad"
          :title="plan.mode + '方式按运输单元执行（车号/船名/管段），无需匹配车辆与司机，不产生公路磅单'"
          type="warning"
          :closable="false"
          show-icon
          style="margin-top: 10px"
        />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item :label="isRoad ? '调度车次' : '运输单元数'">
            <el-input-number v-model="dispatchCount" :min="1" :max="10" />
            <span class="dispatch-dialog__tip">每{{ isRoad ? '车' : '单元' }}约 {{ perTripQuantity }} 吨</span>
          </el-form-item>
          <template v-if="isRoad">
            <el-form-item label="车辆来源">
              <el-radio-group v-model="vehicleSource">
                <el-radio value="auto">自动匹配空闲车辆</el-radio>
                <el-radio value="manual">手动指定</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="vehicleSource === 'manual'" label="选择车辆">
              <el-select v-model="selectedVehicles" multiple filterable placeholder="选择车辆" style="width: 100%">
                <el-option v-for="v in idleVehicles" :key="v.id" :label="v.plate + '（' + v.type + '）'" :value="v.id" />
              </el-select>
            </el-form-item>
          </template>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmDispatch">确认调度</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'PlanDetail' })
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Position } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { BUSY_STATUSES, createDispatches, creditCheck, isRoadMode, vehicleInspectionExpired } from '@/mock/flow'
import { formatNum } from '@/utils'
import { usePerm } from '@/permission'

const route = useRoute()
const { can } = usePerm()

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

/* ===== 调度（与计划列表页同口径：车次可配置 + 车辆来源，不再写死 3 车次） ===== */
const dispatchVisible = ref(false)
const dispatchCount = ref(3)
const vehicleSource = ref('auto')
const selectedVehicles = ref([])
/** 已有未完结车次（全部非终态）的车辆不可再被指定，与 createDispatches 互斥口径一致（N-2：含在途/卸货中） */
const busyVehicleIds = computed(() => new Set(db.dispatches.filter((d) => BUSY_STATUSES.includes(d.status)).map((d) => d.vehicleId)))
/** 可选车辆：空闲 + 非铁路/水运车型 + 无未完结车次 + 年检未过期（与 createDispatches 守卫同口径） */
const idleVehicles = computed(() =>
  db.vehicles.filter(
    (v) =>
      v.status === 'idle' &&
      v.type !== '铁路敞车' &&
      v.type !== '散货船' &&
      !vehicleInspectionExpired(v) &&
      !busyVehicleIds.value.has(v.id)
  )
)
const isRoad = computed(() => isRoadMode(plan.value?.mode))
const perTripQuantity = computed(() => {
  if (!plan.value || !dispatchCount.value) return 0
  return Math.max(1, Math.round(plan.value.quantity / dispatchCount.value))
})

function dispatch() {
  dispatchCount.value = isRoadMode(plan.value.mode) ? Math.min(10, Math.max(1, Math.round(plan.value.quantity / 35))) : 1
  vehicleSource.value = 'auto'
  selectedVehicles.value = []
  dispatchVisible.value = true
}

function confirmDispatch() {
  if (isRoad.value && vehicleSource.value === 'manual' && selectedVehicles.value.length < dispatchCount.value) {
    ElMessage.warning(`请至少选择 ${dispatchCount.value} 辆车`)
    return
  }
  const contract = find.contract(plan.value.contractId)
  const check = creditCheck(contract?.shipperId, plan.value.quantity * (plan.value.unitPrice || 0))
  if (!check.ok) {
    ElMessageBox.alert(check.message, '信用校验未通过', { type: 'warning', confirmButtonText: '知道了' })
    return
  }
  const { created, error } = createDispatches(
    plan.value,
    dispatchCount.value,
    vehicleSource.value === 'manual' ? selectedVehicles.value : []
  )
  dispatchVisible.value = false
  if (error) {
    ElMessage.warning(error)
    return
  }
  ElMessage.success(`已生成 ${created.length} 张调度单`)
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

.dispatch-dialog__tip {
  margin-left: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
