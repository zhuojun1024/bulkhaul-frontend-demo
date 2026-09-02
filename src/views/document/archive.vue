<template>
  <div class="page">
    <PageHeader title="单证归档" desc="调度单 / 磅单 / 质检报告 / 签收单 / 对账单 / 发票电子单证统一归档，支持预览、下载，单据级审计追溯">
      <el-button :icon="Download" @click="exportAll">批量导出</el-button>
    </PageHeader>

    <div class="stat-row">
      <StatCard title="调度单" :value="countOf('dispatch')" unit="张" icon="Tickets" color="var(--color-primary)" />
      <StatCard title="磅单" :value="countOf('weighing')" unit="张" icon="ScaleToOriginal" color="var(--color-primary)" />
      <StatCard title="质检报告" :value="countOf('quality')" unit="份" icon="DataAnalysis" color="var(--color-warning)" />
      <StatCard title="签收单" :value="countOf('receipt')" unit="份" icon="DocumentChecked" color="var(--color-success)" />
      <StatCard title="对账单" :value="countOf('reconciliation')" unit="份" icon="Document" color="var(--color-success)" />
      <StatCard title="发票" :value="countOf('invoice')" unit="张" icon="Postcard" color="var(--color-warning)" />
      <StatCard title="单证合计" :value="docs.length" unit="项" icon="Files" color="var(--color-danger)" :sub="'当前筛选 ' + filtered.length + ' 项'" />
    </div>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-select v-model="filter.type" placeholder="单证类型" clearable style="width: 130px">
              <el-option v-for="t in DOC_TYPES" :key="t.key" :label="t.label" :value="t.key" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="单证号 / 调度单号 / 车牌 / 发票号" :prefix-icon="Search" clearable style="width: 260px" />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe>
          <el-table-column label="类型" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="typeTag(row.type)" effect="light">{{ row.typeName }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="id" label="单证编号" width="150" />
          <el-table-column prop="refId" label="关联单号" width="130" />
          <el-table-column prop="summary" label="摘要" min-width="220" show-overflow-tooltip />
          <el-table-column prop="date" label="日期" width="160" />
          <ActionColumn width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="preview(row)">预览</el-button>
              <el-button link type="primary" @click="download(row)">下载</el-button>
            </template>
          </ActionColumn>
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

    <!-- 单证预览 -->
    <el-dialog v-model="previewVisible" :title="previewDoc ? previewDoc.title : '单证预览'" width="760px" top="6vh">
      <iframe v-if="previewHtml" :srcdoc="previewHtml" class="doc-preview" title="单证预览" />
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Download" @click="download(previewDoc)">下载</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'DocumentArchive' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Refresh, Download } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import { listDocuments, documentContent, DOC_TYPES } from '@/data/document'
import dayjs from 'dayjs'

const docs = computed(() => listDocuments())
const countOf = (type) => docs.value.filter((d) => d.type === type).length

const filter = reactive({ keyword: '', type: '' })
const page = ref(1)
const pageSize = ref(20)

const filtered = computed(() =>
  docs.value.filter((d) => {
    if (filter.type && d.type !== filter.type) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      const hay = `${d.id} ${d.refId} ${d.summary} ${d.title}`.toLowerCase()
      if (!hay.includes(kw)) return false
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
  page.value = 1
}

function typeTag(type) {
  return { dispatch: 'primary', weighing: 'primary', quality: 'warning', receipt: 'success', reconciliation: 'success', invoice: 'warning' }[type] || 'info'
}

/* ===== 预览 / 下载（服务层生成 HTML，视图负责浏览器 Blob 下载） ===== */
const previewVisible = ref(false)
const previewDoc = ref(null)
const previewHtml = ref('')

function preview(doc) {
  previewDoc.value = doc
  previewHtml.value = documentContent(doc)
  previewVisible.value = true
}

function download(doc) {
  if (!doc) return
  triggerDownload(new Blob([documentContent(doc)], { type: 'text/html;charset=utf-8' }), `${doc.typeName}_${doc.id}.html`)
  ElMessage.success(`已下载 ${doc.title}`)
}

function exportAll() {
  if (!filtered.value.length) {
    ElMessage.warning('当前筛选无单证可导出')
    return
  }
  const sections = filtered.value.map((d) => documentContent(d)).join('\n<!-- next -->\n')
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8" /><title>单证归档批量导出</title></head><body>${sections}</body></html>`
  triggerDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), `单证归档_${dayjs().format('YYYYMMDD_HHmm')}.html`)
  ElMessage.success(`已导出 ${filtered.value.length} 项单证`)
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.doc-preview {
  width: 100%;
  height: 60vh;
  border: 1px solid var(--color-neutral-200);
  border-radius: 6px;
  background: #fff;
}
</style>
