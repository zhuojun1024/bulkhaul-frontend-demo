<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="760px"
    @update:model-value="$emit('update:modelValue', $event)"
    @open="reset"
  >
    <el-alert type="info" :closable="false" style="margin-bottom: 12px">
      支持 .xlsx / .xls / .csv 文件（Excel 可直接另存为 CSV）。请先下载模板按列填写，必填列缺失的行将被拦截，与现有数据重复的行自动跳过。
    </el-alert>

    <div class="import-dialog__bar">
      <el-button size="small" :icon="Download" @click="downloadTemplate">下载模板</el-button>
      <el-button size="small" type="primary" :icon="Upload" @click="fileRef?.click()">选择文件</el-button>
      <span v-if="fileName" class="import-dialog__file">{{ fileName }}（{{ rows.length }} 行）</span>
      <input ref="fileRef" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onFileChange" />
    </div>

    <el-table v-if="rows.length" :data="preview" stripe size="small" max-height="300">
      <el-table-column type="index" label="#" width="50" />
      <el-table-column v-for="col in columns" :key="col.key" :label="col.label" min-width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ row[col.key] ?? '' }}</template>
      </el-table-column>
      <el-table-column label="校验" width="130" align="center">
        <template #default="{ row }">
          <el-tag v-if="rowError(row)" size="small" type="danger">{{ rowError(row) }}</el-tag>
          <el-tag v-else size="small" type="success">通过</el-tag>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-else description="请选择 Excel / CSV 文件" :image-size="60" />

    <div v-if="result" style="margin-top: 12px">
      <el-alert :title="resultText" :type="result.errors.length ? 'warning' : 'success'" :closable="false" show-icon />
    </div>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <el-button type="primary" :disabled="!validRows.length || !!result" @click="confirm">
        确认导入{{ validRows.length ? `（${validRows.length} 行）` : '' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
defineOptions({ name: 'ImportDialog' })
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Upload } from '@element-plus/icons-vue'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '数据导入' },
  /** 列定义：key 对应 flow 导入函数字段，label 为 Excel 表头（模板与表头映射共用） */
  columns: { type: Array, required: true },
  /** 模板示例行（一行） */
  sample: { type: Array, default: () => [] },
  /** 导入结果（页面调用 flow 导入函数后回传展示） */
  result: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'confirm'])

const fileRef = ref()
const fileName = ref('')
const rows = ref([])

const preview = computed(() => rows.value.slice(0, 50))
const rowError = (row) => {
  const missing = props.columns.filter((c) => c.required && !String(row[c.key] ?? '').trim())
  return missing.length ? `缺：${missing.map((c) => c.label).join('/')}` : ''
}
const validRows = computed(() => rows.value.filter((r) => !rowError(r)))
const resultText = computed(() => {
  if (!props.result) return ''
  const { created, skipped, errors } = props.result
  return `已导入 ${created.length} 条；跳过重复 ${skipped.length} 条${errors.length ? `；${errors.length} 行校验失败（如：${errors[0].reason}）` : ''}`
})

function reset() {
  fileName.value = ''
  rows.value = []
  if (fileRef.value) fileRef.value.value = ''
}

/** 模板下载（xlsx：表头 + 示例行） */
function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([props.columns.map((c) => c.label), ...props.sample])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '导入模板')
  XLSX.writeFile(wb, `${props.title.replace('导入', '')}导入模板_${dayjs().format('YYYYMMDD')}.xlsx`)
}

/** 文件解析：首行表头按列 label 映射到 key，空行忽略 */
async function onFileChange(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (!aoa.length) throw new Error('empty')
    const headers = aoa[0].map((h) => String(h).trim())
    const keyByLabel = Object.fromEntries(props.columns.map((c) => [c.label, c.key]))
    rows.value = aoa
      .slice(1)
      .filter((r) => r.some((v) => String(v).trim() !== ''))
      .map((r) => {
        const obj = {}
        headers.forEach((h, i) => {
          const key = keyByLabel[h]
          if (key) obj[key] = r[i]
        })
        return obj
      })
    fileName.value = file.name
    if (!rows.value.length) ElMessage.warning('文件中未找到数据行（首行为表头）')
  } catch (err) {
    ElMessage.error('文件解析失败，请确认为有效的 Excel / CSV 文件')
  }
}

function confirm() {
  emit('confirm', validRows.value)
}
</script>

<style scoped>
.import-dialog__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.import-dialog__file {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
