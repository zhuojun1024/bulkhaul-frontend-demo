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
import { enableAutoSave } from './mock/persist'
import { startScheduler } from './mock/scheduler'
import './styles/tokens.css'
import './styles/index.css'

NProgress.configure({ showSpinner: false, trickle: false })

// 数据持久化：深度监听 db 变化，防抖写入 localStorage（浏览器环境生效）
enableAutoSave()

// 后端定时任务模拟（P2 架构下沉）：围栏事件 / GPS 遥测 / 逾期校准，独立于页面生命周期
startScheduler()

const app = createApp(App)

// P3 工程加固：全局错误处理（组件/生命周期/事件回调未捕获异常统一兜底，避免白屏无提示）
app.config.errorHandler = (err, instance, info) => {
  console.error('[全局错误]', info, err)
  window.__lastError = { message: String((err && err.message) || err), info, time: Date.now() }
}

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

router.beforeEach((to, from, next) => {
  NProgress.start()
  document.title = to.meta.title
    ? `${to.meta.title} - 大宗物流综合管理平台`
    : '大宗物流综合管理平台'
  next()
})
router.afterEach(() => {
  NProgress.done()
})

const pinia = createPinia()
app.use(pinia)
// M7 修复：刷新后按持久化登录态恢复服务层 operator（审计日志操作人=实际登录用户，而非默认管理员）
const userStore = useUserStore()
if (userStore.userInfo.username) setOperator(userStore.userInfo)
app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
