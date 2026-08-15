<template>
  <div class="page" v-loading="loading">
    <PageHeader title="磅单记录" desc="进出磅称重记录，自动关联调度单，支持导出对账">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
    </PageHeader>

    <div class="stat-row">
      <StatCard title="今日过磅" :value="todayCount" unit="车次" icon="ScaleToOriginal" color="var(--color-primary)" :sub="'净重合计 ' + formatNum(todayNet) + ' 吨'" />
      <StatCard title="本月过磅" :value="monthCount" unit="车次" icon="Tickets" color="var(--color-success)" :trend="6.4" trend-label="较上月" />
      <StatCard title="平均损耗率" :value="lossRate" unit="%" icon="TrendCharts" color="var(--color-warning)" :sub="'出磅净重 vs 进磅净重'" />
      <StatCard title="异常磅单" :value="abnormalCount" unit="张" icon="Warning" color="var(--color-danger)" :sub="'净重偏差超 5%'" />
    </div>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="磅单号 / 调度单号 / 车牌" :prefix-icon="Search" clearable style="width: 220px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.type" placeholder="磅单类型" clearable style="width: 120px">
              <el-option label="进磅" value="进磅" />
              <el-option label="出磅" value="出磅" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.terminalId" placeholder="场站" clearable>
              <el-option v-for="t in db.terminals" :key="t.id" :label="t.name" :value="t.id" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-date-picker v-model="filter.dateRange" type="daterange" range-separator="至" start-placeholder="过磅开始" end-placeholder="过磅结束" value-format="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe>
          <el-table-column prop="id" label="磅单号" width="110" fixed>
            <template #default="{ row }">
              <span class="link" @click="goDispatch(row)">{{ row.id }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="dispatchId" label="调度单号" width="110" />
          <el-table-column prop="plate" label="车牌号" width="120" />
          <el-table-column label="场站" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ find.terminal(row.terminalId)?.name }}</template>
          </el-table-column>
          <el-table-column label="类型" width="80" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.type === '进磅' ? 'primary' : 'success'" effect="light">
                {{ row.type }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="毛重(t)" width="95" align="right">
            <template #default="{ row }">{{ row.gross }}</template>
          </el-table-column>
          <el-table-column label="皮重(t)" width="95" align="right">
            <template #default="{ row }">{{ row.tare }}</template>
          </el-table-column>
          <el-table-column label="净重(t)" width="95" align="right">
            <template #default="{ row }">
              <span class="num net-weight">{{ row.net }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="time" label="过磅时间" width="150" />
          <el-table-column prop="operator" label="操作员" width="90" align="center" />
        </el-table>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="filtered.length"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            background
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'Weighing' })
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import { db, find } from '@/mock'
import { formatNum } from '@/utils'
import dayjs from 'dayjs'

const router = useRouter()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 300))

const filter = reactive({ keyword: '', type: '', terminalId: '', dateRange: [] })
const page = ref(1)
const pageSize = ref(20)

const filtered = computed(() =>
  db.weighings.filter((w) => {
    if (filter.type && w.type !== filter.type) return false
    if (filter.terminalId && w.terminalId !== filter.terminalId) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      if (!w.id.toLowerCase().includes(kw) && !w.dispatchId.toLowerCase().includes(kw) && !w.plate.toLowerCase().includes(kw)) return false
    }
    if (filter.dateRange && filter.dateRange.length === 2) {
      const day = w.time.slice(0, 10)
      if (day < filter.dateRange[0] || day > filter.dateRange[1]) return false
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
  filter.terminalId = ''
  filter.dateRange = []
  page.value = 1
}

function goDispatch(row) {
  router.push(`/dispatch/${row.dispatchId}`)
}

/* ===== 统计 ===== */
const todayCount = computed(() =>
  db.weighings.filter((w) => w.time.slice(0, 10) === dayjs().format('YYYY-MM-DD')).length
)
const todayNet = computed(() =>
  db.weighings
    .filter((w) => w.time.slice(0, 10) === dayjs().format('YYYY-MM-DD'))
    .reduce((s, w) => s + w.net, 0)
)
const monthCount = computed(() =>
  db.weighings.filter((w) => w.time.slice(0, 7) === dayjs().format('YYYY-MM')).length
)

/** 损耗率：按调度单配对进出磅 */
const lossRate = computed(() => {
  const pairs = []
  const byDispatch = {}
  for (const w of db.weighings) {
    if (!byDispatch[w.dispatchId]) byDispatch[w.dispatchId] = {}
    byDispatch[w.dispatchId][w.type] = w
  }
  for (const d of Object.values(byDispatch)) {
    if (d['进磅'] && d['出磅']) pairs.push(d['进磅'].net - d['出磅'].net)
  }
  if (!pairs.length) return 0
  const totalIn = db.weighings.filter((w) => w.type === '进磅').reduce((s, w) => s + w.net, 0)
  const totalLoss = pairs.reduce((s, v) => s + v, 0)
  return totalIn ? Math.round((totalLoss / totalIn) * 1000) / 10 : 0
})

const abnormalCount = computed(() => {
  const byDispatch = {}
  for (const w of db.weighings) {
    if (!byDispatch[w.dispatchId]) byDispatch[w.dispatchId] = {}
    byDispatch[w.dispatchId][w.type] = w
  }
  let count = 0
  for (const d of Object.values(byDispatch)) {
    if (d['进磅'] && d['出磅'] && d['进磅'].net > 0) {
      const loss = (d['进磅'].net - d['出磅'].net) / d['进磅'].net
      if (loss > 0.05) count += 1
    }
  }
  return count
})

function exportCsv() {
  const headers = ['磅单号', '调度单号', '车牌号', '场站', '类型', '毛重(t)', '皮重(t)', '净重(t)', '过磅时间', '操作员']
  const rows = filtered.value.map((w) => [
    w.id, w.dispatchId, w.plate, find.terminal(w.terminalId)?.name || '', w.type, w.gross, w.tare, w.net, w.time, w.operator
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `磅单记录_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 张磅单`)
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.link {
  color: var(--color-primary);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}

.net-weight {
  font-weight: 700;
  color: var(--color-primary);
}
</style>
