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
import { enableAutoSave } from './mock/persist'
import './styles/tokens.css'
import './styles/index.css'

NProgress.configure({ showSpinner: false, trickle: false })

// 数据持久化：深度监听 db 变化，防抖写入 localStorage（浏览器环境生效）
enableAutoSave()

const app = createApp(App)

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

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
