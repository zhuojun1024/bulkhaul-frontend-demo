import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { db } from '@/mock'

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

/** 用户状态（登录态与当前用户信息） */
export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('blms_token') || '')
  // 刷新后按已存用户名从 mock 用户表恢复（含角色，供菜单/按钮权限使用）
  const savedUsername = localStorage.getItem('blms_user')
  const savedUser = savedUsername ? db.users.find((u) => u.username === savedUsername && u.status === 'active') : null
  const userInfo = reactive(
    savedUser
      ? { name: savedUser.name, username: savedUser.username, role: savedUser.role, phone: savedUser.phone, driverId: savedUser.driverId || '' }
      : {}
  )

  function login(user) {
    localStorage.setItem('blms_token', 'mock-token-' + user.username)
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
  }

  return { token, userInfo, login, logout }
})
