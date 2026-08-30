<template>
  <div class="login">
    <!-- 左侧品牌区 -->
    <div class="login__brand">
      <div class="login__brand-inner">
        <div class="login__logo">
          <div class="login__logo-icon">
            <el-icon :size="30" color="var(--text-inverse)"><Van /></el-icon>
          </div>
          <span>大宗物流综合管理平台</span>
        </div>
        <h1 class="login__slogan">
          连接产地与港口<br />让每一吨货物<span class="accent">准时、安全、透明</span>
        </h1>
        <p class="login__sub">覆盖公路 / 铁路 / 水运 / 管道多式联运，合同-计划-调度-磅单-结算全流程数字化</p>
        <div class="login__features">
          <div class="login__feature" v-for="f in features" :key="f.title">
            <el-icon :size="18" color="var(--color-primary-400)"><component :is="f.icon" /></el-icon>
            <div>
              <div class="login__feature-title">{{ f.title }}</div>
              <div class="login__feature-desc">{{ f.desc }}</div>
            </div>
          </div>
        </div>
      </div>
      <!-- 动态路线背景 -->
      <svg class="login__bg" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style="stop-color: var(--color-primary-400)" stop-opacity="0.5" />
            <stop offset="100%" style="stop-color: var(--color-primary)" stop-opacity="0.1" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#routeGrad)" stroke-width="2">
          <path d="M -50 700 C 200 620, 350 750, 520 560 S 750 300, 850 250" />
          <path d="M -50 400 C 150 450, 300 300, 480 380 S 700 500, 850 420" />
          <path d="M 100 950 C 250 750, 450 700, 600 500 S 750 150, 700 -50" />
        </g>
        <g style="fill: var(--color-primary-400)">
          <circle cx="520" cy="560" r="6" opacity="0.9" />
          <circle cx="480" cy="380" r="5" opacity="0.7" />
          <circle cx="600" cy="500" r="7" opacity="0.8" />
          <circle cx="200" cy="655" r="4" opacity="0.6" />
          <circle cx="700" cy="180" r="5" opacity="0.7" />
        </g>
        <g style="fill: var(--text-inverse)">
          <circle r="4" opacity="0.9">
            <animateMotion dur="14s" repeatCount="indefinite"
              path="M -50 700 C 200 620, 350 750, 520 560 S 750 300, 850 250" />
          </circle>
          <circle r="3" opacity="0.7">
            <animateMotion dur="18s" repeatCount="indefinite" begin="3s"
              path="M -50 400 C 150 450, 300 300, 480 380 S 700 500, 850 420" />
          </circle>
          <circle r="4" opacity="0.8">
            <animateMotion dur="16s" repeatCount="indefinite" begin="6s"
              path="M 100 950 C 250 750, 450 700, 600 500 S 750 150, 700 -50" />
          </circle>
        </g>
      </svg>
    </div>

    <!-- 右侧登录表单 -->
    <div class="login__form-area">
      <div class="login__form-card">
        <h2 class="login__title">欢迎登录</h2>
        <p class="login__tip">请使用平台账号或司机手机号登录，演示环境统一密码 123456，需输入图形验证码</p>
        <el-alert
          v-if="lockInfo"
          type="error"
          :closable="false"
          show-icon
          style="margin-bottom: 16px"
          :title="`登录失败次数过多，账号已临时锁定，${lockLeft} 秒后可重试`"
        />
        <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="onLogin">
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="用户名 / 司机手机号" :prefix-icon="User" clearable />
          </el-form-item>
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" placeholder="密码" :prefix-icon="Lock" show-password clearable />
          </el-form-item>
          <el-form-item prop="captcha">
            <div class="login__captcha">
              <el-input v-model="form.captcha" placeholder="验证码" :prefix-icon="Key" clearable class="login__captcha-input" />
              <div class="login__captcha-img" title="点击刷新" @click="refreshCaptcha">
                <div v-html="captchaSvg"></div>
              </div>
            </div>
          </el-form-item>
          <el-form-item>
            <div class="login__options">
              <el-checkbox v-model="form.remember">记住我</el-checkbox>
              <a class="login__forgot">忘记密码？</a>
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" class="login__btn" :disabled="!!lockInfo" @click="onLogin">
              {{ lockInfo ? `${lockLeft} 秒后重试` : '登 录' }}
            </el-button>
          </el-form-item>
        </el-form>
        <div class="login__footer">
          <div class="login__footer-line">
            <el-icon :size="13"><InfoFilled /></el-icon>
            <span>演示密码统一 123456：admin 平台管理员、user02 调度员（仅华北）、user04 结算专员、customer01 客户、user16 只读</span>
          </div>
          <div class="login__footer-line">
            <el-icon :size="13"><Cellphone /></el-icon>
            <span>司机端：司机手机号 + 123456 登录，手机号见司机管理列表</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock, Key } from '@element-plus/icons-vue'
