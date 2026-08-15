<template>
  <div class="page" v-loading="loading">
    <PageHeader title="合同管理" desc="运输合同的签约、审批、执行与归档全流程管理">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
      <el-button type="primary" :icon="Plus" @click="$router.push('/contract/create')">
        新建合同
      </el-button>
    </PageHeader>

    <!-- 状态统计 -->
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
          <el-table-column label="操作" width="150" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <el-button
                v-if="row.status === 'pending' && can('contract-approve')"
                link type="success" size="small"
                @click.stop="openApprove(row)"
              >审批</el-button>
              <el-button
                v-if="row.status === 'executing' && can('contract')"
                link type="danger" size="small"
                @click.stop="terminate(row)"
              >终止</el-button>
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

    <!-- 合同审批（通过 / 驳回） -->
    <el-dialog v-model="approveDialog" title="合同审批" width="480px">
      <div v-if="approveTarget">
        <el-descriptions :column="1" border size="small" style="margin-bottom: 16px">
          <el-descriptions-item label="合同编号">{{ approveTarget.id }}</el-descriptions-item>
          <el-descriptions-item label="合同名称">{{ approveTarget.name }}</el-descriptions-item>
          <el-descriptions-item label="金额">{{ formatMoney(approveTarget.amount) }}</el-descriptions-item>
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
  </div>
</template>

<script setup>
defineOptions({ name: 'Contract' })
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import { approveContract, rejectContract } from '@/mock/flow'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()

const router = useRouter()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 300))

const statusMap = {
  draft: { label: '草稿', type: 'info' },
  pending: { label: '待审批', type: 'warning' },
  executing: { label: '执行中', type: 'primary' },
  completed: { label: '已完成', type: 'success' },
  terminated: { label: '已终止', type: 'danger' }
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
    { key: 'terminated', label: '已终止', count: count('terminated'), color: tokens.danger }
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

/* ===== 审批（通过 / 驳回） ===== */
const approveDialog = ref(false)
const approveTarget = ref(null)
const approveComment = ref('')

function openApprove(row) {
  approveTarget.value = row
  approveComment.value = ''
  approveDialog.value = true
}

function doApprove() {
  approveContract(approveTarget.value, approveComment.value.trim())
  approveDialog.value = false
  ElMessage.success(`合同 ${approveTarget.value.id} 审批通过`)
}

function doReject() {
  if (!approveComment.value.trim()) {
    ElMessage.warning('驳回必须填写审批意见（原因）')
    return
  }
  rejectContract(approveTarget.value, approveComment.value.trim())
  approveDialog.value = false
  ElMessage.success(`合同 ${approveTarget.value.id} 已驳回，回到草稿`)
}

function terminate(row) {
  ElMessageBox.prompt('请输入终止原因', `终止合同 ${row.id}`, {
    inputPattern: /.{2,}/,
    inputErrorMessage: '原因至少 2 个字符',
    confirmButtonText: '确认终止',
    cancelButtonText: '取消',
    type: 'warning'
  })
    .then(({ value }) => {
      row.status = 'terminated'
      row.remark = `【终止】${value}`
      ElMessage.success('合同已终止')
    })
    .catch(() => {})
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
  grid-template-columns: repeat(5, 1fr);
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
</style>
