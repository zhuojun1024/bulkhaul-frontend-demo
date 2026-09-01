<template>
  <div class="page">
    <div class="panel vehicle-detail__header">
      <div class="vehicle-detail__head">
        <el-button :icon="ArrowLeft" circle @click="$router.back()" />
        <div class="vehicle-detail__icon">
          <el-icon :size="30" color="var(--color-primary)"><Van /></el-icon>
        </div>
        <div>
          <div class="vehicle-detail__name">
            {{ vehicle?.plate }}
            <StatusTag v-if="vehicle" :status="vehicle.status" :map="statusMap" />
          </div>
          <div class="vehicle-detail__meta">
            {{ vehicle?.type }} · 核定载重 {{ vehicle?.capacity }} 吨 · {{ vehicle?.owner }}运力
          </div>
        </div>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="14">
        <div class="panel">
          <div class="panel__header"><span class="panel__title">车辆信息</span></div>
          <div class="panel__body">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="车辆ID">{{ vehicle?.id }}</el-descriptions-item>
              <el-descriptions-item label="燃料类型">{{ vehicle?.fuelType }}</el-descriptions-item>
              <el-descriptions-item label="购置日期">{{ vehicle?.purchaseDate }}</el-descriptions-item>
              <el-descriptions-item label="下次年检">
                <span :class="{ 'text-danger': isSoon(vehicle?.nextInspection) }">{{ vehicle?.nextInspection }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="累计里程">
                <span class="num">{{ formatNum(vehicle?.mileage) }} km</span>
              </el-descriptions-item>
              <el-descriptions-item label="月均成本">
                <span class="num">{{ vehicle?.monthlyCost ? formatMoney(vehicle.monthlyCost) : '—' }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="备注" :span="2">{{ vehicle?.remark || '—' }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </div>

        <div class="panel">
          <div class="panel__header"><span class="panel__title">安全检查记录</span></div>
          <div class="panel__body">
            <el-table :data="inspections" size="small" stripe>
              <el-table-column prop="date" label="检查日期" width="120" />
              <el-table-column prop="item" label="检查项目" min-width="160" />
              <el-table-column label="结果" width="90" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.result === 'pass' ? 'success' : 'danger'" effect="light">
                    {{ row.result === 'pass' ? '合格' : '不合格' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="inspector" label="检查人" width="90" />
              <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
            </el-table>
            <el-empty v-if="!inspections.length" description="暂无检查记录" :image-size="60" />
          </div>
        </div>
      </el-col>

      <el-col :span="10">
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">运输任务记录</span>
            <el-tag size="small" type="info" effect="plain">共 {{ dispatches.length }} 单</el-tag>
          </div>
          <div class="panel__body">
            <el-table :data="dispatches" size="small" stripe max-height="480">
              <el-table-column prop="id" label="调度单号" width="105" />
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
defineOptions({ name: 'VehicleDetail' })
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { api } from '@/api'
import { isProduction } from '@/mode'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'

const route = useRoute()

/* ===== Phase 4 灰度：生产模式（薄客户端）——车辆详情读后端 /api/coll/vehicles/{id} + inspections + dispatches ===== */
const PROD = isProduction()
const vehicleRec = ref(null)
async function loadDetail() {
  if (!PROD) return
  const r = await api('GET', '/coll/vehicles/' + route.params.id)
  vehicleRec.value = r.ok ? r.data : null
}
const vehicle = computed(() => (PROD && vehicleRec.value ? vehicleRec.value : find.vehicle(route.params.id)))
const inspections = computed(() => db.inspections.filter((i) => i.vehicleId === vehicle.value?.id))
const dispatches = computed(() => db.dispatches.filter((d) => d.vehicleId === vehicle.value?.id))
onMounted(loadDetail)
watch(() => route.params.id, loadDetail)

const statusMap = {
  inuse: { label: '运输中', type: 'primary' },
  idle: { label: '空闲', type: 'success' },
  maintenance: { label: '维修中', type: 'warning' },
  overload: { label: '超载预警', type: 'danger' },
  scrapped: { label: '已报废', type: 'info' }
}
const dispatchStatusMap = {
  pending: { label: '待装货', type: 'info' },
  loading: { label: '装货中', type: 'warning' },
  intransit: { label: '在途', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  exception: { label: '异常', type: 'danger' }
}

function isSoon(date) {
  return date && dayjs(date).isBefore(dayjs().add(30, 'day'))
}
</script>

<style scoped>
.vehicle-detail__header {
  padding: 16px 20px;
}

.vehicle-detail__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.vehicle-detail__icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: var(--color-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
}

.vehicle-detail__name {
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
}

.vehicle-detail__meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.text-danger {
  color: var(--color-danger);
  font-weight: 600;
}
</style>