import { useUserStore } from '@/store'
import { setOperator } from '@/mock/flow'
import { db } from '@/mock'
import { api, hydrate } from '@/api'
import dayjs from 'dayjs'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const formRef = ref()
const form = reactive({
  username: 'admin',
  password: '123456',
  captcha: '',
  remember: true
})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
  // 验证码不设必填校验：空验证码交由服务层判定（与 M8 失败锁定口径一致，服务层为唯一校验点）
}

/* ===== 环节9：登录验证码（一次性、60 秒有效，点击图片刷新）——切真实 API：GET /api/auth/captcha ===== */
const captchaId = ref('')
const captchaSvg = ref('')
async function refreshCaptcha() {
  const r = await api('GET', '/auth/captcha')
  if (r.ok && r.data) {
    captchaId.value = r.data.id
    captchaSvg.value = r.data.svg
  }
}

const features = [
  { icon: 'Document', title: '合同全流程管理', desc: '签约、审批、执行、归档一站式' },
  { icon: 'MapLocation', title: '在途实时监控', desc: 'GPS 轨迹 + 电子围栏 + 异常预警' },
  { icon: 'ScaleToOriginal', title: '无人化磅单', desc: '进出磅自动称重，数据实时回传' },
  { icon: 'Wallet', title: '智能结算对账', desc: '运费自动核算，发票线上管理' }
]

/* ===== M8：登录失败锁定（连续 5 次失败 → 锁定 5 分钟；localStorage 持久化，刷新后仍生效）
 *  按账号独立计数（锁一个账号不影响其他账号）；登录成功清零。
 *  注：密码明文存储属演示可接受范围（审计 M8），对接后端时须换 JWT/短信鉴权 */
const MAX_FAILS = 5
const LOCK_MS = 5 * 60 * 1000
const FAIL_KEY = 'blms_login_fail'

function readFailMap() {
  try {
    const m = JSON.parse(localStorage.getItem(FAIL_KEY) || '{}')
    return m && typeof m === 'object' ? m : {}
  } catch (e) {
    return {}
  }
}
function writeFailMap(m) {
  localStorage.setItem(FAIL_KEY, JSON.stringify(m))
}

const lockInfo = ref(null) // { until: 时间戳 } 当前账号处于锁定期
const lockLeft = ref(0) // 剩余秒数
let lockTimer = null

function stopLockTick() {
  if (lockTimer) {
    clearInterval(lockTimer)
    lockTimer = null
  }
}

/** 检查账号是否处于锁定期（更新倒计时展示）；锁定中返回 true */
function checkLock(key) {
  const rec = readFailMap()[key]
  if (rec && rec.until && rec.until > Date.now()) {
    lockInfo.value = { until: rec.until }
    lockLeft.value = Math.ceil((rec.until - Date.now()) / 1000)
    if (!lockTimer) {
      lockTimer = setInterval(() => {
        if (!lockInfo.value) return stopLockTick()
        const left = lockInfo.value.until - Date.now()
        if (left <= 0) {
          lockInfo.value = null
          lockLeft.value = 0
          stopLockTick()
        } else {
          lockLeft.value = Math.ceil(left / 1000)
        }
      }, 1000)
    }
    return true
  }
  lockInfo.value = null
  lockLeft.value = 0
  stopLockTick()
  return false
}

/** 记一次失败；达到上限进入 5 分钟锁定（返回更新后的记录） */
function recordFail(key) {
  const m = readFailMap()
  const rec = m[key] || { count: 0, until: 0 }
  rec.count += 1
  if (rec.count >= MAX_FAILS) {
    rec.until = Date.now() + LOCK_MS
    rec.count = 0
  }
  m[key] = rec
  writeFailMap(m)
  return rec
}

/** 登录成功：清零该账号失败记录 */
function clearFail(key) {
  const m = readFailMap()
  if (m[key]) {
    delete m[key]
    writeFailMap(m)
  }
}

// M8：切换账号时刷新锁定展示；页面加载检查默认账号
watch(
  () => form.username,
  (v) => {
    if (v && v.trim()) checkLock(v.trim())
  }
)
onMounted(() => {
  refreshCaptcha()
  if (form.username.trim()) checkLock(form.username.trim())
})

