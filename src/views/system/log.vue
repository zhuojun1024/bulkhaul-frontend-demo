<template>
  <div class="page">
    <PageHeader title="操作日志" desc="平台关键操作审计日志，支持按模块、用户、结果检索">
      <el-button :icon="Download" @click="exportCsv">导出</el-button>
    </PageHeader>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="操作人 / 操作内容" :prefix-icon="Search" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.module" placeholder="功能模块" clearable>
              <el-option v-for="m in modules" :key="m" :label="m" :value="m" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.result" placeholder="结果" clearable style="width: 120px">
              <el-option label="成功" value="success" />
              <el-option label="失败" value="fail" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-date-picker v-model="filter.dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" value-format="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe size="small">
          <el-table-column prop="time" label="操作时间" width="160" fixed />
          <el-table-column label="操作人" width="160">
            <template #default="{ row }">
              <span>{{ row.user }}</span>
              <span class="log-username">@{{ row.username }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="action" label="操作内容" min-width="140" />
          <el-table-column label="详情" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.detail">{{ row.detail }}</span>
              <span v-else class="log-empty">—</span>
            </template>
          </el-table-column>
          <el-table-column label="模块" width="110" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ row.module }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="ip" label="IP 地址" width="140" />
          <el-table-column label="结果" width="80" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.result === 'success' ? 'success' : 'danger'" effect="light">
                {{ row.result === 'success' ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="filtered.length"
            :page-sizes="[20, 50, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            background
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'SysLog' })
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Download, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { db } from '@/mock'
import dayjs from 'dayjs'


const filter = reactive({ keyword: '', module: '', result: '', dateRange: [] })
const page = ref(1)
const pageSize = ref(20)

const modules = computed(() => [...new Set(db.logs.map((l) => l.module))])

const filtered = computed(() =>
  db.logs.filter((l) => {
    if (filter.module && l.module !== filter.module) return false
    if (filter.result && l.result !== filter.result) return false
    if (filter.keyword) {
      if (!l.user.includes(filter.keyword) && !l.action.includes(filter.keyword)) return false
    }
    if (filter.dateRange && filter.dateRange.length === 2) {
      const day = l.time.slice(0, 10)
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
  filter.module = ''
  filter.result = ''
  filter.dateRange = []
  page.value = 1
}

function exportCsv() {
  const headers = ['操作时间', '操作人', '账号', '操作内容', '模块', 'IP', '结果']
  const rows = filtered.value.map((l) => [
    l.time, l.user, l.username, l.action, l.module, l.ip, l.result === 'success' ? '成功' : '失败'
  ])
  const csv = '﻿' + [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `操作日志_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条日志`)
}
</script>

<style scoped>
.log-username {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 4px;
}

.log-empty {
  color: var(--text-secondary);
}
</style>
