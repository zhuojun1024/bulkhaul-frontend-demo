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
          <el-button v-if="contract?.status === 'pending' && can('contract-approve')" type="success" :icon="Check" @click="openApprove">
            审批
          </el-button>
          <template v-if="contract?.status === 'executing' && can('contract')">
            <el-button type="warning" plain :icon="EditPen" @click="openChange">变更</el-button>
            <el-button type="primary" plain :icon="Calendar" @click="openExtend">延期</el-button>
            <el-button type="danger" plain :icon="CircleClose" @click="openTerminate">终止合同</el-button>
          </template>
          <el-button v-if="contract?.status === 'completed' && can('contract')" type="info" plain :icon="FolderChecked" @click="archive">
            归档
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
              <el-table-column label="车辆/单元" width="130">
                <template #default="{ row }">{{ find.vehicle(row.vehicleId)?.plate || row.unitNo || '—' }}</template>
              </el-table-column>
              <el-table-column label="司机" width="90">
                <template #default="{ row }">{{ find.driver(row.driverId)?.name || '—' }}</template>
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

      <!-- 变更记录 -->
      <el-tab-pane label="变更记录" name="changes">
        <div class="panel">
          <div class="panel__body">
            <el-table :data="changes" stripe size="small">
              <el-table-column prop="time" label="变更时间" width="160" />
              <el-table-column prop="operator" label="操作人" width="100" align="center" />
              <el-table-column prop="reason" label="原因" min-width="160" show-overflow-tooltip />
              <el-table-column prop="content" label="变更内容" min-width="220" show-overflow-tooltip />
            </el-table>
            <el-empty v-if="!changes.length" description="暂无变更记录" :image-size="80" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 合同审批（通过 / 驳回） -->
    <el-dialog v-model="approveDialog" title="合同审批" width="480px">
      <div v-if="contract">
        <el-descriptions :column="1" border size="small" style="margin-bottom: 16px">
          <el-descriptions-item label="合同编号">{{ contract.id }}</el-descriptions-item>
          <el-descriptions-item label="合同名称">{{ contract.name }}</el-descriptions-item>
          <el-descriptions-item label="金额">{{ formatMoney(contract.amount) }}</el-descriptions-item>
        </el-descriptions>
        <el-form label-width="80px">
          <el-form-item label="审批意见">
            <el-input
              v-model="approveComment"
              type="textarea"
              :rows="3"
              placeholder="通过可留空（默认“同意”）；驳回必须填写原因"
              maxlength="200"
              show-word-limit
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="approveDialog = false">取消</el-button>
        <el-button type="danger" plain @click="doReject">驳回</el-button>
        <el-button type="success" @click="doApprove">通过</el-button>
      </template>
    </el-dialog>

    <!-- 合同变更 -->
    <el-dialog v-model="changeDialog" title="合同变更" width="480px">
      <div v-if="contract">
        <el-alert :title="'合同 ' + contract.id + '（' + contract.name + '）'" type="info" :closable="false" show-icon />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="合同数量">
            <el-input-number v-model="changeForm.quantity" :min="0" :step="100" style="width: 100%" />
          </el-form-item>
          <el-form-item label="合同单价">
            <el-input-number v-model="changeForm.unitPrice" :min="0" :step="1" style="width: 100%" />
          </el-form-item>
          <el-form-item label="截止日期">
            <el-date-picker v-model="changeForm.endDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
          <el-form-item label="变更原因" required>
            <el-input v-model="changeForm.reason" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="请填写变更原因" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="changeDialog = false">取消</el-button>
        <el-button type="primary" @click="doChange">确认变更</el-button>
      </template>
    </el-dialog>

    <!-- 合同延期 -->
    <el-dialog v-model="extendDialog" title="合同延期" width="440px">
      <div v-if="contract">
        <el-alert :title="'合同 ' + contract.id + '，当前截止 ' + contract.endDate" type="info" :closable="false" show-icon />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="延期至" required>
            <el-date-picker v-model="extendForm.newDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
          <el-form-item label="延期原因" required>
            <el-input v-model="extendForm.reason" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="请填写延期原因" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="extendDialog = false">取消</el-button>
        <el-button type="primary" @click="doExtend">确认延期</el-button>
      </template>
    </el-dialog>

    <!-- 提前终止 -->
    <el-dialog v-model="terminateDialog" title="提前终止合同" width="480px">
      <div v-if="contract">
        <el-alert
          title="终止后合同不可再新建计划与下发调度单；待执行计划批次将一并取消，已调度/在途车次继续完成运输并正常结算"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-form label-width="110px" style="margin-top: 16px">
          <el-form-item label="终止原因" required>
            <el-input v-model="terminateForm.reason" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="请填写终止原因" />
          </el-form-item>
          <el-form-item label="提前结算">
            <el-checkbox v-model="terminateForm.settleNow">对已完成车次生成提前结算单</el-checkbox>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="terminateDialog = false">取消</el-button>
        <el-button type="danger" @click="doTerminate">确认终止</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'ContractDetail' })
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Check, CircleClose, Printer, EditPen, Calendar, FolderChecked } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import {
  approveContract,
  rejectContract,
  changeContract,
  extendContract,
  terminateContract,
  archiveContract
} from '@/mock/flow'
import { formatMoney, formatNum } from '@/utils'
import { usePerm } from '@/permission'

