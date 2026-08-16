<template>
  <div class="page">
    <PageHeader title="合同管理" desc="运输合同的签约、审批、执行与归档全流程管理">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
      <el-button type="primary" :icon="Plus" @click="$router.push('/contract/create')">
        新建合同
      </el-button>
    </PageHeader>

    <!-- 状态统计 -->
    <el-tabs v-model="activeTab" class="contract-tabs">
      <el-tab-pane label="合同列表" name="contract">
        <div class="stat-row">
          <div
            v-for="s in statItems"
            :key="s.key"
            class="stat-chip"
            :class="{ active: filter.status === s.key }"
            :style="{ '--chip-color': s.color }"
            @click="filter.status = filter.status === s.key ? '' : s.key; page = 1"
          >
            <span class="stat-chip__num num">{{ s.count }}</span>
            <span class="stat-chip__label">{{ s.label }}</span>
          </div>
        </div>

        <!-- 筛选 + 表格 -->
        <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input
              v-model="filter.keyword"
              placeholder="合同编号 / 名称 / 客户"
              :prefix-icon="Search"
              clearable
              style="width: 220px"
            />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.status" placeholder="合同状态" clearable>
              <el-option v-for="(v, k) in statusMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.mode" placeholder="运输方式" clearable>
              <el-option v-for="m in modes" :key="m" :label="m" :value="m" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-date-picker
              v-model="filter.dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="签约开始"
              end-placeholder="签约结束"
              value-format="YYYY-MM-DD"
            />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe style="width: 100%" @row-click="goDetail">
          <el-table-column prop="id" label="合同编号" width="110" fixed>
            <template #default="{ row }">
              <span class="link" @click.stop="goDetail(row)">{{ row.id }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="合同名称" min-width="240" show-overflow-tooltip />
          <el-table-column label="发货方" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ find.customer(row.shipperId)?.name }}</template>
          </el-table-column>
          <el-table-column label="收货方" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ find.customer(row.consigneeId)?.name }}</template>
          </el-table-column>
          <el-table-column label="商品" width="90" align="center">
            <template #default="{ row }">{{ find.commodity(row.commodityId)?.name }}</template>
          </el-table-column>
          <el-table-column prop="mode" label="方式" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ row.mode }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="数量(吨)" width="100" align="right">
            <template #default="{ row }">{{ formatNum(row.quantity) }}</template>
          </el-table-column>
          <el-table-column label="单价(元/吨)" width="105" align="right">
            <template #default="{ row }">{{ row.unitPrice }}</template>
          </el-table-column>
          <el-table-column label="合同金额" width="130" align="right">
            <template #default="{ row }">
              <span class="num amount">{{ formatMoney(row.amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="执行进度" width="130">
            <template #default="{ row }">
              <el-progress
                :percentage="row.progress"
                :stroke-width="6"
                :color="progressColor(row.status)"
              />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="250" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <el-button
                v-if="row.status === 'pending' && can('contract-approve')"
                link type="success" size="small"
                @click.stop="openApprove(row)"
              >审批</el-button>
              <template v-if="row.status === 'executing' && can('contract')">
                <el-button link type="warning" size="small" @click.stop="openChange(row)">变更</el-button>
                <el-button link type="primary" size="small" @click.stop="openExtend(row)">延期</el-button>
                <el-button v-if="canCompleteRow(row)" link type="success" size="small" @click.stop="complete(row)">完结</el-button>
                <el-button link type="danger" size="small" @click.stop="openTerminate(row)">终止</el-button>
              </template>
              <el-button
                v-if="row.status === 'completed' && can('contract')"
                link type="info" size="small"
                @click.stop="archive(row)"
              >归档</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="filtered.length"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next, jumper"
            background
          />
        </div>
      </div>
      </div>
      </el-tab-pane>

      <!-- 运输需求（客户门户发起 → 转合同草稿） -->
      <el-tab-pane :label="'运输需求（待处理 ' + pendingRequestCount + '）'" name="request">
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">客户运输需求</span>
            <el-tag size="small" type="info" effect="plain">共 {{ requestRows.length }} 条</el-tag>
          </div>
          <div class="panel__body">
            <el-table :data="requestRows" stripe>
              <el-table-column prop="id" label="需求编号" width="100" fixed />
              <el-table-column label="客户" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">{{ find.customer(row.customerId)?.name }}</template>
              </el-table-column>
              <el-table-column label="商品" width="90" align="center">
                <template #default="{ row }">{{ find.commodity(row.commodityId)?.name }}</template>
              </el-table-column>
              <el-table-column label="数量(吨)" width="100" align="right">
                <template #default="{ row }">{{ formatNum(row.quantity) }}</template>
              </el-table-column>
              <el-table-column label="线路" min-width="200" show-overflow-tooltip>
                <template #default="{ row }">
                  {{ find.terminal(row.loadTerminalId)?.name }} → {{ find.terminal(row.unloadTerminalId)?.name }}
                </template>
              </el-table-column>
              <el-table-column prop="mode" label="方式" width="90" align="center" />
              <el-table-column label="期望单价" width="100" align="right">
                <template #default="{ row }">{{ row.unitPrice ? row.unitPrice + ' 元/吨' : '—' }}</template>
              </el-table-column>
              <el-table-column prop="expectDate" label="期望开始" width="110" />
              <el-table-column prop="createTime" label="提交时间" width="140" />
              <el-table-column label="状态" width="100" align="center">
                <template #default="{ row }">
                  <StatusTag :status="row.status" :map="requestStatusMap" />
                </template>
              </el-table-column>
              <el-table-column v-if="can('contract')" label="操作" width="170" align="center" fixed="right">
                <template #default="{ row }">
                  <template v-if="row.status === 'pending'">
                    <el-button link type="primary" size="small" @click="openConvert(row)">生成合同草稿</el-button>
                    <el-button link type="danger" size="small" @click="openReject(row)">驳回</el-button>
                  </template>
                  <el-button
                    v-else-if="row.status === 'converted'"
                    link type="primary" size="small"
                    @click="goDetail(find.contract(row.contractId))"
                  >查看合同</el-button>
                  <span v-else class="text-muted" :title="row.rejectReason">已驳回</span>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-if="!requestRows.length" description="暂无运输需求" :image-size="60" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 合同审批（通过 / 驳回） -->
    <el-dialog v-model="approveDialog" title="合同审批" width="480px">
      <div v-if="approveTarget">
        <el-descriptions :column="1" border size="small" style="margin-bottom: 16px">
          <el-descriptions-item label="合同编号">{{ approveTarget.id }}</el-descriptions-item>
          <el-descriptions-item label="合同名称">{{ approveTarget.name }}</el-descriptions-item>
          <el-descriptions-item label="金额">{{ formatMoney(approveTarget.amount) }}</el-descriptions-item>
          <el-descriptions-item label="当前层级">
            {{ approveStep ? approveStep.name + '（第 ' + approveStep.level + '/' + (approveTarget.approvalChain?.length || 2) + ' 级）' : '—' }}
          </el-descriptions-item>
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
      <div v-if="changeTarget">
        <el-alert :title="'合同 ' + changeTarget.id + '（' + changeTarget.name + '）'" type="info" :closable="false" show-icon />
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
      <div v-if="extendTarget">
        <el-alert :title="'合同 ' + extendTarget.id + '，当前截止 ' + extendTarget.endDate" type="info" :closable="false" show-icon />
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
      <div v-if="terminateTarget">
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

    <!-- 需求转合同草稿 -->
    <el-dialog v-model="convertDialog" title="需求转合同草稿" width="480px">
      <div v-if="convertTarget">
        <el-descriptions :column="1" border size="small" style="margin-bottom: 16px">
          <el-descriptions-item label="需求编号">{{ convertTarget.id }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{ find.customer(convertTarget.customerId)?.name }}</el-descriptions-item>
          <el-descriptions-item label="线路">
            {{ find.terminal(convertTarget.loadTerminalId)?.name }} → {{ find.terminal(convertTarget.unloadTerminalId)?.name }}
          </el-descriptions-item>
          <el-descriptions-item label="商品/方式">
            {{ find.commodity(convertTarget.commodityId)?.name }} · {{ convertTarget.mode }}
          </el-descriptions-item>
        </el-descriptions>
        <el-form label-width="100px">
          <el-form-item label="合同数量(吨)">
            <el-input-number v-model="convertForm.quantity" :min="1" :step="35" style="width: 100%" />
          </el-form-item>
          <el-form-item label="合同单价">
            <el-input-number v-model="convertForm.unitPrice" :min="0" :step="1" :precision="1" style="width: 100%" />
          </el-form-item>
          <el-form-item label="结算账期">
            <el-select v-model="convertForm.paymentDays" style="width: 100%">
              <el-option v-for="d in [30, 45, 60, 90]" :key="d" :label="d + ' 天'" :value="d" />
            </el-select>
          </el-form-item>
          <el-form-item label="截止日期">
            <el-date-picker v-model="convertForm.endDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-form>
        <div class="convert-tip">生成后为"草稿"合同，可在合同列表提交审批（部门审批 → 公司审批）。</div>
      </div>
      <template #footer>
        <el-button @click="convertDialog = false">取消</el-button>
        <el-button type="primary" @click="doConvert">确认生成</el-button>
      </template>
    </el-dialog>

    <!-- 驳回运输需求 -->
    <el-dialog v-model="rejectDialog" title="驳回运输需求" width="440px">
      <div v-if="rejectTarget">
        <el-alert :title="'需求 ' + rejectTarget.id + '（' + (find.customer(rejectTarget.customerId)?.name || '') + '）'" type="warning" :closable="false" show-icon />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="驳回原因" required>
            <el-input v-model="rejectReason" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="请填写驳回原因（将展示给客户）" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="danger" @click="doRejectRequest">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'Contract' })
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import {
  approveContract,
  rejectContract,
  changeContract,
  extendContract,
  completeContract,
  terminateContract,
  archiveContract,
  convertRequestToContract,
  rejectTransportRequest
} from '@/mock/flow'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()

const router = useRouter()

const activeTab = ref('contract')

const statusMap = {
  draft: { label: '草稿', type: 'info' },
  pending: { label: '待审批', type: 'warning' },
  executing: { label: '执行中', type: 'primary' },
  completed: { label: '已完成', type: 'success' },
  terminated: { label: '已终止', type: 'danger' },
  archived: { label: '已归档', type: 'info' }
}
const modes = ['公路', '铁路', '水运', '多式联运', '管道']

const filter = reactive({ keyword: '', status: '', mode: '', dateRange: [] })
const page = ref(1)
const pageSize = ref(10)

const statItems = computed(() => {
  const count = (s) => db.contracts.filter((c) => c.status === s).length
  return [
    { key: '', label: '全部合同', count: db.contracts.length, color: tokens.primary },
    { key: 'pending', label: '待审批', count: count('pending'), color: tokens.warning },
    { key: 'executing', label: '执行中', count: count('executing'), color: tokens.success },
    { key: 'completed', label: '已完成', count: count('completed'), color: tokens.info },
    { key: 'terminated', label: '已终止', count: count('terminated'), color: tokens.danger },
    { key: 'archived', label: '已归档', count: count('archived'), color: tokens.neutral300 }
  ]
})

const filtered = computed(() => {
  return db.contracts.filter((c) => {
    if (filter.status && c.status !== filter.status) return false
    if (filter.mode && c.mode !== filter.mode) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      const hit =
        c.id.toLowerCase().includes(kw) ||
        c.name.toLowerCase().includes(kw) ||
        (find.customer(c.shipperId)?.name || '').includes(filter.keyword) ||
        (find.customer(c.consigneeId)?.name || '').includes(filter.keyword)
      if (!hit) return false
    }
    if (filter.dateRange && filter.dateRange.length === 2) {
      if (c.signDate < filter.dateRange[0] || c.signDate > filter.dateRange[1]) return false
    }
    return true
  })
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

function resetFilter() {
  filter.keyword = ''
  filter.status = ''
  filter.mode = ''
  filter.dateRange = []
  page.value = 1
}

function goDetail(row) {
  router.push(`/contract/${row.id}`)
}

function progressColor(status) {
  return { executing: tokens.primary, completed: tokens.success, terminated: tokens.danger }[status] || tokens.neutral300
}

/* ===== 运输需求（客户门户发起 → 转合同草稿 / 驳回） ===== */
const requestStatusMap = {
  pending: { label: '待处理', type: 'warning' },
  converted: { label: '已转合同', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' }
}
const requestRows = computed(() =>
  [...db.transportRequests].sort((a, b) => (a.createTime < b.createTime ? 1 : -1))
)
const pendingRequestCount = computed(() => db.transportRequests.filter((r) => r.status === 'pending').length)

const convertDialog = ref(false)
const convertTarget = ref(null)
const convertForm = reactive({ quantity: 0, unitPrice: 0, paymentDays: 30, endDate: '' })

function openConvert(row) {
  convertTarget.value = row
  convertForm.quantity = row.quantity
  convertForm.unitPrice = row.unitPrice || 0
  convertForm.paymentDays = 30
  convertForm.endDate = dayjs().add(180, 'day').format('YYYY-MM-DD')
  convertDialog.value = true
}

function doConvert() {
  if (!convertForm.quantity || convertForm.quantity <= 0) {
    ElMessage.warning('合同数量须大于 0')
    return
  }
  const c = convertRequestToContract(convertTarget.value, {
    quantity: convertForm.quantity,
    unitPrice: convertForm.unitPrice,
    paymentDays: convertForm.paymentDays,
    endDate: convertForm.endDate
  })
  if (c && c.error) {
    ElMessage.error(c.error)
    return
  }
  convertDialog.value = false
  ElMessage.success(`运输需求已转为合同草稿 ${c.id}，可提交审批`)
}

const rejectDialog = ref(false)
const rejectTarget = ref(null)
const rejectReason = ref('')

function openReject(row) {
  rejectTarget.value = row
  rejectReason.value = ''
  rejectDialog.value = true
}

function doRejectRequest() {
  if (!rejectReason.value.trim()) {
    ElMessage.warning('请填写驳回原因')
    return
  }
  const r = rejectTransportRequest(rejectTarget.value, rejectReason.value.trim())
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  rejectDialog.value = false
  ElMessage.success(`需求 ${rejectTarget.value.id} 已驳回`)
}

/* ===== 审批（通过 / 驳回） ===== */
const approveDialog = ref(false)
const approveTarget = ref(null)
const approveComment = ref('')

function openApprove(row) {
  approveTarget.value = row
  approveComment.value = ''
  approveDialog.value = true
}

/** 当前待审批层级（多级审批链） */
const approveStep = computed(() => approveTarget.value?.approvalChain?.find((s) => s.status === 'pending'))

function doApprove() {
  const r = approveContract(approveTarget.value, approveComment.value.trim())
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  approveDialog.value = false
  ElMessage.success(
    r.final
      ? `合同 ${approveTarget.value.id} 全级审批通过，已进入执行`
      : `合同 ${approveTarget.value.id} ${r.step}通过，进入下一级审批`
  )
}

function doReject() {
  if (!approveComment.value.trim()) {
    ElMessage.warning('驳回必须填写审批意见（原因）')
    return
  }
  const r = rejectContract(approveTarget.value, approveComment.value.trim())
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  approveDialog.value = false
  ElMessage.success(`合同 ${approveTarget.value.id} ${r.step}驳回，回到草稿（重新提交后重走审批链）`)
}

/* ===== 合同完结（手动关单：计划全部完成后可用） ===== */
function canCompleteRow(row) {
  return row.status === 'executing' && !db.plans.some((p) => p.contractId === row.id && p.status !== 'cancelled' && p.status !== 'completed')
}

function complete(row) {
  ElMessageBox.confirm(
    `确认完结合同 ${row.id}？完结后合同转为"已完成"（进度置 100%），可继续归档。`,
    '合同完结',
    { type: 'warning', confirmButtonText: '确认完结' }
  )
    .then(() => {
      const r = completeContract(row)
      if (r && r.error) {
        ElMessage.error(r.error)
        return
      }
      ElMessage.success('合同已完结')
    })
    .catch(() => {})
}

/* ===== 合同变更 ===== */
const changeDialog = ref(false)
const changeTarget = ref(null)
const changeForm = reactive({ quantity: 0, unitPrice: 0, endDate: '', reason: '' })

function openChange(row) {
  changeTarget.value = row
  changeForm.quantity = row.quantity
  changeForm.unitPrice = row.unitPrice
  changeForm.endDate = row.endDate
  changeForm.reason = ''
  changeDialog.value = true
}

function doChange() {
  if (!changeForm.reason.trim()) {
    ElMessage.warning('请填写变更原因')
    return
  }
  const { changed } = changeContract(
    changeTarget.value,
    { quantity: changeForm.quantity, unitPrice: changeForm.unitPrice, endDate: changeForm.endDate },
    changeForm.reason.trim()
  )
  changeDialog.value = false
  if (!changed) {
    ElMessage.info('合同要素未发生变化')
    return
  }
  ElMessage.success(`合同 ${changeTarget.value.id} 变更成功，金额已重算`)
}

/* ===== 合同延期 ===== */
const extendDialog = ref(false)
const extendTarget = ref(null)
const extendForm = reactive({ newDate: '', reason: '' })

function openExtend(row) {
  extendTarget.value = row
  extendForm.newDate = ''
  extendForm.reason = ''
  extendDialog.value = true
}

function doExtend() {
  if (!extendForm.newDate) {
    ElMessage.warning('请选择延期截止日期')
    return
  }
  if (extendForm.newDate <= extendTarget.value.endDate) {
    ElMessage.warning('延期日期必须晚于当前截止日期')
    return
  }
  if (!extendForm.reason.trim()) {
    ElMessage.warning('请填写延期原因')
    return
  }
  extendContract(extendTarget.value, extendForm.newDate, extendForm.reason.trim())
  extendDialog.value = false
  ElMessage.success(`合同 ${extendTarget.value.id} 已延期至 ${extendForm.newDate}`)
}

/* ===== 提前终止 ===== */
const terminateDialog = ref(false)
const terminateTarget = ref(null)
const terminateForm = reactive({ reason: '', settleNow: true })

function openTerminate(row) {
  terminateTarget.value = row
  terminateForm.reason = ''
  terminateForm.settleNow = true
  terminateDialog.value = true
}

function doTerminate() {
  if (!terminateForm.reason.trim()) {
    ElMessage.warning('请填写终止原因')
    return
  }
  const billNo = terminateContract(terminateTarget.value, terminateForm.reason.trim(), terminateForm.settleNow)
  terminateDialog.value = false
  ElMessage.success(billNo ? `合同已终止，已完成车次生成提前结算单 ${billNo}` : '合同已终止')
}

/* ===== 归档 ===== */
function archive(row) {
  ElMessageBox.confirm(`确认归档合同 ${row.id}？归档后为只读存档。`, '合同归档', { type: 'info' }).then(() => {
    archiveContract(row)
    ElMessage.success(`合同 ${row.id} 已归档`)
  }).catch(() => {})
}

function exportCsv() {
  const headers = ['合同编号', '合同名称', '发货方', '收货方', '商品', '运输方式', '数量(吨)', '单价(元/吨)', '金额(元)', '状态']
  const rows = filtered.value.map((c) => [
    c.id,
    c.name,
    find.customer(c.shipperId)?.name || '',
    find.customer(c.consigneeId)?.name || '',
    find.commodity(c.commodityId)?.name || '',
    c.mode,
    c.quantity,
    c.unitPrice,
    c.amount,
    statusMap[c.status].label
  ])
  const csv =
    '﻿' +
    [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `合同列表_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条合同`)
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
}

.stat-chip {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 14px 18px;
  display: flex;
  align-items: baseline;
  gap: 10px;
  cursor: pointer;
  border: 1px solid transparent;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
  transition: all 0.2s;
}

.stat-chip:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(16, 24, 40, 0.08);
}

.stat-chip.active {
  border-color: var(--chip-color);
  background: color-mix(in srgb, var(--chip-color) 5%, var(--bg-card));
}

.stat-chip__num {
  font-size: 22px;
  font-weight: 700;
  color: var(--chip-color);
}

.stat-chip__label {
  font-size: 13px;
  color: var(--text-secondary);
}

.link {
  color: var(--color-primary);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}

.amount {
  font-weight: 600;
  color: var(--text-primary);
}

.contract-tabs :deep(.el-tab-pane) {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.text-muted {
  color: var(--text-secondary);
}

.convert-tip {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
