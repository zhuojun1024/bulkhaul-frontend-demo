<template>
  <div class="page">
    <PageHeader title="消息中心" desc="平台业务通知（审批/调度/异常/结算/需求），支持已读管理与分类筛选">
      <el-button :icon="CircleCheck" :disabled="!unreadCount" @click="markAll">全部已读</el-button>
    </PageHeader>

    <div class="stat-row">
      <div
        v-for="s in statItems"
        :key="s.key"
        class="stat-chip"
        :class="{ active: filter.tab === s.key }"
        :style="{ '--chip-color': s.color }"
        @click="filter.tab = s.key; page = 1"
      >
        <span class="stat-chip__num num">{{ s.count }}</span>
        <span class="stat-chip__label">{{ s.label }}</span>
      </div>
    </div>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-select v-model="filter.type" placeholder="消息类型" clearable style="width: 160px">
              <el-option v-for="(v, k) in typeMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="搜索标题 / 内容" :prefix-icon="Search" clearable style="width: 220px" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe @row-click="openMessage">
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag v-if="!row.read" size="small" type="danger" effect="light">未读</el-tag>
              <span v-else class="text-muted">已读</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="100" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="typeMap[row.type]?.tag || 'info'" effect="light">{{ typeMap[row.type]?.label || row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <b :class="{ 'text-muted': row.read }">{{ row.title }}</b>
            </template>
          </el-table-column>
          <el-table-column prop="content" label="内容" min-width="260" show-overflow-tooltip />
          <el-table-column prop="time" label="时间" width="150" />
          <el-table-column label="操作" width="130" align="center" fixed="right">
            <template #default="{ row }">
              <el-button v-if="!row.read" link type="primary" size="small" @click.stop="markRead(row)">标为已读</el-button>
              <el-button link type="primary" size="small" @click.stop="openMessage(row)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!filtered.length" description="暂无消息" :image-size="60" />

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
defineOptions({ name: 'MessageCenter' })
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search, CircleCheck } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { db } from '@/mock'
import { markMessageRead, markAllMessagesRead } from '@/mock/flow'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()
const router = useRouter()

const typeMap = {
  approval: { label: '审批', tag: 'primary' },
  dispatch: { label: '调度', tag: 'success' },
  exception: { label: '异常', tag: 'danger' },
  settlement: { label: '结算', tag: 'warning' },
  request: { label: '需求', tag: 'info' },
  system: { label: '系统', tag: 'info' }
}

const filter = reactive({ tab: '', type: '', keyword: '' })
const page = ref(1)
const pageSize = ref(10)

const unreadCount = computed(() => db.messages.filter((m) => !m.read).length)

const statItems = computed(() => [
  { key: '', label: '全部消息', count: db.messages.length, color: tokens.primary },
  { key: 'unread', label: '未读', count: unreadCount.value, color: tokens.danger },
  { key: 'read', label: '已读', count: db.messages.length - unreadCount.value, color: tokens.info }
])

const filtered = computed(() =>
  db.messages.filter((m) => {
    if (filter.tab === 'unread' && m.read) return false
    if (filter.tab === 'read' && !m.read) return false
    if (filter.type && m.type !== filter.type) return false
    if (filter.keyword && !m.title.includes(filter.keyword) && !m.content.includes(filter.keyword)) return false
    return true
  })
)

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

function markRead(row) {
  markMessageRead(row)
}

function markAll() {
  const n = markAllMessagesRead()
  ElMessage.success(`已将 ${n} 条消息标为已读`)
}

/** 查看：标记已读并跳转对应模块 */
function openMessage(row) {
  markMessageRead(row)
  if (row.path) router.push(row.path)
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
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

.text-muted {
  color: var(--text-secondary);
  font-weight: 400;
}
</style>
