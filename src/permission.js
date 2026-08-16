import { computed } from 'vue'
import { useUserStore } from '@/store'

/**
 * 角色权限（RBAC）
 * 菜单级：ROLE_MENUS 控制侧边栏可见菜单与路由访问；null 表示全部菜单
 * 按钮级：ROLE_ACTIONS 控制关键操作按钮；null 表示全部操作，[] 表示只读
 *
 * 操作码：
 *  contract   新建/终止合同      contract-approve 合同审批（通过/驳回）
 *  plan       新建/取消计划      dispatch   派车与调度执行（装货/发车/到达/卸货/恢复）
 *  exception  异常受理/处置/关闭 safety     安全管理操作
 *  settlement 结算（生成/对账/结算/收款）  invoice 开票
 *  weighing   磅单补录           warehouse  库存锁定/解锁
 */
/** 注意：路径必须与 router 实际注册路径一致（如 /contract，而非 /transport/contract） */
export const ROLE_MENUS = {
  平台管理员: null,
  只读用户: null,
  调度员: [
    '/workbench',
    '/monitor',
    '/contract',
    '/plan',
    '/dispatch',
    '/track',
    '/exception',
    '/vehicle',
    '/driver',
    '/terminal',
    '/terminal/weighing'
  ],
  结算专员: ['/workbench', '/monitor', '/contract', '/customer', '/settlement', '/settlement/invoice', '/report'],
  场站操作员: ['/workbench', '/dispatch', '/terminal', '/terminal/weighing', '/warehouse', '/warehouse/inventory'],
  安全管理员: ['/workbench', '/dispatch', '/exception', '/safety']
}

export const ROLE_ACTIONS = {
  平台管理员: null,
  只读用户: [],
  调度员: ['contract', 'plan', 'dispatch', 'exception'],
  结算专员: ['settlement', 'invoice'],
  场站操作员: ['dispatch', 'weighing', 'warehouse'],
  安全管理员: ['dispatch', 'exception', 'safety']
}

/** 当前用户是否可见指定菜单路径 */
export function menuAllowed(role, path) {
  const menus = ROLE_MENUS[role]
  if (menus === undefined || menus === null) return true
  return menus.includes(path)
}

/** 当前用户是否可执行指定操作 */
export function actionAllowed(role, action) {
  const actions = ROLE_ACTIONS[role]
  if (actions === undefined || actions === null) return true
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
