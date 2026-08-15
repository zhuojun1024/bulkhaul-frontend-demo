import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'

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

/** 用户状态（mock 登录） */
export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('blms_token') || '')
  const userInfo = reactive(
    token.value
      ? {
          name: '张建国',
          role: '平台管理员',
          avatar: '',
          phone: '138****6688'
        }
      : {}
  )

  function login(user) {
    localStorage.setItem('blms_token', 'mock-token-' + Date.now())
    token.value = localStorage.getItem('blms_token')
    userInfo.name = user?.name || '张建国'
    userInfo.role = user?.role || '平台管理员'
    return Promise.resolve(true)
  }

  function logout() {
    localStorage.removeItem('blms_token')
    token.value = ''
  }

  return { token, userInfo, login, logout }
})
