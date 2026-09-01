<template>
  <div class="page">
    <div class="panel driver-detail__header">
      <div class="driver-detail__head">
        <el-button :icon="ArrowLeft" circle @click="$router.back()" />
        <div class="driver-detail__avatar">{{ driver?.name?.charAt(0) }}</div>
        <div>
          <div class="driver-detail__name">
            {{ driver?.name }}
            <StatusTag v-if="driver" :status="driver.status" :map="statusMap" />
          </div>
          <div class="driver-detail__meta">
            {{ driver?.phone }} · {{ driver?.licenseType }} 证 · 入职 {{ driver?.joinDate }}
          </div>
        </div>
        <div class="driver-detail__rating">
          <el-rate :model-value="driver?.rating || 0" disabled show-score text-color="var(--color-warning)" score-template="{value} 分" />
        </div>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="10">
        <div class="panel">
          <div class="panel__header"><span class="panel__title">证照信息</span></div>
          <div class="panel__body">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="驾驶证号">{{ driver?.licenseNo }}</el-descriptions-item>
              <el-descriptions-item label="准驾车型">{{ driver?.licenseType }}</el-descriptions-item>
              <el-descriptions-item label="有效期至">
                <span :class="{ 'text-danger': isExpiring(driver?.licenseExpire) }">{{ driver?.licenseExpire }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="紧急联系人">{{ driver?.emergencyContact }}</el-descriptions-item>
              <el-descriptions-item label="累计趟次">
                <span class="num">{{ formatNum(driver?.totalTrips) }} 趟</span>
              </el-descriptions-item>
              <el-descriptions-item label="累计里程">
                <span class="num">{{ formatNum(driver?.totalMileage) }} km</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </div>
      </el-col>

      <el-col :span="14">
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">运输任务记录</span>
            <el-tag size="small" type="info" effect="plain">共 {{ dispatches.length }} 单</el-tag>
          </div>
          <div class="panel__body">
            <el-table :data="dispatches" size="small" stripe max-height="420">
              <el-table-column prop="id" label="调度单号" width="105" />
              <el-table-column label="车牌" width="115">
                <template #default="{ row }">{{ find.vehicle(row.vehicleId)?.plate }}</template>
              </el-table-column>
              <el-table-column label="商品" width="80" align="center">
                <template #default="{ row }">{{ find.commodity(row.commodityId)?.name }}</template>
              </el-table-column>
              <el-table-column label="数量" width="70" align="right">
                <template #default="{ row }">{{ row.quantity }}t</template>
              </el-table-column>
              <el-table-column prop="dispatchTime" label="下发时间" min-width="130" />
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <StatusTag :status="row.status" :map="dispatchStatusMap" />
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-if="!dispatches.length" description="暂无运输任务" :image-size="60" />
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
defineOptions({ name: 'DriverDetail' })
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { api } from '@/api'
import { isProduction } from '@/mode'
import { formatNum } from '@/utils'
import dayjs from 'dayjs'

const route = useRoute()

/* ===== Phase 4 灰度：生产模式（薄客户端）——司机详情读后端 /api/coll/drivers/{id} + dispatches ===== */
const PROD = isProduction()
const driverRec = ref(null)
async function loadDetail() {
  if (!PROD) return
  const r = await api('GET', '/coll/drivers/' + route.params.id)
  driverRec.value = r.ok ? r.data : null
}
const driver = computed(() => (PROD && driverRec.value ? driverRec.value : find.driver(route.params.id)))
const dispatches = computed(() => db.dispatches.filter((d) => d.driverId === driver.value?.id))
onMounted(loadDetail)
watch(() => route.params.id, loadDetail)

const statusMap = {
  onduty: { label: '出勤中', type: 'primary' },
  available: { label: '可派单', type: 'success' },
  rest: { label: '休息中', type: 'info' },
  disabled: { label: '已停用', type: 'danger' }
}
const dispatchStatusMap = {
  pending: { label: '待装货', type: 'info' },
  loading: { label: '装货中', type: 'warning' },
  intransit: { label: '在途', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  exception: { label: '异常', type: 'danger' }
}

function isExpiring(date) {
  return date && dayjs(date).isBefore(dayjs().add(30, 'day'))
}
</script>

<style scoped>
.driver-detail__header {
  padding: 16px 20px;
}

.driver-detail__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.driver-detail__avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-success), var(--color-success-400));
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
}

.driver-detail__name {
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
}

.driver-detail__meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.driver-detail__rating {
  margin-left: auto;
}

.text-danger {
  color: var(--color-danger);
  font-weight: 600;
}
</style>
