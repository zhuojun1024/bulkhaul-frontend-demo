<template>
  <div class="driver-app">
    <div class="driver-app__frame">
      <!-- 顶部：司机账号登录态（司机账号锁定本人；其他角色为演示切换） -->
      <div class="driver-app__header">
        <div class="driver-app__title">
          <el-icon :size="18"><Van /></el-icon>
          司机端
        </div>
        <template v-if="isDriverUser">
          <span class="driver-app__account">{{ driver?.name }}</span>
          <el-button size="small" :icon="SwitchButton" @click="logout">切换账号</el-button>
        </template>
        <el-select v-else v-model="driverId" size="small" style="width: 170px" placeholder="选择司机（模拟登录）">
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

          <!-- 收入结算（司机分成与成本侧司机项同口径） -->
          <div class="income-card">
            <div class="income-card__head">
              <span>收入结算</span>
              <span class="income-card__total">本月 {{ formatMoney(monthIncome) }} · 累计 {{ formatMoney(totalIncome) }}（{{ myCompleted.length }} 趟）</span>
            </div>
            <div class="income-card__body">
              <div v-for="d in incomeTrips" :key="d.id" class="income-row">
                <span class="income-row__id">{{ d.id }}</span>
                <span>{{ d.unloadTime ? d.unloadTime.slice(5, 10) : '—' }}</span>
                <span>{{ d.quantity }} 吨</span>
                <span class="income-row__amount num">+{{ formatMoney(driverIncomeOf(d)) }}</span>
              </div>
              <el-empty v-if="!myCompleted.length" description="暂无已完成趟次" :image-size="50" />
              <div v-if="myCompleted.length > 5" class="income-more">
                <el-button link type="primary" size="small" @click="showAllIncome = !showAllIncome">
                  {{ showAllIncome ? '收起' : '展开全部 ' + myCompleted.length + ' 趟' }}
                </el-button>
              </div>
            </div>
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
                <el-button size="small" type="warning" :disabled="!d.accepted" @click="openScanLoad(d)">扫码装货</el-button>
              </template>
              <el-button v-if="d.status === 'loading'" size="small" type="primary" @click="onDepart(d)">发车</el-button>
              <el-button v-if="d.status === 'intransit'" size="small" type="success" @click="onArrive(d)">到达卸货场</el-button>
              <el-button v-if="d.status === 'unloading'" size="small" type="success" @click="openSign(d)">确认卸货并签收</el-button>
              <!-- F4a：执行中（待装货/装货/在途/卸货）可上报异常，司机为第一知情人 -->
              <el-button
                v-if="['pending', 'loading', 'intransit', 'unloading'].includes(d.status)"
                size="small"
                type="danger"
                plain
                @click="openException(d)"
              >上报异常</el-button>
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

    <!-- 扫码确认装货 -->
    <el-dialog v-model="scanDialog" title="扫码确认装货" width="420px">
      <div v-if="scanTarget">
        <el-alert :title="`调度单 ${scanTarget.id}：${find.commodity(scanTarget.commodityId)?.name} ${scanTarget.quantity} 吨`" type="info" :closable="false" show-icon />
        <div class="scan-box">
          <div class="scan-box__label">装货场装货码（模拟张贴码）</div>
          <div class="scan-box__code num">{{ loadCodeOf(scanTarget) }}</div>
        </div>
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="扫描结果">
            <el-input v-model="scanCode" placeholder="扫码或输入装货码" clearable />
          </el-form-item>
        </el-form>
        <el-button size="small" :icon="Aim" @click="scanCode = loadCodeOf(scanTarget)">模拟扫码</el-button>
        <div class="sign-tip">装货码张贴于装货场站，扫码核验通过后自动确认装货并登记进磅单。</div>
      </div>
      <template #footer>
        <el-button @click="scanDialog = false">取消</el-button>
        <el-button type="primary" @click="submitScanLoad">确认扫码</el-button>
      </template>
    </el-dialog>

    <!-- 电子签收 -->
    <el-dialog v-model="signDialog" title="电子签收" width="420px">
      <div v-if="signTarget">
        <el-alert :title="`调度单 ${signTarget.id}：${find.commodity(signTarget.commodityId)?.name} ${signTarget.quantity} 吨`" type="info" :closable="false" show-icon />
        <div class="scan-box">
          <div class="scan-box__label">卸货场卸货码（模拟张贴码）</div>
          <div class="scan-box__code num">{{ unloadCodeOf(signTarget) }}</div>
        </div>
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="签收人">
            <el-input v-model="signer" placeholder="收货方签收人姓名" />
          </el-form-item>
          <el-form-item label="扫描结果">
            <el-input v-model="scanCode" placeholder="扫码或输入卸货码" clearable />
          </el-form-item>
          <el-form-item label="签收数量">
            <span class="num">{{ signTarget.quantity }} 吨</span>
          </el-form-item>
        </el-form>
        <el-button size="small" :icon="Aim" @click="scanCode = unloadCodeOf(signTarget)">模拟扫码</el-button>
        <div class="sign-tip">扫卸货码核验通过后确认卸货并生成电子签收单，作为结算与对账的收货凭证。</div>
      </div>
      <template #footer>
        <el-button @click="signDialog = false">取消</el-button>
        <el-button type="primary" @click="submitSign">确认签收</el-button>
      </template>
    </el-dialog>

    <!-- F4a：司机端上报异常（执行中状态，source=driver） -->
    <el-dialog v-model="excDialog" title="上报异常" width="420px">
      <div v-if="excTarget">
        <el-alert
          :title="`调度单 ${excTarget.id}：${find.commodity(excTarget.commodityId)?.name} ${excTarget.quantity} 吨`"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="异常类型" required>
            <el-select v-model="excForm.type" style="width: 100%">
              <el-option label="车辆故障" value="vehicle" />
              <el-option label="交通事故" value="accident" />
              <el-option label="货物损坏" value="damage" />
              <el-option label="道路/天气延误" value="delay" />
              <el-option label="其他" value="other" />
            </el-select>
          </el-form-item>
          <el-form-item label="严重程度" required>
            <el-radio-group v-model="excForm.level">
              <el-radio value="low">轻微</el-radio>
              <el-radio value="medium">一般</el-radio>
              <el-radio value="high">严重</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="异常描述" required>
            <el-input v-model="excForm.description" type="textarea" :rows="3" placeholder="请描述异常情况（位置、现象、影响）" />
          </el-form-item>
        </el-form>
        <div class="sign-tip">上报后车次转入异常状态，由平台异常处理人员受理处置；事故类将同步生成事故记录。</div>
      </div>
      <template #footer>
        <el-button @click="excDialog = false">取消</el-button>
        <el-button type="danger" @click="submitException">提交上报</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'DriverApp' })
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Van, CircleCheck, Aim, SwitchButton } from '@element-plus/icons-vue'
import { db, find } from '@/mock'
import { loadCodeOf, unloadCodeOf, driverIncomeOf } from '@/mock/flow'
import { formatMoney } from '@/utils'
import dayjs from 'dayjs'
import { api, refreshDb } from '@/api'
import { useTokens } from '@/utils/tokens'
import { useUserStore } from '@/store'