const { can } = usePerm()
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
  terminated: { label: '已终止', type: 'danger' },
  archived: { label: '已归档', type: 'info' }
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

const changes = computed(() => contract.value?.changes || [])

/* ===== 审批（通过 / 驳回，与列表页同一弹窗口径） ===== */
const approveDialog = ref(false)
const approveComment = ref('')

function openApprove() {
  approveComment.value = ''
  approveDialog.value = true
}

function doApprove() {
  approveContract(contract.value, approveComment.value.trim())
  approveDialog.value = false
  ElMessage.success(`合同 ${contract.value.id} 审批通过，已进入执行状态`)
}

function doReject() {
  if (!approveComment.value.trim()) {
    ElMessage.warning('驳回必须填写审批意见（原因）')
    return
  }
  rejectContract(contract.value, approveComment.value.trim())
  approveDialog.value = false
  ElMessage.success(`合同 ${contract.value.id} 已驳回，回到草稿`)
}

/* ===== 合同变更 ===== */
const changeDialog = ref(false)
const changeForm = reactive({ quantity: 0, unitPrice: 0, endDate: '', reason: '' })

function openChange() {
  changeForm.quantity = contract.value.quantity
  changeForm.unitPrice = contract.value.unitPrice
  changeForm.endDate = contract.value.endDate
  changeForm.reason = ''
  changeDialog.value = true
}

function doChange() {
  if (!changeForm.reason.trim()) {
    ElMessage.warning('请填写变更原因')
    return
  }
  const { changed } = changeContract(
    contract.value,
    { quantity: changeForm.quantity, unitPrice: changeForm.unitPrice, endDate: changeForm.endDate },
    changeForm.reason.trim()
  )
  changeDialog.value = false
  if (!changed) {
    ElMessage.info('合同要素未发生变化')
    return
  }
  ElMessage.success('合同变更成功，金额已重算')
}

/* ===== 合同延期 ===== */
const extendDialog = ref(false)
const extendForm = reactive({ newDate: '', reason: '' })

function openExtend() {
  extendForm.newDate = ''
  extendForm.reason = ''
  extendDialog.value = true
}

function doExtend() {
  if (!extendForm.newDate) {
    ElMessage.warning('请选择延期截止日期')
    return
  }
  if (extendForm.newDate <= contract.value.endDate) {
    ElMessage.warning('延期日期必须晚于当前截止日期')
    return
  }
  if (!extendForm.reason.trim()) {
    ElMessage.warning('请填写延期原因')
    return
  }
  extendContract(contract.value, extendForm.newDate, extendForm.reason.trim())
  extendDialog.value = false
  ElMessage.success(`合同已延期至 ${extendForm.newDate}`)
}

/* ===== 提前终止 ===== */
const terminateDialog = ref(false)
const terminateForm = reactive({ reason: '', settleNow: true })

function openTerminate() {
  terminateForm.reason = ''
  terminateForm.settleNow = true
  terminateDialog.value = true
}

function doTerminate() {
  if (!terminateForm.reason.trim()) {
    ElMessage.warning('请填写终止原因')
    return
  }
  const billNo = terminateContract(contract.value, terminateForm.reason.trim(), terminateForm.settleNow)
  terminateDialog.value = false
  ElMessage.success(billNo ? `合同已终止，已完成车次生成提前结算单 ${billNo}` : '合同已终止')
}

/* ===== 归档 ===== */
function archive() {
  ElMessageBox.confirm('确认归档该合同？归档后为只读存档。', '合同归档', { type: 'info' }).then(() => {
    archiveContract(contract.value)
    ElMessage.success('合同已归档')
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
