import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { db } from '@/data'
import { clearOperator } from '@/data/derived'

/** 应用全局状态（侧边栏折叠等） */
export const useAppStore = defineStore('app', () => {
  const collapsed = ref(false)
  function toggleCollapsed() {
    collapsed.value = !collapsed.value
  }
  return { collapsed, toggleCollapsed }
})

/** 多标签页状态 */
export const useTagsViewStore = defineStore('tagsView', () => {
  const visitedTags = reactive([])
  const cachedViews = reactive([])

  function addTag(route) {
    if (visitedTags.some((t) => t.path === route.path)) return
    if (route.meta && route.meta.title) {
      visitedTags.push({
        path: route.path,
        name: route.name,
        title: route.meta.title
      })
      if (cachedViews.length < 20 && !cachedViews.includes(route.name)) {
        cachedViews.push(route.name)
      }
    }
  }

  function removeTag(route) {
    const idx = visitedTags.findIndex((t) => t.path === route.path)
    if (idx > -1) visitedTags.splice(idx, 1)
    const ci = cachedViews.indexOf(route.name)
    if (ci > -1) cachedViews.splice(ci, 1)
  }

  function closeOthers(route) {
    visitedTags.splice(
      0,
      visitedTags.length,
      ...visitedTags.filter((t) => t.path === '/workbench' || t.path === route.path)
    )
  }

  function closeAll() {
    visitedTags.splice(0, visitedTags.length, ...visitedTags.filter((t) => t.path === '/workbench'))
  }

  return { visitedTags, cachedViews, addTag, removeTag, closeOthers, closeAll }
})

/** 用户状态（登录态与当前用户信息）
 *  切真实 API：token 为后端 JWT；userInfo 由登录接口 / 启动 hydrate 后从 db.users 填充（不再在 store 内同步读 db）。 */
export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('blms_token') || '')
  const userInfo = reactive({ name: '', username: '', role: '', phone: '', driverId: '' })

  /** 从 db.users 恢复当前登录用户（含角色/司机绑定，供菜单/按钮权限使用）；未登录/账号停用返回 false */
  function restore() {
    const saved = localStorage.getItem('blms_user')
    if (!saved) return false
    const u = db.users.find((x) => x.username === saved && x.status === 'active')
    if (!u) return false
    userInfo.name = u.name
    userInfo.username = u.username
    userInfo.role = u.role
    userInfo.phone = u.phone
    userInfo.driverId = u.driverId || ''
    return true
  }

  function login(user, realToken) {
    localStorage.setItem('blms_token', realToken || 'mock-token-' + user.username)
    localStorage.setItem('blms_user', user.username)
    token.value = localStorage.getItem('blms_token')
    userInfo.name = user.name
    userInfo.username = user.username
    userInfo.role = user.role
    userInfo.phone = user.phone
    // 司机账号绑定司机档案（司机端锁定账号用）
    userInfo.driverId = user.driverId || ''
    return Promise.resolve(true)
  }

  function logout() {
    localStorage.removeItem('blms_token')
    localStorage.removeItem('blms_user')
    token.value = ''
    userInfo.name = ''
    userInfo.username = ''
    userInfo.role = ''
    userInfo.phone = ''
    userInfo.driverId = ''
    // M7 修复：清除服务层 operator，登出后服务调用不再记在旧用户名下（审计日志失真）
    clearOperator()
  }

  return { token, userInfo, login, logout, restore }
})
