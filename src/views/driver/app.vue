<template>
  <div class="driver-app">
    <div class="driver-app__frame">
      <!-- 顶部：模拟司机登录 -->
      <div class="driver-app__header">
        <div class="driver-app__title">
          <el-icon :size="18"><Van /></el-icon>
          司机端
        </div>
        <el-select v-model="driverId" size="small" style="width: 170px" placeholder="选择司机（模拟登录）">
          <el-option v-for="d in driverOptions" :key="d.id" :label="d.name + '（' + d.phone.slice(0, 3) + '****' + d.phone.slice(-4) + '）'" :value="d.id" />
        </el-select>
      </div>

      <div class="driver-app__body">
        <template v-if="driver">
          <div class="driver-app__profile">
            <div class="driver-app__avatar">{{ driver.name.charAt(0) }}</div>
            <div>
              <div class="driver-app__name">{{ driver.name }}</div>
              <div class="driver-app__sub">{{ driver.licenseType }} 证 · 累计 {{ driver.totalTrips }} 趟 · 评分 {{ driver.rating }}</div>
            </div>
            <el-tag size="small" :type="driver.status === 'onduty' ? 'success' : 'info'" effect="light">
              {{ driver.status === 'onduty' ? '执行中' : driver.status === 'available' ? '空闲' : '休息' }}
            </el-tag>
          </div>

          <!-- 任务卡 -->
          <div v-for="d in myDispatches" :key="d.id" class="task-card" :class="{ 'task-card--focus': focusId === d.id }">
            <div class="task-card__head">
              <span class="task-card__id">{{ d.id }}</span>
              <el-tag size="small" :type="statusMap[d.status].type" effect="light">{{ statusMap[d.status].label }}</el-tag>
            </div>
            <div class="task-card__route">
              {{ find.terminal(d.loadTerminalId)?.name }} → {{ find.terminal(d.unloadTerminalId)?.name }}
            </div>
            <div class="task-card__meta">
              <span>{{ find.commodity(d.commodityId)?.name }} {{ d.quantity }} 吨</span>
              <span>{{ d.distance }} km</span>
              <span v-if="d.eta">ETA {{ d.eta.slice(11, 16) }}</span>
            </div>
            <el-progress :percentage="d.progress" :stroke-width="6" :show-text="false" :color="progressColor(d.status)" />

            <!-- 操作区（按状态） -->
            <div class="task-card__actions">
              <template v-if="d.status === 'pending'">
                <el-button size="small" :type="d.accepted ? 'success' : 'primary'" plain :disabled="d.accepted" @click="onAccept(d)">
                  {{ d.accepted ? '已接单' : '接单' }}
                </el-button>
                <el-button size="small" type="warning" :disabled="!d.accepted" @click="onLoad(d)">确认装货</el-button>
              </template>
              <el-button v-if="d.status === 'loading'" size="small" type="primary" @click="onDepart(d)">发车</el-button>
              <el-button v-if="d.status === 'intransit'" size="small" type="success" @click="onArrive(d)">到达卸货场</el-button>
              <el-button v-if="d.status === 'unloading'" size="small" type="success" @click="openSign(d)">确认卸货并签收</el-button>
              <el-button v-if="d.status === 'exception'" size="small" type="danger" plain @click="$router.push(`/dispatch/${d.id}`)">
                异常处理中
              </el-button>
              <template v-if="d.status === 'completed'">
                <div v-if="d.receipt" class="receipt">
                  <el-icon color="var(--color-success)"><CircleCheck /></el-icon>
                  <div>
                    <div>电子签收单 {{ d.receipt.code }}</div>
                    <div class="receipt__sub">签收人 {{ d.receipt.signer }} · {{ d.receipt.time }}</div>
                  </div>
                </div>
                <el-button size="small" text type="primary" @click="$router.push(`/dispatch/${d.id}`)">查看调度单</el-button>
              </template>
            </div>
          </div>

          <el-empty v-if="!myDispatches.length" description="暂无运输任务" :image-size="80" />
        </template>
        <el-empty v-else description="请选择司机" :image-size="80" />
      </div>
    </div>

    <!-- 电子签收 -->
    <el-dialog v-model="signDialog" title="电子签收" width="420px">
      <div v-if="signTarget">
        <el-alert :title="`调度单 ${signTarget.id}：${find.commodity(signTarget.commodityId)?.name} ${signTarget.quantity} 吨`" type="info" :closable="false" show-icon />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="签收人">
            <el-input v-model="signer" placeholder="收货方签收人姓名" />
          </el-form-item>
          <el-form-item label="签收数量">
            <span class="num">{{ signTarget.quantity }} 吨</span>
          </el-form-item>
        </el-form>
        <div class="sign-tip">签收后生成电子签收单，作为结算与对账的收货凭证。</div>
      </div>
      <template #footer>
        <el-button @click="signDialog = false">取消</el-button>
        <el-button type="primary" @click="submitSign">确认签收</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'DriverApp' })
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Van, CircleCheck } from '@element-plus/icons-vue'
import { db, find } from '@/mock'
import {
  acceptDispatch,
  signReceipt,
  confirmLoad as flowConfirmLoad,
  depart as flowDepart,
  arrive as flowArrive,
  confirmUnload as flowConfirmUnload
} from '@/mock/flow'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()
const route = useRoute()