async function onLogin() {
  const valid = await new Promise((resolve) => formRef.value.validate(resolve))
  if (!valid) return
  const id = form.username.trim()
  // M8：锁定期内直接拦截（不触达账号校验）
  if (checkLock(id)) {
    ElMessage.error(`登录失败次数过多，账号已锁定，请 ${lockLeft.value} 秒后再试`)
    return
  }
  // 环节9：真实 API 登录（POST /api/auth/login：验证码一次性 + bcrypt 密码 + 账号状态，审计由后端记录）
  const result = await api('POST', '/auth/login', {
    username: id,
    password: form.password,
    captchaId: captchaId.value,
    captchaCode: form.captcha
  })
  if (result.ok && result.data) {
    clearFail(id)
    const token = result.data.token
    // 先落 token（hydrate 依赖 localStorage 里的 token 鉴权），再 hydrate 后端权威态
    userStore.login(result.data.user, token)
    try {
      await hydrate()
    } catch (e) {
      console.warn('[登录] hydrate 失败：', e && e.message)
    }
    // 后端 login 不返回 phone，从 hydrate 后的 db.users 取完整档案（含 phone/driverId，供导航栏/司机端）
    const full = db.users.find((u) => u.username === id) || result.data.user
    setOperator(full)
    userStore.userInfo.phone = full.phone || ''
    userStore.userInfo.driverId = full.driverId || ''
    full.lastLogin = dayjs().format('YYYY-MM-DD HH:mm')
    ElMessage.success(`登录成功，欢迎回来，${full.name}`)
    // 司机角色进司机端，客户角色进门户，其余角色进工作台
    const home = full.role === '司机' ? '/driver-app' : full.role === '客户' ? '/portal' : '/workbench'
    router.push(route.query.redirect || home)
    return
  }
  // M8 + A2：服务端为防爆破权威（Redis 按账号计数凭据失败，换浏览器不可绕过）。
  // 锁定态（code=locked）：服务端已锁定 → 强制本地锁定展示（倒计时/按钮禁用），文案用服务端返回；
  // 凭据/验证码失败（code=credential/captcha）：本地计数为体验层（M8 原口径：两者均计入本地锁定），
  // 剩余机会/锁定文案以服务端返回为准（credential 含"还剩 N 次"，captcha 为"验证码错误"）。
  if (result.code === 'locked') {
    recordFail(id) // 服务端权威 → 强制本地锁定
    checkLock(id) // 更新按钮禁用态/倒计时
    ElMessage.error(result.error || '登录失败次数过多，账号已锁定')
  } else if (result.code === 'credential' || result.code === 'captcha') {
    const rec = recordFail(id) // 本地体验层计数（M8 原口径：凭据/验证码失败均计入）
    if (rec.until) checkLock(id) // 本地锁定达成 → 更新按钮禁用态/倒计时
    ElMessage.error(result.error || '登录失败')
  } else {
    ElMessage.error(result.error || '登录失败')
  }
  refreshCaptcha()
}
</script>

<style scoped>
.login {
  display: flex;
  height: 100%;
}

/* ===== 左侧品牌区 ===== */
.login__brand {
  position: relative;
  width: 55%;
  background: linear-gradient(135deg, var(--color-primary-900) 0%, var(--color-primary-900) 55%, var(--color-primary-800) 100%);
  overflow: hidden;
  display: flex;
  align-items: center;
}

.login__bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.login__brand-inner {
  position: relative;
  z-index: 1;
  padding: 0 64px;
  color: var(--text-inverse);
  max-width: 560px;
}

.login__logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 1px;
}

.login__logo-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-400));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(43, 92, 230, 0.5);
}

.login__slogan {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.4;
  margin: 48px 0 16px;
}

.login__slogan .accent {
  background: linear-gradient(90deg, var(--color-primary-400), var(--color-primary-300));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.login__sub {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.8;
  margin: 0 0 40px;
}

.login__features {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.login__feature {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(4px);
}

.login__feature-title {
  font-size: 14px;
  font-weight: 600;
}

.login__feature-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  margin-top: 3px;
}

/* ===== 右侧表单区 ===== */
.login__form-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-neutral-50);
}

.login__form-card {
  width: 400px;
  background: var(--bg-card);
  border-radius: 14px;
  padding: 44px 40px 32px;
  box-shadow: 0 8px 40px rgba(16, 24, 40, 0.08);
}

.login__title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.login__tip {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 8px 0 28px;
}

.login__options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.login__forgot {
  font-size: 13px;
  color: var(--color-primary);
  cursor: pointer;
}

/* 环节9：验证码（输入框 + 可点击刷新的 SVG 图片） */
.login__captcha {
  display: flex;
  gap: 10px;
  width: 100%;
}
.login__captcha-input {
  flex: 1;
}
.login__captcha-img {
  width: 120px;
  height: 40px;
  flex: none;
  cursor: pointer;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--color-neutral-200);
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
}
.login__captcha-img :deep(svg) {
  display: block;
}

.login__btn {
  width: 100%;
  letter-spacing: 8px;
  font-weight: 600;
}

.login__footer {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login__footer-line {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.login__footer-line .el-icon {
  flex-shrink: 0;
  margin-top: 3px;
  color: var(--color-neutral-400);
}

@media (max-width: 900px) {
  .login__brand {
    display: none;
  }
}
</style>
