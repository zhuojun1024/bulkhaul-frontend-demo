<template>
  <div class="page" v-loading="loading">
    <PageHeader title="角色管理" desc="角色与功能权限分配">
      <el-button type="primary" :icon="Plus" @click="openDialog()">新增角色</el-button>
    </PageHeader>

    <div class="role-grid">
      <div v-for="r in db.roles" :key="r.id" class="role-card panel">
        <div class="role-card__head">
          <div class="role-card__icon" :class="{ builtin: r.builtIn }">
            <el-icon :size="22"><Lock /></el-icon>
          </div>
          <div>
            <div class="role-card__name">
              {{ r.name }}
              <el-tag v-if="r.builtIn" size="small" type="info" effect="plain">内置</el-tag>
            </div>
            <div class="role-card__code">{{ r.code }}</div>
          </div>
          <el-button size="small" text type="primary" @click="openPerm(r)">权限</el-button>
        </div>
        <p class="role-card__desc">{{ r.description }}</p>
        <div class="role-card__footer">
          <span>
            <el-icon :size="13"><User /></el-icon>
            {{ r.userCount }} 名用户
          </span>
          <el-button
            v-if="!r.builtIn"
            link type="danger" size="small"
            @click="removeRole(r)"
          >删除</el-button>
        </div>
      </div>
    </div>

    <!-- 权限设置 -->
    <el-drawer v-model="permVisible" :title="'权限设置 - ' + (currentRole?.name || '')" size="400px">
      <div v-if="currentRole" class="perm-drawer">
        <el-checkbox-group v-model="permChecked" class="perm-group">
          <div v-for="group in permGroups" :key="group.name" class="perm-group__item">
            <div class="perm-group__title">{{ group.name }}</div>
            <el-checkbox
              v-for="p in group.perms"
              :key="p"
              :value="p"
              class="perm-group__perm"
            >{{ p }}</el-checkbox>
          </div>
        </el-checkbox-group>
        <div class="perm-drawer__footer">
          <el-button @click="permVisible = false">取消</el-button>
          <el-button type="primary" @click="savePerm">保存权限</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- 新增角色 -->
    <el-dialog v-model="dialogVisible" title="新增角色" width="440px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="角色名称" required>
          <el-input v-model="form.name" placeholder="如：调度组长" />
        </el-form-item>
        <el-form-item label="角色编码" required>
          <el-input v-model="form.code" placeholder="如：dispatcher_leader" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRole">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'SysRole' })
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Lock, User } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { db } from '@/mock'

const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 300))

const permGroups = [
  { name: '运输管理', perms: ['合同管理', '运输计划', '调度管理', '在途监控', '异常处理'] },
  { name: '资源管理', perms: ['车辆管理', '司机管理', '场站管理', '仓储管理', '商品管理'] },
  { name: '经营管理', perms: ['客户管理', '结算管理', '发票管理'] },
  { name: '系统管理', perms: ['用户管理', '角色管理', '操作日志', '安全管理'] }
]

/* ===== 权限抽屉 ===== */
const permVisible = ref(false)
const currentRole = ref(null)
const permChecked = ref([])

function openPerm(role) {
  currentRole.value = role
  permChecked.value = permGroups.flatMap((g) => g.perms).slice(0, role.builtIn ? 19 : 6)
  permVisible.value = true
}

function savePerm() {
  ElMessage.success(`角色 ${currentRole.value.name} 权限已更新（${permChecked.value.length} 项）`)
  permVisible.value = false
}

/* ===== 新增/删除 ===== */
const dialogVisible = ref(false)
const form = reactive({ name: '', code: '', description: '' })

function openDialog() {
  Object.assign(form, { name: '', code: '', description: '' })
  dialogVisible.value = true
}

function saveRole() {
  if (!form.name || !form.code) {
    ElMessage.warning('请填写角色名称和编码')
    return
  }
  db.roles.push({
    id: `R${String(db.roles.length + 1).padStart(3, '0')}`,
    name: form.name,
    code: form.code,
    userCount: 0,
    description: form.description || '—',
    builtIn: false
  })
  dialogVisible.value = false
  ElMessage.success('角色已创建')
}

function removeRole(role) {
  if (role.userCount > 0) {
    ElMessage.warning(`角色下还有 ${role.userCount} 名用户，无法删除`)
    return
  }
  ElMessageBox.confirm(`确认删除角色 ${role.name}？`, '删除角色', { type: 'warning' }).then(() => {
    const idx = db.roles.findIndex((r) => r.id === role.id)
    if (idx > -1) db.roles.splice(idx, 1)
    ElMessage.success('角色已删除')
  }).catch(() => {})
}
</script>

<style scoped>
.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.role-card {
  padding: 18px 20px;
  transition: all 0.2s;
}

.role-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(16, 24, 40, 0.1);
}

.role-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.role-card__icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: rgba(43, 92, 230, 0.1);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.role-card__icon.builtin {
  background: rgba(134, 144, 156, 0.12);
  color: var(--text-secondary);
}

.role-card__name {
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.role-card__code {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.role-card__head .el-button {
  margin-left: auto;
}

.role-card__desc {
  font-size: 13px;
  color: var(--text-regular);
  margin: 12px 0;
  min-height: 36px;
}

.role-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  font-size: 12px;
  color: var(--text-secondary);
}

.role-card__footer .el-icon {
  margin-right: 4px;
}

.perm-group {
  display: block;
}

.perm-group__item {
  margin-bottom: 16px;
}

.perm-group__title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.perm-group__perm {
  display: block;
  margin-right: 0;
  margin-bottom: 6px;
}

.perm-drawer__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
</style>