/** 模拟司机登录：默认取 URL 传入的司机（从调度详情页进入），否则第一个可用司机 */
const driverId = ref(route.query.driverId || '')
const focusId = ref(route.query.focus || '')
const driverOptions = computed(() => db.drivers.filter((d) => d.status !== 'disabled'))

onMounted(() => {
  if (!driverId.value || !db.drivers.some((d) => d.id === driverId.value)) {
    const first = db.drivers.find((d) => db.dispatches.some((x) => x.driverId === d.id))
    driverId.value = first ? first.id : driverOptions.value[0]?.id || ''
  }
})

const driver = computed(() => db.drivers.find((d) => d.id === driverId.value))

/** 该司机的调度单（公路口径），执行中的在前 */
const myDispatches = computed(() => {
  const list = db.dispatches.filter((d) => d.driverId === driverId.value)
  const order = { pending: 0, loading: 1, intransit: 2, unloading: 3, exception: 4, completed: 5 }
  return [...list].sort((a, b) => (order[a.status] - order[b.status]) || (a.dispatchTime < b.dispatchTime ? 1 : -1))
})

const statusMap = {
  pending: { label: '待装货', type: 'info' },
  loading: { label: '装货中', type: 'warning' },
  intransit: { label: '在途', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  exception: { label: '异常', type: 'danger' }
}

function progressColor(status) {
  return { loading: tokens.warning, intransit: tokens.primary, unloading: tokens.warning, completed: tokens.success, exception: tokens.danger }[status] || tokens.neutral300
}

/* ===== 操作（调用 flow 中枢，与 PC 端同一套状态机） ===== */
/** 状态机守卫拦截提示（flow 返回 { error } 时） */
function guardError(r) {
  if (r && r.error) {
    ElMessage.error(r.error)
    return true
  }
  return false
}
function onAccept(d) {
  acceptDispatch(d)
  ElMessage.success('接单成功')
}
function onLoad(d) {
  ElMessageBox.confirm(`确认已完成装货（${d.quantity} 吨）？`, '确认装货', { type: 'info' }).then(() => {
    if (guardError(flowConfirmLoad(d))) return
    ElMessage.success('装货确认成功，进磅单已登记')
  }).catch(() => {})
}
function onDepart(d) {
  if (guardError(flowDepart(d))) return
  ElMessage.success('已发车，进入在途状态')
}
function onArrive(d) {
  if (guardError(flowArrive(d))) return
  ElMessage.success('已到达卸货场站')
}

/* ===== 电子签收 ===== */
const signDialog = ref(false)
const signTarget = ref(null)
const signer = ref('')

function openSign(d) {
  signTarget.value = d
  const consignee = find.customer(find.contract(d.contractId)?.consigneeId)
  signer.value = consignee?.contact || ''
  signDialog.value = true
}

function submitSign() {
  if (!signer.value.trim()) {
    ElMessage.warning('请填写签收人姓名')
    return
  }
  if (guardError(flowConfirmUnload(signTarget.value))) return
  signReceipt(signTarget.value, signer.value.trim())
  signDialog.value = false
  ElMessage.success('卸货完成，电子签收单已生成')
}
</script>

<style scoped>
.driver-app {
  min-height: 100%;
  background: var(--bg-page);
  display: flex;
  justify-content: center;
  padding: 24px 16px;
}

.driver-app__frame {
  width: 460px;
  max-width: 100%;
  background: var(--bg-card);
  border-radius: 20px;
  box-shadow: 0 12px 40px rgba(16, 24, 40, 0.12);
  overflow: hidden;
}

.driver-app__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(120deg, var(--color-primary-900), var(--color-primary));
  color: var(--text-inverse);
}

.driver-app__title {
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}

.driver-app__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 70vh;
  overflow-y: auto;
}

.driver-app__profile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-neutral-50);
  border-radius: 10px;
}

.driver-app__avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-400));
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
}

.driver-app__name {
  font-size: 15px;
  font-weight: 600;
}

.driver-app__sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.task-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 12px;
}

.task-card--focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(43, 92, 230, 0.15);
}

.task-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.task-card__id {
  font-weight: 700;
  font-size: 14px;
}

.task-card__route {
  font-size: 13px;
  color: var(--text-primary);
  margin: 8px 0 4px;
}

.task-card__meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.task-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.receipt {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-success);
}

.receipt__sub {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.sign-tip {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
