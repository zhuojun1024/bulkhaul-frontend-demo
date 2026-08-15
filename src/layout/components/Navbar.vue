<template>
  <div class="navbar">
    <div class="navbar__left">
      <!-- padding 放外层 span：el-icon 自带 width/height: 1em + border-box，
           直接加 padding 会把内容区挤没 -->
      <span class="navbar__collapse" @click="appStore.toggleCollapsed()">
        <el-icon :size="20">
          <Expand v-if="collapsed" />
          <Fold v-else />
        </el-icon>
      </span>
      <el-breadcrumb separator="/" class="navbar__breadcrumb">
        <el-breadcrumb-item :to="{ path: '/workbench' }">首页</el-breadcrumb-item>
        <el-breadcrumb-item v-if="route.meta.title && route.path !== '/workbench'">
          {{ route.meta.title }}
        </el-breadcrumb-item>
      </el-breadcrumb>
    </div>
    <div class="navbar__right">
      <el-tooltip content="全屏" placement="bottom">
        <el-icon class="navbar__icon" :size="20" @click="toggleFull">
          <FullScreen />
        </el-icon>
      </el-tooltip>
      <el-dropdown trigger="click" @command="onCommand">
        <span class="navbar__bell">
          <el-icon :size="18"><Bell /></el-icon>
          <span v-if="unreadCount" class="navbar__badge">{{ unreadCount }}</span>
        </span>
        <template #dropdown>
          <el-dropdown-menu class="navbar__dropdown">
            <div class="navbar__dropdown-title">
              消息通知
              <el-tag size="small" type="danger" effect="light">{{ unreadCount }} 条未读</el-tag>
            </div>
            <div
              v-for="item in noticeList"
              :key="item.id"
              class="navbar__notice"
              @click="goNotice(item)"
            >
              <el-icon :color="item.color" :size="16">
                <component :is="item.icon" />
              </el-icon>
              <div class="navbar__notice-body">
                <div class="navbar__notice-title">{{ item.title }}</div>
                <div class="navbar__notice-time">{{ item.time }}</div>
              </div>
            </div>
            <el-dropdown-item divided @click="goNotice(null)">查看全部</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="onUserCommand">
        <div class="navbar__user">
          <div class="navbar__avatar">{{ userStore.userInfo.name?.charAt(0) || 'U' }}</div>
          <span class="navbar__username">{{ userStore.userInfo.name }}</span>
          <el-icon :size="12"><ArrowDown /></el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">
              <el-icon><User /></el-icon>个人信息
            </el-dropdown-item>
            <el-dropdown-item command="logout" divided>
              <el-icon><SwitchButton /></el-icon>退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import screenfull from 'screenfull'
import { useAppStore, useUserStore } from '@/store'
import { storeToRefs } from 'pinia'
import { db } from '@/mock'
import { fromNow } from '@/utils'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const userStore = useUserStore()
const { collapsed } = storeToRefs(appStore)

/** 通知：待处理异常 + 待审批合同 + 待结算 */
const noticeList = computed(() => {
  const list = []
  db.exceptions
    .filter((e) => e.status !== 'closed')
    .slice(0, 4)
    .forEach((e) =>
      list.push({
        id: 'ex' + e.id,
        icon: 'Warning',
        color: e.level === 'high' ? tokens.danger : tokens.warning,
        title: `异常单 ${e.id}：${e.description}`,
        time: fromNow(e.occurTime),
        path: '/exception'
      })
    )
  db.contracts
    .filter((c) => c.status === 'pending')
    .slice(0, 2)
    .forEach((c) =>
      list.push({
        id: 'ct' + c.id,
        icon: 'Document',
        color: tokens.primary,
        title: `合同 ${c.id} 待审批：${c.name}`,
        time: fromNow(c.signDate),
        path: '/contract'
      })
    )
  db.settlements
    .filter((s) => s.status === 'overdue')
    .slice(0, 2)
    .forEach((s) =>
      list.push({
        id: 'st' + s.id,
        icon: 'Wallet',
        color: tokens.danger,
        title: `结算单 ${s.billNo} 已逾期，请及时处理`,
        time: fromNow(s.period + '-01'),
        path: '/settlement'
      })
    )
  return list.slice(0, 6)
})

const unreadCount = computed(() => noticeList.value.length)

function toggleFull() {
  if (screenfull.isEnabled) screenfull.toggle()
}

function goNotice(item) {
  if (item) router.push(item.path)
  else router.push('/exception')
}

function onCommand(cmd) {
  if (cmd === 'profile') {
    ElMessageBox.alert(
      `<div style="line-height:2">
        <b>${userStore.userInfo.name}</b><br/>
        角色：${userStore.userInfo.role}<br/>
        电话：${userStore.userInfo.phone}<br/>
        工号：BLMS-2026-001
      </div>`,
      '个人信息',
      { dangerouslyUseHTMLString: true, confirmButtonText: '知道了' }
    )
  } else if (cmd === 'logout') {
    ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      type: 'warning',
      confirmButtonText: '退出',
      cancelButtonText: '取消'
    })
      .then(() => {
        userStore.logout()
        ElMessage.success('已退出登录')
        router.push('/login')
      })
      .catch(() => {})
  }
}
</script>

<style scoped>
.navbar {
  height: var(--navbar-height);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
}

.navbar__left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.navbar__collapse {
  cursor: pointer;
  color: var(--text-regular);
  padding: 10px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
}
.navbar__collapse:hover {
  background: var(--bg-page);
  color: var(--color-primary);
}

.navbar__right {
  display: flex;
  align-items: center;
  gap: 20px;
}

.navbar__icon {
  cursor: pointer;
  color: var(--text-regular);
  box-sizing: border-box;
  border-radius: 6px;
}
.navbar__icon:hover {
  background: var(--bg-page);
  color: var(--color-primary);
}

.navbar__bell {
  position: relative;
  cursor: pointer;
  color: var(--text-regular);
  padding: 6px;
  border-radius: 6px;
  display: flex;
}
.navbar__bell:hover {
  background: var(--bg-page);
  color: var(--color-primary);
}

.navbar__badge {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--color-danger);
  color: var(--text-inverse);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.navbar__user {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 8px;
}
.navbar__user:hover {
  background: var(--bg-page);
}

.navbar__avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-400));
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
}

.navbar__username {
  font-size: 14px;
  color: var(--text-primary);
}

.navbar__dropdown {
  width: 340px;
  padding: 8px;
}

.navbar__dropdown-title {
  padding: 8px 12px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 4px;
}

.navbar__notice {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.navbar__notice:hover {
  background: var(--bg-page);
}

.navbar__notice-body {
  flex: 1;
  min-width: 0;
}

.navbar__notice-title {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.navbar__notice-time {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
</style>