const tokens = useTokens()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/** 司机账号登录态（G5）：司机角色锁定本人账号，不可切换；其他角色保留演示切换 */
const isDriverUser = computed(() => userStore.userInfo.role === '司机' && !!userStore.userInfo.driverId)

/** 模拟司机登录：默认取 URL 传入的司机（从调度详情页进入），否则第一个可用司机 */
const driverId = ref(route.query.driverId || '')
const focusId = ref(route.query.focus || '')
const driverOptions = computed(() => db.drivers.filter((d) => d.status !== 'disabled'))

onMounted(() => {
  if (isDriverUser.value) {
    driverId.value = userStore.userInfo.driverId
    return
  }
  if (!driverId.value || !db.drivers.some((d) => d.id === driverId.value)) {
    const first = db.drivers.find((d) => db.dispatches.some((x) => x.driverId === d.id))
    driverId.value = first ? first.id : driverOptions.value[0]?.id || ''
  }
})

/** 司机账号退出（切换账号） */
function logout() {
  userStore.logout()
  router.push('/login')
}

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

/* ===== 收入结算（已完成趟次，司机分成与成本侧司机项同口径） ===== */
const myCompleted = computed(() =>
  db.dispatches
    .filter((d) => d.driverId === driverId.value && d.status === 'completed')
    .sort((a, b) => (a.unloadTime < b.unloadTime ? 1 : -1))
)
const totalIncome = computed(() => myCompleted.value.reduce((s, d) => s + driverIncomeOf(d), 0))
const monthIncome = computed(() =>
  myCompleted.value
    .filter((d) => d.unloadTime && dayjs(d.unloadTime).isSame(dayjs(), 'month'))
    .reduce((s, d) => s + driverIncomeOf(d), 0)
)
const showAllIncome = ref(false)
const incomeTrips = computed(() => (showAllIncome.value ? myCompleted.value : myCompleted.value.slice(0, 5)))

