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
        <p class="login__tip">请使用平台账号或司机手机号登录，演示环境统一密码 123456</p>
        <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="onLogin">
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="用户名 / 司机手机号" :prefix-icon="User" clearable />
          </el-form-item>
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" placeholder="密码" :prefix-icon="Lock" show-password clearable />
          </el-form-item>
          <el-form-item>
            <div class="login__options">
              <el-checkbox v-model="form.remember">记住我</el-checkbox>
              <a class="login__forgot">忘记密码？</a>
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" class="login__btn" @click="onLogin">
              登 录
            </el-button>
          </el-form-item>
        </el-form>
        <div class="login__footer">
          <el-tag size="small" effect="plain" type="info">演示账号：admin / 123456（调度员 user02、结算专员 user04、客户 customer01、只读 user16 等）</el-tag>
          <el-tag size="small" effect="plain" type="info" style="margin-top: 6px">司机端：司机手机号 + 123456 登录（手机号见司机管理列表）</el-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useUserStore } from '@/store'
import { db } from '@/mock'
import { setOperator, logAction } from '@/mock/flow'
import dayjs from 'dayjs'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const formRef = ref()
const form = reactive({
  username: 'admin',
  password: '123456',
  remember: true
})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

const features = [
  { icon: 'Document', title: '合同全流程管理', desc: '签约、审批、执行、归档一站式' },
  { icon: 'MapLocation', title: '在途实时监控', desc: 'GPS 轨迹 + 电子围栏 + 异常预警' },
  { icon: 'ScaleToOriginal', title: '无人化磅单', desc: '进出磅自动称重，数据实时回传' },
  { icon: 'Wallet', title: '智能结算对账', desc: '运费自动核算，发票线上管理' }
]

function onLogin() {
  formRef.value.validate((valid) => {
    if (!valid) return
    // 真实校验：用户名/司机手机号 + 密码 + 账号状态（司机账号以手机号为登录名）
    const id = form.username.trim()
    const user = db.users.find((u) => u.username === id || u.phone === id)
    if (!user || user.password !== form.password) {
      logAction('系统', '登录系统', `账号 ${id} 登录失败（用户名或密码错误）`, 'fail')
      ElMessage.error('用户名或密码错误')
      return
    }
    if (user.status !== 'active') {
      logAction('系统', '登录系统', `账号 ${user.username} 登录失败（账号已停用）`, 'fail')
      ElMessage.error('账号已停用，请联系管理员')
      return
    }
    setOperator(user)
    userStore.login(user)
    logAction('系统', '登录系统', `账号 ${user.username}（${user.role}）登录成功`)
    user.lastLogin = dayjs().format('YYYY-MM-DD HH:mm')
    ElMessage.success(`登录成功，欢迎回来，${user.name}`)
    // 司机角色进司机端，客户角色进门户，其余角色进工作台
    const home = user.role === '司机' ? '/driver-app' : user.role === '客户' ? '/portal' : '/workbench'
    router.push(route.query.redirect || home)
  })
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

.login__btn {
  width: 100%;
  letter-spacing: 8px;
  font-weight: 600;
}

.login__footer {
  margin-top: 8px;
  text-align: center;
}

@media (max-width: 900px) {
  .login__brand {
    display: none;
  }
}
</style>
