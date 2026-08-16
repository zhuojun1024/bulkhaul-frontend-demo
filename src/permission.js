import { computed } from 'vue'
import { useUserStore } from '@/store'
import { db } from '@/mock'
import { ROLE_MENUS, ROLE_ACTIONS, MENU_OPTIONS, ACTION_OPTIONS } from './permission-table'

export { ROLE_MENUS, ROLE_ACTIONS, MENU_OPTIONS, ACTION_OPTIONS }

/**
 * 角色权限（RBAC）
 * 判定顺序：db.rolePerms[角色]（角色管理页可编辑，持久化）→ 内置表 ROLE_MENUS/ROLE_ACTIONS → 默认拒绝
 * 菜单级：null 表示全部菜单；按钮级：null 表示全部操作，[] 表示只读
 * 默认策略：未注册角色（含空角色）一律拒绝（deny），避免新增/停用角色绕过权限
 */

/** 当前用户是否可见指定菜单路径（未注册角色默认拒绝） */
export function menuAllowed(role, path) {
  const perm = db.rolePerms && db.rolePerms[role]
  const menus = perm ? perm.menus : ROLE_MENUS[role]
  if (menus === null) return true
  if (menus === undefined) return false
  return menus.includes(path)
}

/** 当前用户是否可执行指定操作（未注册角色默认拒绝） */
export function actionAllowed(role, action) {
  const perm = db.rolePerms && db.rolePerms[role]
  const actions = perm ? perm.actions : ROLE_ACTIONS[role]
  if (actions === null) return true
  if (actions === undefined) return false
  return actions.includes(action)
}

/** 视图内使用：const { can, canMenu } = usePerm() */
export function usePerm() {
  const userStore = useUserStore()
  const role = computed(() => userStore.userInfo.role || '只读用户')
  const can = (action) => actionAllowed(role.value, action)
  const canMenu = (path) => menuAllowed(role.value, path)
  return { role, can, canMenu }
}
