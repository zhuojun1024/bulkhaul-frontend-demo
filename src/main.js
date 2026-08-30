import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'

import App from './App.vue'
import router from './router'
import { useUserStore } from './store'
import { setOperator } from './mock/flow'
import { hydrate } from './api'
import { startScheduler } from './mock/scheduler'
import './styles/tokens.css'
import './styles/index.css'

NProgress.configure({ showSpinner: false, trickle: false })

const pinia = createPinia()
const app = createApp(App)

// P3 工程加固：全局错误处理（组件/生命周期/事件回调未捕获异常统一兜底，避免白屏无提示）
app.config.errorHandler = (err, instance, info) => {
  console.error('[全局错误]', info, err)
  window.__lastError = { message: String((err && err.message) || err), info, time: Date.now() }
}

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn })

/**
 * 启动引导（切真实 API）：
 * 有已存 token → 从后端 /api/snapshot hydrate db（后端为权威态），恢复登录态与操作人，再挂载。
 * 路由守卫（router/index.js）读 db.users / db.rolePerms 判定账号与菜单权限，
 * 故必须在守卫首次执行前完成 hydrate，否则有效会话会被误判为未登录而跳登录页。
 * 无 token（首次访问登录页）→ 跳过 hydrate，直接挂载（登录页不依赖 db）。
 */
async function bootstrap() {
  const userStore = useUserStore()
  const savedToken = localStorage.getItem('blms_token')
  if (savedToken) {
    try {
      await hydrate()
    } catch (e) {
      console.warn('[启动] hydrate 失败，回退种子数据：', e && e.message)
    }
    // 恢复登录态（db.users 已由 hydrate 填充）；恢复失败（账号停用/不存在）则清登录态
    if (!userStore.restore()) {
      userStore.logout()
    } else {
      setOperator(userStore.userInfo)
    }
  }
  app.mount('#app')
  // 后端定时任务（真实 /api/scheduler/tick + 快照刷新）：围栏/遥测/逾期/升级，独立于页面生命周期
  startScheduler()
}

bootstrap()
