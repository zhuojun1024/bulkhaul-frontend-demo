<template>
  <div class="page" v-loading="loading">
    <PageHeader title="用户管理" desc="平台用户账号、角色分配与状态管理">
      <el-button type="primary" :icon="Plus" @click="openDialog()">新增用户</el-button>
    </PageHeader>

    <div class="panel">
      <div class="panel__body">
        <el-form inline class="filter-bar" @submit.prevent>
          <el-form-item>
            <el-input v-model="filter.keyword" placeholder="姓名 / 账号 / 手机号" :prefix-icon="Search" clearable style="width: 220px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.role" placeholder="角色" clearable>
              <el-option v-for="r in db.roles" :key="r.id" :label="r.name" :value="r.name" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.status" placeholder="状态" clearable style="width: 120px">
              <el-option label="正常" value="active" />
              <el-option label="停用" value="disabled" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button :icon="Refresh" circle @click="resetFilter" />
          </el-form-item>
        </el-form>

        <el-table :data="paged" stripe>
          <el-table-column label="用户" min-width="160">
            <template #default="{ row }">
              <div class="user-cell">
                <div class="user-cell__avatar">{{ row.name.charAt(0) }}</div>
                <div>
                  <div class="user-cell__name">{{ row.name }}</div>
                  <div class="user-cell__username">@{{ row.username }}</div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="role" label="角色" width="120" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ row.role }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="phone" label="手机号" width="130" />
          <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
          <el-table-column prop="lastLogin" label="最近登录" width="150" />
          <el-table-column prop="createdAt" label="创建时间" width="110" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="row.status === 'active'"
                :disabled="row.username === 'admin'"
                @change="(val) => toggleStatus(row, val)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openDialog(row)">编辑</el-button>
              <el-button
                v-if="row.username !== 'admin'"
                link type="danger" size="small"
                @click="removeUser(row)"
              >删除</el-button>
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

    <!-- 新增/编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑用户' : '新增用户'" width="480px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="姓名" required>
          <el-input v-model="form.name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="账号" required>
          <el-input v-model="form.username" placeholder="登录账号" :disabled="!!editingId" />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="form.role" style="width: 100%">
            <el-option v-for="r in db.roles" :key="r.id" :label="r.name" :value="r.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="form.phone" placeholder="手机号" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" placeholder="邮箱" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'SysUser' })
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { db } from '@/mock'
import dayjs from 'dayjs'

const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 300))

const filter = reactive({ keyword: '', role: '', status: '' })
const page = ref(1)
const pageSize = ref(10)

const filtered = computed(() =>
  db.users.filter((u) => {
    if (filter.role && u.role !== filter.role) return false
    if (filter.status && u.status !== filter.status) return false
    if (filter.keyword) {
      if (!u.name.includes(filter.keyword) && !u.username.includes(filter.keyword) && !u.phone.includes(filter.keyword)) return false
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
  filter.role = ''
  filter.status = ''
  page.value = 1
}

function toggleStatus(row, val) {
  row.status = val ? 'active' : 'disabled'
  ElMessage.success(`用户 ${row.name} 已${val ? '启用' : '停用'}`)
}

function removeUser(row) {
  ElMessageBox.confirm(`确认删除用户 ${row.name}？`, '删除用户', { type: 'warning' }).then(() => {
    const idx = db.users.findIndex((u) => u.id === row.id)
    if (idx > -1) db.users.splice(idx, 1)
    ElMessage.success('用户已删除')
  }).catch(() => {})
}

/* ===== 新增/编辑 ===== */
const dialogVisible = ref(false)
const editingId = ref('')
const form = reactive({ name: '', username: '', role: '调度员', phone: '', email: '' })

function openDialog(row) {
  if (row) {
    editingId.value = row.id
    Object.assign(form, { name: row.name, username: row.username, role: row.role, phone: row.phone, email: row.email })
  } else {
    editingId.value = ''
    Object.assign(form, { name: '', username: '', role: '调度员', phone: '', email: '' })
  }
  dialogVisible.value = true
}

function save() {
  if (!form.name || !form.username) {
    ElMessage.warning('请填写姓名和账号')
    return
  }
  if (editingId.value) {
    const row = db.users.find((u) => u.id === editingId.value)
    Object.assign(row, { name: form.name, role: form.role, phone: form.phone, email: form.email })
    ElMessage.success('用户已更新')
  } else {
    db.users.push({
      id: `U${String(db.users.length + 1).padStart(3, '0')}`,
      username: form.username,
      name: form.name,
      role: form.role,
      phone: form.phone || '-',
      email: form.email || '-',
      status: 'active',
      lastLogin: '-',
      createdAt: dayjs().format('YYYY-MM-DD')
    })
    ElMessage.success('用户已创建')
  }
  dialogVisible.value = false
}
</script>

<style scoped>
.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-cell__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-400));
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}

.user-cell__name {
  font-weight: 600;
}

.user-cell__username {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
