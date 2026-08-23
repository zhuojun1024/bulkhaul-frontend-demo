<template>
  <div class="sidebar" :class="{ 'is-collapsed': collapsed }">
    <div class="sidebar__logo">
      <div class="sidebar__logo-icon">
        <el-icon :size="20" color="var(--text-inverse)"><Van /></el-icon>
      </div>
      <span v-show="!collapsed" class="sidebar__logo-text">大宗物流管理平台</span>
    </div>
    <AppMenu class="sidebar__menu" :items="menuRoutes" :active="activeMenu" :collapsed="collapsed" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { menuRoutes as allMenuRoutes } from '@/router'
import { useAppStore, useUserStore } from '@/store'
import { menuAllowed } from '@/permission'
import { storeToRefs } from 'pinia'
import AppMenu from './AppMenu.vue'

const route = useRoute()
const appStore = useAppStore()
const userStore = useUserStore()
const { collapsed } = storeToRefs(appStore)

/** 详情页经 meta.activeMenu 归位父菜单，其余按自身路径高亮 */
const activeMenu = computed(() => route.meta.activeMenu || route.path)

/** 菜单级权限：按当前角色过滤菜单（空子菜单的父级一并隐藏） */
const menuRoutes = computed(() =>
  allMenuRoutes
    .map((r) => {
      if (r.children) {
        const children = r.children.filter((c) => menuAllowed(userStore.userInfo.role, c.path))
        return children.length ? { ...r, children } : null
      }
      return menuAllowed(userStore.userInfo.role, r.path) ? r : null
    })
    .filter(Boolean)
)
</script>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
}

.sidebar__logo {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--navbar-height);
  padding: 0 var(--space-md);
  flex-shrink: 0;
  overflow: hidden;
  white-space: nowrap;
  border-bottom: 1px solid var(--sidebar-border);
}

/* 收起态：Logo 图标水平居中（64px 栏宽） */
.sidebar.is-collapsed .sidebar__logo {
  justify-content: center;
  padding: 0;
}

.sidebar__logo-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sidebar__logo-text {
  font-size: var(--text-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  letter-spacing: 0.5px;
}

.sidebar__menu {
  flex: 1;
  min-height: 0;
}
</style>
