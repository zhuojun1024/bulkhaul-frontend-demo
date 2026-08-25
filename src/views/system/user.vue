<template>
  <div class="page">
    <PageHeader title="用户管理" desc="平台用户账号、角色分配与状态管理">
      <el-button v-if="can('user')" type="primary" :icon="Plus" @click="openDialog()">新增用户</el-button>
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
          <el-table-column label="数据范围" width="130" align="center">
            <template #default="{ row }">
              <el-tag v-if="scopeOf(row).length" size="small" type="warning" effect="plain">{{ scopeOf(row).join('、') }}</el-tag>
              <span v-else class="scope-all">全量数据</span>
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
                :disabled="row.username === 'admin' || !can('user')"
                @change="(val) => toggleStatus(row, val)"
              />
            </template>
          </el-table-column>
          <el-table-column v-if="can('user')" label="操作" width="250" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openDialog(row)">编辑</el-button>
              <el-button
                v-if="row.username !== 'admin'"
                link type="warning" size="small"
                @click="openScope(row)"
              >数据范围</el-button>
              <!-- F4c：管理员重置密码（忘记密码/账号锁定的恢复入口） -->
              <el-button
                link type="warning" size="small"
                @click="openResetPw(row)"
              >重置密码</el-button>
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
        <el-form-item v-if="!editingId" label="密码" required>
          <el-input v-model="form.password" type="password" show-password placeholder="默认 123456（演示环境统一密码）" />
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

    <!-- 环节8：数据范围设置（行级数据权限：按装货侧区域过滤，空 = 全量数据） -->
    <el-dialog v-model="scopeVisible" title="数据范围设置" width="440px">
      <div v-if="scopeTarget" class="scope-tip">
        账号 <b>@{{ scopeTarget.username }}</b>（{{ scopeTarget.role }}）
      </div>
      <el-checkbox-group v-model="scopeForm.regions">
        <el-checkbox v-for="r in DATA_REGIONS" :key="r" :value="r">{{ r }}</el-checkbox>
      </el-checkbox-group>
      <div class="scope-tip">不勾选 = 全量数据；勾选后该账号在调度/计划/在途监控等列表仅可见装货侧属于所选区域的数据（多租户行级权限的等价物）。</div>
      <template #footer>
        <el-button @click="scopeVisible = false">取消</el-button>
        <el-button type="primary" @click="saveScope">保存</el-button>
      </template>
    </el-dialog>

    <!-- F4c：重置密码（RBAC user，服务层守卫 + 审计，不落新密码明文） -->
    <el-dialog v-model="resetPwVisible" title="重置登录密码" width="440px">
      <div v-if="resetPwTarget" class="scope-tip">
        账号 <b>@{{ resetPwTarget.username }}</b>（{{ resetPwTarget.role }}）
      </div>
      <el-form label-width="90px" style="margin-top: 12px">
        <el-form-item label="新密码" required>
          <el-input v-model="resetPwForm.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认密码" required>
          <el-input v-model="resetPwForm.confirm" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
      </el-form>
      <div class="scope-tip">重置后该账号立即生效，旧密码失效；请通过安全渠道告知用户新密码。</div>
      <template #footer>
        <el-button @click="resetPwVisible = false">取消</el-button>
        <el-button type="primary" @click="saveResetPw">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'SysUser' })
import { ref, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Refresh } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { db } from '@/mock'
import { removeUser as flowRemoveUser, saveUser, toggleUserStatus, resetPassword, DATA_REGIONS, setDataScope } from '@/mock/flow'
import { usePerm } from '@/permission'

const { can } = usePerm()

/** 环节8：账号数据范围（空 = 全量数据） */
const scopeOf = (row) => (db.dataScopes && db.dataScopes[row.username]?.regions) || []

/* ===== 数据范围设置（RBAC user，服务层校验 + 审计） ===== */
const scopeVisible = ref(false)
const scopeTarget = ref(null)
const scopeForm = reactive({ regions: [] })

function openScope(row) {
  scopeTarget.value = row
  scopeForm.regions = [...scopeOf(row)]
  scopeVisible.value = true
}

function saveScope() {
  const r = setDataScope(scopeTarget.value.username, scopeForm.regions)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  scopeVisible.value = false
  ElMessage.success(scopeForm.regions.length ? `数据范围已设为：${scopeForm.regions.join('、')}` : '已恢复全量数据')
}

/* ===== F4c：重置密码（RBAC user，服务层守卫 + 审计） ===== */
const resetPwVisible = ref(false)
const resetPwTarget = ref(null)
const resetPwForm = reactive({ password: '', confirm: '' })

function openResetPw(row) {
  resetPwTarget.value = row
  Object.assign(resetPwForm, { password: '', confirm: '' })
  resetPwVisible.value = true
}

function saveResetPw() {
  if (!resetPwForm.password) {
    ElMessage.warning('请设置新密码')
    return
  }
  if (resetPwForm.password !== resetPwForm.confirm) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  const r = resetPassword(resetPwTarget.value.id, resetPwForm.password)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  resetPwVisible.value = false
  ElMessage.success(`账号 ${resetPwTarget.value.username} 密码已重置`)
}


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
  // 写操作下沉服务层（P2）：RBAC + 当前账号保护 + 审计
  const r = toggleUserStatus(row, val)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(`用户 ${row.name} 已${val ? '启用' : '停用'}`)
}

function removeUser(row) {
  ElMessageBox.confirm(`确认删除用户 ${row.name}？`, '删除用户', { type: 'warning' }).then(() => {
    const r = flowRemoveUser(row)
    if (r && r.error) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success('用户已删除')
  }).catch(() => {})
}

/* ===== 新增/编辑 ===== */
const dialogVisible = ref(false)
const editingId = ref('')
const form = reactive({ name: '', username: '', password: '123456', role: '调度员', phone: '', email: '' })

function openDialog(row) {
  if (row) {
    editingId.value = row.id
    Object.assign(form, { name: row.name, username: row.username, role: row.role, phone: row.phone, email: row.email })
  } else {
    editingId.value = ''
    Object.assign(form, { name: '', username: '', password: '123456', role: '调度员', phone: '', email: '' })
  }
  dialogVisible.value = true
}

function save() {
  // 写操作下沉服务层（P2）：RBAC + 账号查重 + 默认密码 + 正规 ID 生成 + 审计
  const r = saveUser({ id: editingId.value, ...form })
  if (r && r.error) {
    ElMessage.warning(r.error)
    return
  }
  ElMessage.success(editingId.value ? '用户已更新' : '用户已创建，可使用该账号登录')
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

.scope-all {
  font-size: 12px;
  color: var(--text-secondary);
}

.scope-tip {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.8;
  margin-bottom: 10px;
}
</style>
