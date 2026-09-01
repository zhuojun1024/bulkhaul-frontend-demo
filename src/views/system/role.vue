<template>
  <div class="page">
    <PageHeader title="角色管理" desc="角色与功能权限分配">
      <el-button v-if="can('role')" type="primary" :icon="Plus" @click="openDialog()">新增角色</el-button>
    </PageHeader>

    <div class="role-grid">
      <div v-for="r in roles" :key="r.id" class="role-card panel">
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
          <el-button v-if="can('role')" size="small" text type="primary" @click="openPerm(r)">权限</el-button>
        </div>
        <p class="role-card__desc">{{ r.description }}</p>
        <div class="role-card__footer">
          <span>
            <el-icon :size="13"><User /></el-icon>
            {{ userCountOf(r.name) }} 名用户
          </span>
          <span>
            <el-tag size="small" :type="permSummary(r.name) === '全部权限' ? 'primary' : 'info'" effect="plain">
              {{ permSummary(r.name) }}
            </el-tag>
            <el-button
              v-if="!r.builtIn && can('role')"
              link type="danger" size="small"
              style="margin-left: 8px"
              @click="removeRole(r)"
            >删除</el-button>
          </span>
        </div>
      </div>
    </div>

    <!-- 权限设置（真实写入 db.rolePerms，保存后立即生效并持久化） -->
    <el-drawer v-model="permVisible" :title="'权限设置 - ' + (currentRole?.name || '')" size="420px">
      <div v-if="currentRole" class="perm-drawer">
        <el-checkbox v-model="permAll" class="perm-all">全部权限（不受限）</el-checkbox>
        <template v-if="!permAll">
          <div class="perm-group__item">
            <div class="perm-group__title">菜单权限</div>
            <el-checkbox-group v-model="checkedMenus" class="perm-group">
              <el-checkbox
                v-for="m in MENU_OPTIONS"
                :key="m.path"
                :value="m.path"
                class="perm-group__perm"
              >{{ m.label }}</el-checkbox>
            </el-checkbox-group>
          </div>
          <div class="perm-group__item">
            <div class="perm-group__title">操作权限</div>
            <el-checkbox-group v-model="checkedActions" class="perm-group">
              <el-checkbox
                v-for="a in ACTION_OPTIONS"
                :key="a.code"
                :value="a.code"
                class="perm-group__perm"
              >{{ a.label }}</el-checkbox>
            </el-checkbox-group>
          </div>
        </template>
        <el-alert
          v-else
          type="info"
          :closable="false"
          show-icon
          title="该角色可访问全部菜单并执行全部操作"
        />
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
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Lock, User } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { db } from '@/mock'
import { saveRole as flowSaveRole, removeRole as flowRemoveRole, updateRolePerms } from '@/mock/flow'
import { useCollection } from '@/composables/useCollection'
import { isProduction } from '@/mode'
import { MENU_OPTIONS, ACTION_OPTIONS } from '@/permission'
import { usePerm } from '@/permission'

const { can } = usePerm()

/* ===== Phase 4 灰度：生产模式（薄客户端）——角色列表读后端 /api/coll/roles（users/rolePerms 交叉引用保留本地） ===== */
const PROD = isProduction()
const rolesCol = useCollection('roles', () => ({ key: 'roles:list' }))
const roles = computed(() => PROD ? rolesCol.data.value : db.roles)

if (PROD) {
  onMounted(() => { rolesCol.refresh() })
  const onRefreshed = () => { rolesCol.refresh() }
  window.addEventListener('blms:refreshed', onRefreshed)
  onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))
}

/** 角色下实际用户数（按用户表实时统计，避免种子 userCount 过期） */
function userCountOf(roleName) {
  return db.users.filter((u) => u.role === roleName).length
}

/** 角色卡片权限摘要 */
function permSummary(roleName) {
  const perm = db.rolePerms[roleName]
  if (!perm) return '未授权'
  if (perm.menus === null && perm.actions === null) return '全部权限'
  return `菜单 ${perm.menus?.length || 0} / 操作 ${perm.actions?.length || 0}`
}

/* ===== 权限抽屉（真实读写 db.rolePerms） ===== */
const permVisible = ref(false)
const currentRole = ref(null)
const permAll = ref(false)
const checkedMenus = ref([])
const checkedActions = ref([])

function openPerm(role) {
  currentRole.value = role
  const perm = db.rolePerms[role.name] || { menus: [], actions: [] }
  permAll.value = perm.menus === null && perm.actions === null
  checkedMenus.value = perm.menus === null ? [] : [...(perm.menus || [])]
  checkedActions.value = perm.actions === null ? [] : [...(perm.actions || [])]
  permVisible.value = true
}

function savePerm() {
  // 写操作下沉服务层（P2）：RBAC + 审计
  const name = currentRole.value.name
  const r = updateRolePerms(
    name,
    permAll.value
      ? { menus: null, actions: null }
      : { menus: [...checkedMenus.value], actions: [...checkedActions.value] }
  )
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  permVisible.value = false
  ElMessage.success(`角色 ${name} 权限已更新并生效`)
}

/* ===== 新增/删除 ===== */
const dialogVisible = ref(false)
const form = reactive({ name: '', code: '', description: '' })

function openDialog() {
  Object.assign(form, { name: '', code: '', description: '' })
  dialogVisible.value = true
}

function saveRole() {
  // 写操作下沉服务层（P2）：RBAC + 查重 + 默认 deny 权限 + 正规 ID 生成 + 审计
  const r = flowSaveRole({ name: form.name, code: form.code, description: form.description })
  if (r && r.error) {
    ElMessage.warning(r.error)
    return
  }
  dialogVisible.value = false
  ElMessage.success('角色已创建（默认无权限，请在"权限"中授权）')
}

function removeRole(role) {
  ElMessageBox.confirm(`确认删除角色 ${role.name}？`, '删除角色', { type: 'warning' }).then(() => {
    // 写操作下沉服务层（P2）：内置角色/在用角色守卫 + RBAC + 审计
    const r = flowRemoveRole(role)
    if (r && r.error) {
      ElMessage.warning(r.error)
      return
    }
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

.perm-all {
  display: block;
  margin-bottom: 16px;
  font-weight: 600;
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
