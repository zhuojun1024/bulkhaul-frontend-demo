<template>
  <div class="page">
    <PageHeader title="客户管理" desc="发货方 / 收货方客户档案、信用等级与业务往来">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
    </PageHeader>

    <div class="stat-row">
      <div
        v-for="s in statItems"
        :key="s.key"
        class="stat-chip"
        :class="{ active: filter.level === s.key }"
        :style="{ '--chip-color': s.color }"
        @click="filter.level = filter.level === s.key ? '' : s.key; page = 1"
      >
        <span class="stat-chip__num num">{{ s.count }}</span>
        <span class="stat-chip__label">{{ s.label }}</span>
      </div>
    </div>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="客户名称 / 联系人" :prefix-icon="Search" clearable style="width: 220px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.type" placeholder="客户类型" clearable>
              <el-option label="发货方" value="shipper" />
              <el-option label="收货方" value="consignee" />
              <el-option label="双向客户" value="both" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.region" placeholder="区域" clearable>
              <el-option v-for="r in regions" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe @row-click="goDetail">
          <el-table-column label="客户名称" min-width="200" fixed show-overflow-tooltip>
            <template #default="{ row }">
              <div class="customer-cell">
                <div class="customer-cell__logo">{{ row.name.charAt(0) }}</div>
                <div>
                  <div class="customer-cell__name link" @click.stop="goDetail(row)">{{ row.name }}</div>
                  <div class="customer-cell__region">{{ row.region }}</div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="100" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="typeTag(row.type)" effect="plain">{{ typeMap[row.type] }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="等级" width="80" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="levelTag(row.level)" effect="dark">{{ row.level }} 级</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="contact" label="联系人" width="90" align="center" />
          <el-table-column prop="phone" label="电话" width="130" />
          <el-table-column label="累计业务额" width="130" align="right">
            <template #default="{ row }">
              <span class="num amount">{{ formatMoney(row.totalBusiness) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="授信额度" width="120" align="right">
            <template #default="{ row }">{{ formatMoney(row.creditLimit) }}</template>
          </el-table-column>
          <el-table-column prop="joinDate" label="合作起始" width="110" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="goDetail(row)">详情</el-button>
              <el-button
                v-if="can('customer')"
                :link="true"
                :type="row.status === 'active' ? 'danger' : 'success'"
                size="small"
                @click.stop="toggleStatus(row)"
              >{{ row.status === 'active' ? '冻结' : '解冻' }}</el-button>
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
  </div>
</template>

<script setup>
defineOptions({ name: 'Customer' })
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
import { logAction } from '@/mock/flow'
import { formatMoney } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()

const router = useRouter()

const typeMap = { shipper: '发货方', consignee: '收货方', both: '双向客户' }
const statusMap = {
  active: { label: '正常', type: 'success' },
  frozen: { label: '已冻结', type: 'danger' }
}

const filter = reactive({ keyword: '', type: '', region: '', level: '' })
const page = ref(1)
const pageSize = ref(10)

const regions = computed(() => [...new Set(db.customers.map((c) => c.region))])

const statItems = computed(() => {
  const count = (l) => db.customers.filter((c) => c.level === l).length
  return [
    { key: '', label: '全部客户', count: db.customers.length, color: tokens.primary },
    { key: 'A', label: 'A 级战略客户', count: count('A'), color: tokens.danger },
    { key: 'B', label: 'B 级重点客户', count: count('B'), color: tokens.warning },
    { key: 'C', label: 'C 级普通客户', count: count('C'), color: tokens.info }
  ]
})

const filtered = computed(() =>
  db.customers.filter((c) => {
    if (filter.type && c.type !== filter.type) return false
    if (filter.region && c.region !== filter.region) return false
    if (filter.level && c.level !== filter.level) return false
    if (filter.keyword) {
      if (!c.name.includes(filter.keyword) && !c.contact.includes(filter.keyword)) return false
    }
    return true
  })
)

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

function resetFilter() {
  filter.keyword = ''
  filter.type = ''
  filter.region = ''
  filter.level = ''
  page.value = 1
}

function goDetail(row) {
  router.push(`/customer/${row.id}`)
}

function typeTag(type) {
  return { shipper: 'primary', consignee: 'success', both: 'warning' }[type] || 'info'
}

function levelTag(level) {
  return { A: 'danger', B: 'warning', C: 'info' }[level] || 'info'
}

function toggleStatus(row) {
  if (row.status === 'active') {
    ElMessageBox.confirm(`确认冻结客户 ${row.name}？冻结后不可新建合同。`, '冻结客户', { type: 'warning' }).then(() => {
      row.status = 'frozen'
      logAction('客户管理', '客户冻结', `客户 ${row.name} 冻结，不可新建合同`)
      ElMessage.success('客户已冻结')
    }).catch(() => {})
  } else {
    row.status = 'active'
    logAction('客户管理', '客户解冻', `客户 ${row.name} 解冻，恢复合作`)
    ElMessage.success('客户已解冻')
  }
}

function exportCsv() {
  const headers = ['客户名称', '类型', '等级', '区域', '联系人', '电话', '累计业务额(元)', '授信额度(元)', '合作起始', '状态']
  const rows = filtered.value.map((c) => [
    c.name, typeMap[c.type], c.level, c.region, c.contact, c.phone, c.totalBusiness, c.creditLimit, c.joinDate, statusMap[c.status].label
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `客户列表_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条客户`)
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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

.customer-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.customer-cell__logo {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-400));
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 600;
  flex-shrink: 0;
}

.customer-cell__name {
  font-weight: 600;
}

.customer-cell__region {
  font-size: 12px;
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
}
</style>
