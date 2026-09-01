<template>
  <div class="page">
    <PageHeader title="异常处理" desc="运输过程异常的受理、处置与闭环管理" />

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

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="异常单号 / 调度单号" :prefix-icon="Search" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.type" placeholder="异常类型" clearable>
              <el-option v-for="(v, k) in typeMap" :key="k" :label="v" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.level" placeholder="级别" clearable>
              <el-option v-for="(v, k) in levelMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-date-picker v-model="filter.dateRange" type="daterange" range-separator="至" start-placeholder="发生开始" end-placeholder="发生结束" value-format="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe @row-click="openDrawer">
          <el-table-column prop="id" label="异常单号" width="110" fixed>
            <template #default="{ row }">
              <span class="link" @click.stop="openDrawer(row)">{{ row.id }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="dispatchId" label="关联调度单" width="110" />
          <el-table-column label="类型" width="120" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ typeMap[row.type] }}</el-tag>
              <el-tag v-if="row.source === 'fence'" size="small" type="warning" effect="light" style="margin-left: 4px">围栏</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="级别" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="levelMap[row.level].type" effect="dark">{{ levelMap[row.level].label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="description" label="异常描述" min-width="200" show-overflow-tooltip />
          <el-table-column prop="occurTime" label="发生时间" width="150" />
          <el-table-column label="处理人" width="90" align="center">
            <template #default="{ row }">{{ row.handler || '—' }}</template>
          </el-table-column>
          <el-table-column label="损失(元)" width="100" align="right">
            <template #default="{ row }">{{ row.cost ? formatNum(row.cost) : '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="130" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="statusMap" />
              <el-tag
                v-if="row.escalated > 0 && row.status === 'pending'"
                size="small"
                :type="row.escalated >= 2 ? 'danger' : 'warning'"
                effect="dark"
                style="margin-top: 4px"
              >{{ row.escalated >= 2 ? '升级督办' : '已升级' }}</el-tag>
            </template>
          </el-table-column>
          <ActionColumn width="130" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="openDrawer(row)">处理</el-button>
              <el-button
                v-if="row.status !== 'closed' && can('exception')"
                link type="success" size="small"
                @click.stop="closeException(row)"
              >关闭</el-button>
            </template>
          </ActionColumn>
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

    <!-- 处理抽屉 -->
    <el-drawer v-model="drawerVisible" :title="'异常处理 - ' + (current?.id || '')" size="480px">
      <div v-if="current" class="ex-drawer">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="关联调度单">
            <span class="link" @click="$router.push(`/dispatch/${current.dispatchId}`)">{{ current.dispatchId }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="发生时间">{{ current.occurTime }}</el-descriptions-item>
          <el-descriptions-item label="异常类型">{{ typeMap[current.type] }}</el-descriptions-item>
          <el-descriptions-item label="级别">
            <el-tag size="small" :type="levelMap[current.level].type" effect="dark">{{ levelMap[current.level].label }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="异常描述" :span="2">{{ current.description }}</el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="current.escalated > 0 && current.status === 'pending'"
          :title="'该异常单待受理超时，已升级至 ' + current.escalatedTo + '（' + current.escalateTime + '）'"
          :type="current.escalated >= 2 ? 'error' : 'warning'"
          :closable="false"
          show-icon
          style="margin-top: 12px"
        />

        <div class="desc-title">处理流程</div>
        <el-steps direction="vertical" :active="stepActive">
          <el-step title="异常上报" :description="current.occurTime" />
          <el-step title="受理指派" :description="current.handler ? `处理人：${current.handler}` : '待指派'" />
          <el-step title="处置完成" :description="current.result || '待处置'" />
          <el-step title="闭环归档" :description="current.status === 'closed' ? '已归档' : ''" />
        </el-steps>

        <div class="desc-title">处置操作</div>
        <el-form label-width="80px">
          <el-form-item label="处理人">
            <el-input v-model="handleForm.handler" placeholder="请输入处理人" :disabled="current.status === 'closed'" />
          </el-form-item>
          <el-form-item label="处理结果">
            <el-input v-model="handleForm.result" type="textarea" :rows="3" placeholder="处置措施与结果" :disabled="current.status === 'closed'" />
          </el-form-item>
          <el-form-item label="损失金额">
            <el-input-number v-model="handleForm.cost" :min="0" :step="1000" style="width: 100%" :disabled="current.status === 'closed'" />
          </el-form-item>
        </el-form>

        <div class="ex-drawer__footer">
          <el-button
            v-if="current.status === 'pending' && can('exception')"
            type="warning"
            @click="accept"
          >受理</el-button>
          <el-button
            v-if="current.status === 'handling' && can('exception')"
            type="success"
            @click="finish"
          >处置完成</el-button>
          <el-button
            v-if="current.status !== 'closed' && can('exception')"
            type="primary"
            @click="closeException(current)"
          >关闭归档</el-button>
          <el-button
            v-if="relatedDispatch?.status === 'exception' && can('exception')"
            type="success"
            plain
            @click="resume"
          >恢复运输</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
defineOptions({ name: 'Exception' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
import { resumeDispatch, acceptException, finishException, closeException as flowCloseException } from '@/mock/flow'
import { useCollection } from '@/composables/useCollection'
import { isProduction } from '@/mode'
import { api, refreshDb } from '@/api'
import { formatNum } from '@/utils'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()


const typeMap = { delay: '延误', accident: '事故', damage: '货损', quality: '质量', overload: '超载', other: '其他' }
const levelMap = {
  low: { label: '低', type: 'info' },
  medium: { label: '中', type: 'warning' },
  high: { label: '高', type: 'danger' }
}
const statusMap = {
  pending: { label: '待处理', type: 'warning' },
  handling: { label: '处理中', type: 'primary' },
  closed: { label: '已关闭', type: 'success' }
}

const filter = reactive({ keyword: '', type: '', level: '', status: '', dateRange: [] })
const page = ref(1)
const pageSize = ref(10)

/* ===== Phase 4 灰度：生产模式（薄客户端）——异常列表读后端 /api/coll/exceptions ===== */
const PROD = isProduction()
const listCol = useCollection('exceptions', () => ({ key: 'exceptions:list' }))
const rows = computed(() => PROD ? listCol.data.value : db.exceptions)

const statItems = computed(() => {
  const count = (s) => rows.value.filter((e) => e.status === s).length
  return [
    { key: '', label: '全部异常', count: rows.value.length, color: tokens.primary },
    { key: 'pending', label: '待处理', count: count('pending'), color: tokens.warning },
    { key: 'handling', label: '处理中', count: count('handling'), color: tokens.primary },
    { key: 'closed', label: '已关闭', count: count('closed'), color: tokens.success }
  ]
})

const filtered = computed(() =>
  rows.value.filter((e) => {
    if (filter.status && e.status !== filter.status) return false
    if (filter.type && e.type !== filter.type) return false
    if (filter.level && e.level !== filter.level) return false
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase()
      if (!e.id.toLowerCase().includes(kw) && !e.dispatchId.toLowerCase().includes(kw)) return false
    }
    if (filter.dateRange && filter.dateRange.length === 2) {
      const day = e.occurTime.slice(0, 10)
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
  filter.level = ''
  filter.status = ''
  filter.dateRange = []
  page.value = 1
}

if (PROD) {
  onMounted(() => { listCol.refresh() })
  const onRefreshed = () => { listCol.refresh() }
  window.addEventListener('blms:refreshed', onRefreshed)
  onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))
}

/* ===== Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 快照重水合 =====
 * 异常域写联动 dispatches/settlements/accidents/vehicles，统一 refreshDb 拉回权威态。
 * 后端业务错误经 ApiResult.success 包装为 data.error（HTTP 200），须检查 r.data.error。 */
async function prodWrite(path, body, method) {
  const r = await api(method || 'POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return null
  }
  await refreshDb()
  return r.data
}

/* ===== 抽屉 ===== */
const drawerVisible = ref(false)
const current = ref(null)
const handleForm = reactive({ handler: '', result: '', cost: 0 })

function openDrawer(row) {
  current.value = row
  handleForm.handler = row.handler
  handleForm.result = row.result
  handleForm.cost = row.cost
  drawerVisible.value = true
}

const stepActive = computed(() => {
  if (!current.value) return 0
  if (current.value.status === 'pending') return 1
  if (current.value.status === 'handling') return current.value.result ? 3 : 2
  return 4
})

/** 关联调度单（用于判断是否可恢复运输） */
const relatedDispatch = computed(() =>
  current.value ? db.dispatches.find((d) => d.id === current.value.dispatchId) : null
)

async function resume() {
  const d = relatedDispatch.value
  if (!d || d.status !== 'exception') return
  // Phase 4 引擎移除：生产模式写操作 = 后端权威（状态守卫 + RBAC + 审计）
  if (PROD) {
    const r = await prodWrite('/dispatch/' + d.id + '/resume')
    if (!r) return
    ElMessage.success(`调度单 ${d.id} 已恢复运输`)
    return
  }
  const r = resumeDispatch(d)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(`调度单 ${d.id} 已恢复运输`)
}

async function accept() {
  if (!handleForm.handler) {
    ElMessage.warning('请先填写处理人')
    return
  }
  if (PROD) {
    const r = await prodWrite('/exception/' + current.value.id + '/accept', { handler: handleForm.handler })
    if (!r) return
    ElMessage.success(`已受理，处理人：${handleForm.handler}`)
    return
  }
  acceptException(current.value, handleForm.handler)
  ElMessage.success(`已受理，处理人：${handleForm.handler}`)
}

async function finish() {
  if (!handleForm.result) {
    ElMessage.warning('请填写处理结果')
    return
  }
  if (PROD) {
    const r = await prodWrite('/exception/' + current.value.id + '/finish', { result: handleForm.result, cost: handleForm.cost })
    if (!r) return
    ElMessage.success('处置完成，可关闭归档')
    return
  }
  finishException(current.value, handleForm.result, handleForm.cost)
  ElMessage.success('处置完成，可关闭归档')
}

async function closeException(row) {
  if (PROD) {
    const r = await prodWrite('/exception/' + row.id + '/close')
    if (!r) return
    ElMessage.success(`异常单 ${row.id} 已关闭归档`)
    // 联动调度单：若仍处异常状态，询问是否恢复运输
    const d = db.dispatches.find((x) => x.id === row.dispatchId)
    if (d && d.status === 'exception') {
      ElMessageBox.confirm(
        `关联调度单 ${d.id} 仍处于异常状态，是否恢复运输？`,
        '恢复运输',
        { confirmButtonText: '恢复', cancelButtonText: '暂不', type: 'warning' }
      ).then(async () => {
        const rr = await prodWrite('/dispatch/' + d.id + '/resume')
        if (rr) ElMessage.success(`调度单 ${d.id} 已恢复运输`)
      }).catch(() => {})
    }
    return
  }
  flowCloseException(row)
  ElMessage.success(`异常单 ${row.id} 已关闭归档`)
  if (current.value?.id === row.id) {
    handleForm.handler = row.handler
    handleForm.result = row.result
  }
  // 联动调度单：若仍处异常状态，询问是否恢复运输
  const d = db.dispatches.find((x) => x.id === row.dispatchId)
  if (d && d.status === 'exception') {
    ElMessageBox.confirm(
      `关联调度单 ${d.id} 仍处于异常状态，是否恢复运输？`,
      '恢复运输',
      { confirmButtonText: '恢复', cancelButtonText: '暂不', type: 'warning' }
    ).then(() => {
      const r = resumeDispatch(d)
      if (r && r.error) {
        ElMessage.error(r.error)
        return
      }
      ElMessage.success(`调度单 ${d.id} 已恢复运输`)
    }).catch(() => {})
  }
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

.link {
  color: var(--color-primary);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}

.ex-drawer__footer {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>