function progressColor(status) {
  return { loading: tokens.warning, intransit: tokens.primary, unloading: tokens.warning, completed: tokens.success, exception: tokens.danger }[status] || tokens.neutral300
}

/* ===== Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 快照重取 =====
 * 本页读 db.dispatches（生产模式由 /api/snapshot hydrate）；写后 refreshDb 更新响应式 db，
 * myDispatches 计算属性自动重渲染。不再依赖 flow.js 乐观改本地态。成功返回 r.data，失败 ElMessage.error 返回 null。 */
async function prodWrite(path, body) {
  const r = await api('POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return null
  }
  await refreshDb()
  return r.data
}

function onAccept(d) {
  prodWrite('/dispatch/' + d.id + '/accept').then((ok) => { if (ok) ElMessage.success('接单成功') })
}

/* ===== 扫码确认装货（装货码核验通过后走 flow.confirmLoad） ===== */
const scanDialog = ref(false)
const scanTarget = ref(null)
const scanCode = ref('')

function openScanLoad(d) {
  scanTarget.value = d
  scanCode.value = ''
  scanDialog.value = true
}

async function submitScanLoad() {
  const d = await prodWrite('/dispatch/' + scanTarget.value.id + '/scan/load', { code: scanCode.value })
  if (!d) return
  scanDialog.value = false
  ElMessage.success('装货确认成功，进磅单已登记')
}
async function onDepart(d) {
  const ok = await prodWrite('/dispatch/' + d.id + '/driver/depart')
  if (ok) ElMessage.success('已发车，进入在途状态')
}
async function onArrive(d) {
  const ok = await prodWrite('/dispatch/' + d.id + '/driver/arrive')
  if (ok) ElMessage.success('已到达卸货场站')
}

/* ===== 电子签收 ===== */
const signDialog = ref(false)
const signTarget = ref(null)
const signer = ref('')

function openSign(d) {
  signTarget.value = d
  const consignee = find.customer(find.contract(d.contractId)?.consigneeId)
  signer.value = consignee?.contact || ''
  scanCode.value = ''
  signDialog.value = true
}

async function submitSign() {
  if (!signer.value.trim()) {
    ElMessage.warning('请填写签收人姓名')
    return
  }
  // 先扫卸货码核验（后端 confirmUnload），再生成电子签收单（后端 signReceipt）
  const u = await prodWrite('/dispatch/' + signTarget.value.id + '/scan/unload', { code: scanCode.value })
  if (!u) return
  const s = await prodWrite('/dispatch/' + signTarget.value.id + '/driver/signReceipt', { signer: signer.value.trim() })
  if (!s) return
  signDialog.value = false
  ElMessage.success('卸货完成，电子签收单已生成')
}

/* ===== 司机端上报异常（执行中状态，后端身份守卫 + 状态机） ===== */
const excDialog = ref(false)
const excTarget = ref(null)
const excForm = reactive({ type: 'other', level: 'medium', description: '' })

function openException(d) {
  excTarget.value = d
  Object.assign(excForm, { type: 'other', level: 'medium', description: '' })
  excDialog.value = true
}

async function submitException() {
  if (!excForm.description.trim()) {
    ElMessage.warning('请填写异常描述')
    return
  }
  const d = await prodWrite('/dispatch/' + excTarget.value.id + '/reportException', { description: excForm.description, type: excForm.type, level: excForm.level })
  if (!d) return
  excDialog.value = false
  ElMessage.success('异常已上报，请等待平台处理')
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

.driver-app__account {
  font-size: 13px;
  font-weight: 600;
  margin-right: 10px;
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

/* 收入结算 */
.income-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
}

.income-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--color-neutral-50);
  font-size: 13px;
  font-weight: 600;
}

.income-card__total {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.income-card__body {
  padding: 2px 12px 6px;
}

.income-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px dashed var(--border-color);
}

.income-row:last-of-type {
  border-bottom: none;
}

.income-row__id {
  font-weight: 600;
  color: var(--text-primary);
  width: 92px;
}

.income-row__amount {
  margin-left: auto;
  font-weight: 600;
  color: var(--color-success);
}

.income-more {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

.sign-tip {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
}

/* 模拟张贴码 */
.scan-box {
  margin-top: 16px;
  padding: 12px;
  background: var(--color-neutral-50);
  border: 1px dashed var(--color-neutral-300);
  border-radius: 8px;
  text-align: center;
}

.scan-box__label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.scan-box__code {
  font-family: Consolas, Menlo, monospace;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 3px;
  color: var(--color-primary);
}
</style>
