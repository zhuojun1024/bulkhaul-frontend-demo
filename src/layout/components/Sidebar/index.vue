<template>
  <div class="sidebar">
    <div class="sidebar__logo">
      <div class="sidebar__logo-icon">
        <el-icon :size="24" color="var(--text-inverse)"><Van /></el-icon>
      </div>
      <span v-show="!collapsed" class="sidebar__logo-text">大宗物流管理平台</span>
    </div>
    <el-scrollbar class="sidebar__scroll">
      <el-menu
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        background-color="transparent"
        text-color="var(--sidebar-text)"
        active-text-color="var(--text-inverse)"
        popper-class="sidebar-submenu-popper"
        router
        unique-opened
      >
        <template v-for="route in menuRoutes" :key="route.path">
          <el-sub-menu v-if="route.children" :index="route.path">
            <template #title>
              <el-icon><component :is="route.meta.icon" /></el-icon>
              <span>{{ route.meta.title }}</span>
            </template>
            <el-menu-item v-for="child in route.children" :key="child.path" :index="child.path">
              <el-icon><component :is="child.meta.icon" /></el-icon>
              <template #title>{{ child.meta.title }}</template>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="route.path">
            <el-icon><component :is="route.meta.icon" /></el-icon>
            <template #title>{{ route.meta.title }}</template>
          </el-menu-item>
        </template>
      </el-menu>
    </el-scrollbar>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { menuRoutes as allMenuRoutes } from '@/router'
import { useAppStore, useUserStore } from '@/store'
import { menuAllowed } from '@/permission'
import { storeToRefs } from 'pinia'

const route = useRoute()
const appStore = useAppStore()
const userStore = useUserStore()
const { collapsed } = storeToRefs(appStore)

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
  background: linear-gradient(180deg, var(--color-primary-900) 0%, var(--sidebar-bg) 100%);
}

.sidebar__logo {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--navbar-height);
  padding: 0 16px;
  flex-shrink: 0;
  overflow: hidden;
  white-space: nowrap;
}

.sidebar__logo-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-400));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sidebar__logo-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-inverse);
  letter-spacing: 1px;
}

.sidebar__scroll {
  flex: 1;
}

.sidebar :deep(.el-menu) {
  padding: 8px;
}

/* 收起态：EP 按"菜单无内边距"计算图标居中（64px = 24px 图标 + 2×20px 项内边距），
   菜单加了 8px padding 后需清零左右内边距并 flex 居中，否则图标整体偏右 8px。
   注意：无子菜单项的图标被绝对定位的 .el-menu-tooltip__trigger 包裹（自带 0 20px padding），
   必须单独针对 trigger；子菜单标题是直接的 flex 容器，直接处理即可 */
.sidebar :deep(.el-menu--collapse .el-menu-item .el-menu-tooltip__trigger),
.sidebar :deep(.el-menu--collapse .el-sub-menu__title) {
  padding: 0;
  justify-content: center;
}

.sidebar :deep(.el-menu-item),
.sidebar :deep(.el-sub-menu__title) {
  height: 44px;
  line-height: 44px;
  margin: 2px 0;
  border-radius: 8px;
}

.sidebar :deep(.el-menu-item.is-active) {
  background: linear-gradient(90deg, rgba(43, 92, 230, 0.95), rgba(91, 124, 236, 0.75)) !important;
  box-shadow: 0 2px 8px rgba(43, 92, 230, 0.35);
}

.sidebar :deep(.el-menu-item:hover),
.sidebar :deep(.el-sub-menu__title:hover) {
  background: rgba(255, 255, 255, 0.06) !important;
  color: var(--text-inverse) !important;
}

.sidebar :deep(.el-sub-menu .el-menu) {
  background: transparent !important;
}
</style>
