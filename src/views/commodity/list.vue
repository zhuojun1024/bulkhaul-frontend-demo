<template>
  <div class="page">
    <PageHeader title="商品管理" desc="大宗商品目录、质量指标与参考运价维护">
      <el-button v-if="can('commodity')" :icon="Upload" @click="openImport">导入</el-button>
      <el-button v-if="can('commodity')" type="primary" :icon="Plus" @click="openDialog()">新建商品</el-button>
    </PageHeader>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="商品名称 / 编号" :prefix-icon="Search" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.category" placeholder="商品类别" clearable>
              <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="filtered" stripe @row-click="openDetail">
          <el-table-column prop="id" label="编号" width="90" />
          <el-table-column prop="name" label="商品名称" width="130">
            <template #default="{ row }">
              <b>{{ row.name }}</b>
            </template>
          </el-table-column>
          <el-table-column label="类别" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="categoryType(row.category)" effect="light">{{ row.category }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="unit" label="单位" width="70" align="center" />
          <el-table-column label="密度(t/m³)" width="100" align="right">
            <template #default="{ row }">{{ row.density }}</template>
          </el-table-column>
          <el-table-column label="参考运价(元/吨)" width="130" align="right">
            <template #default="{ row }">
              <span class="num price">{{ row.price }}</span>
            </template>
          </el-table-column>
          <el-table-column label="质量指标" min-width="260">
            <template #default="{ row }">
              <span v-for="ind in row.indicators" :key="ind.name" class="indicator-chip">
                {{ ind.name }} {{ ind.value }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
            </template>
          </el-table-column>
          <ActionColumn width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="openDetail(row)">指标</el-button>
              <el-button v-if="can('commodity')" link type="primary" size="small" @click.stop="openDialog(row)">编辑</el-button>
              <el-button
                v-if="can('commodity')"
                :link="true"
                :type="row.status === 'active' ? 'danger' : 'success'"
                size="small"
                @click.stop="toggleStatus(row)"
              >{{ row.status === 'active' ? '停用' : '启用' }}</el-button>
            </template>
          </ActionColumn>
        </el-table>
      </div>
    </div>

    <!-- 质量指标详情 -->
    <el-drawer v-model="detailVisible" :title="'质量指标 - ' + (current?.name || '')" size="420px">
      <div v-if="current" class="commodity-detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="商品编号">{{ current.id }}</el-descriptions-item>
          <el-descriptions-item label="类别">{{ current.category }}</el-descriptions-item>
          <el-descriptions-item label="计量单位">{{ current.unit }}</el-descriptions-item>
          <el-descriptions-item label="密度">{{ current.density }} t/m³</el-descriptions-item>
          <el-descriptions-item label="参考运价" :span="2">
            <span class="num price">{{ current.price }} 元/吨</span>
          </el-descriptions-item>
        </el-descriptions>
        <div class="desc-title">关键质量指标</div>
        <el-table :data="current.indicators" size="small" stripe>
          <el-table-column prop="name" label="指标" width="120" />
          <el-table-column prop="value" label="要求" />
        </el-table>
      </div>
    </el-drawer>

    <!-- 新建/编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑商品' : '新建商品'" width="520px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="商品名称" required>
          <el-input v-model="form.name" placeholder="如：动力煤" />
        </el-form-item>
        <el-form-item label="类别" required>
          <el-select v-model="form.category" style="width: 100%">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="计量单位">
          <el-select v-model="form.unit" style="width: 100%">
            <el-option label="吨" value="吨" />
            <el-option label="立方米" value="立方米" />
          </el-select>
        </el-form-item>
        <el-form-item label="密度(t/m³)">
          <el-input-number v-model="form.density" :min="0.1" :max="10" :step="0.1" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="参考运价">
          <el-input-number v-model="form.price" :min="1" :max="10000" :step="10" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 数据导入（Excel/CSV） -->
    <ImportDialog
      v-model="importVisible"
      title="导入商品"
      :columns="importColumns"
      :sample="importSample"
      :result="importResult"
      @confirm="doImport"
    />
  </div>
</template>

<script setup>
defineOptions({ name: 'Commodity' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Plus, Refresh, Upload } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import ImportDialog from '@/components/ImportDialog.vue'
import { db } from '@/mock'
import { useCollection } from '@/composables/useCollection'
import { api } from '@/api'
import { usePerm } from '@/permission'

const { can } = usePerm()

const statusMap = {
  active: { label: '启用', type: 'success' },
  inactive: { label: '停用', type: 'info' }
}

/* ===== Phase 4 灰度：薄客户端——商品列表读后端 /api/coll/commodities =====
 * 数据源后端权威（useCollection 全量取，内存引擎已移除 F3），过滤逻辑与后端一致。 */
const listCol = useCollection('commodities', () => ({ key: 'commodities:list' }))
const rows = computed(() => listCol.data.value)

const categories = computed(() => [...new Set(rows.value.map((c) => c.category))])

const filter = reactive({ keyword: '', category: '' })

const filtered = computed(() =>
  rows.value.filter((c) => {
    if (filter.category && c.category !== filter.category) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      if (!c.name.includes(filter.keyword) && !c.id.toLowerCase().includes(kw)) return false
    }
    return true
  })
)

function resetFilter() {
  filter.keyword = ''
  filter.category = ''
}

onMounted(() => { listCol.refresh() })
const onRefreshed = () => { listCol.refresh() }
window.addEventListener('blms:refreshed', onRefreshed)
onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))

