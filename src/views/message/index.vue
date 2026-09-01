<template>
  <div class="page">
    <PageHeader title="消息中心" desc="平台业务通知（审批/调度/异常/结算/需求），支持已读管理、分类筛选与免打扰设置">
      <el-button :icon="MuteNotification" @click="openDnd">免打扰</el-button>
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
          <el-table-column label="状态" width="110" align="center">
            <template #default="{ row }">
              <el-tag v-if="!row.read" size="small" type="danger" effect="light">未读</el-tag>
              <span v-else class="text-muted">已读</span>
              <el-tag v-if="isMuted(row)" size="small" type="info" effect="plain" style="margin-left: 4px">免打扰</el-tag>
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
          <ActionColumn width="130" fixed="right">
            <template #default="{ row }">
              <el-button v-if="!row.read" link type="primary" size="small" @click.stop="markRead(row)">标为已读</el-button>
              <el-button link type="primary" size="small" @click.stop="openMessage(row)">查看</el-button>
            </template>
          </ActionColumn>
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

    <!-- 环节6：免打扰设置（免打扰消息不计入未读角标，列表内保留"免打扰"标记） -->
    <el-dialog v-model="dndDialog" title="免打扰设置" width="460px">
      <el-form label-width="110px">
        <el-form-item label="启用免打扰">
          <el-switch v-model="dndForm.enabled" />
        </el-form-item>
        <el-form-item label="免打扰时段">
          <el-time-select v-model="dndForm.quietStart" start="00:00" end="23:00" step="01:00" style="width: 110px" />
          <span style="margin: 0 8px">至</span>
          <el-time-select v-model="dndForm.quietEnd" start="00:00" end="23:00" step="01:00" style="width: 110px" />
          <div class="dnd-tip">该时段内到达的消息不打扰（支持跨零点，如 22:00 至 08:00）</div>
        </el-form-item>
        <el-form-item label="屏蔽消息类型">
          <el-checkbox-group v-model="dndForm.mutedTypes">
            <el-checkbox v-for="(v, k) in typeMap" :key="k" :value="k">{{ v.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dndDialog = false">取消</el-button>
        <el-button type="primary" @click="saveDnd">保存设置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'MessageCenter' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search, CircleCheck, MuteNotification } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { markMessageRead, markAllMessagesRead, visibleMessages, getDnd, setDnd, isMuted, unreadCount as flowUnreadCount } from '@/mock/flow'
import { api } from '@/api'
import { isProduction } from '@/mode'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()
const router = useRouter()

/* ===== Phase 4 灰度：生产模式（薄客户端）——可见消息读后端 /api/admin/messages（角色定向过滤，服务端同源） ===== */
const PROD = isProduction()
const msgData = ref([])
async function loadMessages() {
  if (!PROD) return
  const r = await api('GET', '/admin/messages')
  if (r.ok) msgData.value = r.data
}
/** 当前登录人可见消息（M4：按角色定向过滤；平台管理员可见全部） */
const myMessages = computed(() => PROD ? msgData.value : visibleMessages())

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

/** 未读：未读且未被免打扰（环节6：DND 消息不打扰，与顶栏角标同口径） */
const unreadCount = computed(() => PROD
  ? msgData.value.filter((m) => !m.read && !isMuted(m)).length
  : flowUnreadCount())

const statItems = computed(() => [
  { key: '', label: '全部消息', count: myMessages.value.length, color: tokens.primary },
  { key: 'unread', label: '未读', count: unreadCount.value, color: tokens.danger },
  { key: 'read', label: '已读', count: myMessages.value.length - unreadCount.value, color: tokens.info }
])

const filtered = computed(() =>
  myMessages.value.filter((m) => {
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

async function markRead(row) {
  // Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 消息重取
  if (PROD) {
    const r = await api('POST', '/admin/messages/' + row.id + '/read')
    if (!r.ok || (r.data && r.data.error)) {
      ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
      return
    }
    await loadMessages()
    return
  }
  markMessageRead(row)
}

async function markAll() {
  if (PROD) {
    const r = await api('POST', '/admin/messages/readAll')
    if (!r.ok || (r.data && r.data.error)) {
      ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
      return
    }
    await loadMessages()
    ElMessage.success(`已将 ${(r.data && r.data.count) || 0} 条消息标为已读`)
    return
  }
  const n = markAllMessagesRead()
  ElMessage.success(`已将 ${n} 条消息标为已读`)
}

if (PROD) {
  onMounted(() => { loadMessages() })
  const onRefreshed = () => { loadMessages() }
  window.addEventListener('blms:refreshed', onRefreshed)
  onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))
}

/* ===== 环节6：免打扰设置（按登录账号保存，免打扰消息不计入未读角标） ===== */
const dndDialog = ref(false)
const dndForm = reactive({ enabled: false, quietStart: '22:00', quietEnd: '08:00', mutedTypes: [] })

function openDnd() {
  const d = getDnd()
  dndForm.enabled = d.enabled
  dndForm.quietStart = d.quietStart
  dndForm.quietEnd = d.quietEnd
  dndForm.mutedTypes = [...(d.mutedTypes || [])]
  dndDialog.value = true
}

async function saveDnd() {
  // Phase 4 引擎移除：生产模式写操作 = 后端权威（按登录账号保存）
  if (PROD) {
    const r = await api('PUT', '/admin/dnd', { ...dndForm, mutedTypes: [...dndForm.mutedTypes] })
    if (!r.ok || (r.data && r.data.error)) {
      ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
      return
    }
    dndDialog.value = false
    ElMessage.success('免打扰设置已保存')
    return
  }
  const r = setDnd({ ...dndForm, mutedTypes: [...dndForm.mutedTypes] })
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  dndDialog.value = false
  ElMessage.success('免打扰设置已保存')
}

/** 查看：标记已读并跳转对应模块 */
async function openMessage(row) {
  if (PROD) {
    const r = await api('POST', '/admin/messages/' + row.id + '/read')
    if (r.ok && !(r.data && r.data.error)) loadMessages()
    if (row.path) router.push(row.path)
    return
  }
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

.dnd-tip {
  width: 100%;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