/* ===== Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 列表重取 =====
 * 后端业务错误经 ApiResult.success 包装为 data.error（HTTP 200），须检查 r.data.error。 */
async function prodWrite(path, body) {
  const r = await api('POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return null
  }
  await listCol.refresh()
  return r.data
}

function categoryType(category) {
  return { 煤炭: 'primary', 矿石: 'warning', 粮食: 'success', 化工: 'danger', 建材: 'info', 钢材: 'primary', 能源: 'danger' }[category] || 'info'
}

/* ===== 详情抽屉 ===== */
const detailVisible = ref(false)
const current = ref(null)
function openDetail(row) {
  current.value = row
  detailVisible.value = true
}

/* ===== 新建/编辑 ===== */
const dialogVisible = ref(false)
const editingId = ref('')
const form = reactive({ name: '', category: '煤炭', unit: '吨', density: 1, price: 500 })

function openDialog(row) {
  if (row) {
    editingId.value = row.id
    Object.assign(form, { name: row.name, category: row.category, unit: row.unit, density: row.density, price: row.price })
  } else {
    editingId.value = ''
    Object.assign(form, { name: '', category: '煤炭', unit: '吨', density: 1, price: 500 })
  }
  dialogVisible.value = true
}

async function save() {
  // Phase 4 引擎移除：生产模式写操作 = 后端权威（RBAC + 重名守卫 + 审计）
  const d = await prodWrite('/admin/commodity', { id: editingId.value, ...form })
  if (!d) return
  ElMessage.success(editingId.value ? '商品已更新' : '商品已创建')
  dialogVisible.value = false
}

async function toggleStatus(row) {
  const d = await prodWrite('/admin/commodity/' + row.id + '/toggle')
  if (!d) return
  // 后端 ok(null) 无 status；row 未变异，新状态 = 旧状态取反
  ElMessage.success(`商品 ${row.name} 已${row.status === 'active' ? '停用' : '启用'}`)
}

/* ===== 数据导入（Excel/CSV → 后端 /admin/commodity/import，按名称去重） ===== */
const importVisible = ref(false)
const importResult = ref(null)
const importColumns = [
  { key: 'name', label: '商品名称', required: true },
  { key: 'category', label: '类别' },
  { key: 'unit', label: '单位' },
  { key: 'density', label: '密度(t/m³)' },
  { key: 'price', label: '参考运价(元/吨)' }
]
const importSample = [['焦煤', '煤炭', '吨', 1.3, 620]]

function openImport() {
  importResult.value = null
  importVisible.value = true
}

async function doImport(rows) {
  const r = await api('POST', '/admin/commodity/import', rows)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '导入失败')
    return
  }
  importResult.value = r.data
  await listCol.refresh()
  ElMessage.success(`导入完成：新增 ${(r.data.created || []).length} 条，跳过重复 ${(r.data.skipped || []).length} 条${(r.data.errors || []).length ? `，失败 ${r.data.errors.length} 条` : ''}`)
}
</script>

<style scoped>
.price {
  font-weight: 700;
  color: var(--color-primary);
}

.indicator-chip {
  display: inline-block;
  font-size: 12px;
  color: var(--text-regular);
  background: var(--color-neutral-100);
  border-radius: 4px;
  padding: 2px 8px;
  margin: 2px 4px 2px 0;
}
</style>
