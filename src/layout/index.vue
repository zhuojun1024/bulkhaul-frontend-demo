<template>
  <div class="layout">
    <Sidebar class="layout__sidebar" :class="{ 'layout__sidebar--collapsed': collapsed }" />
    <div class="layout__main">
      <Navbar />
      <TagsView />
      <AppMain />
    </div>
  </div>
</template>

<script setup>
import Sidebar from './components/Sidebar/index.vue'
import Navbar from './components/Navbar.vue'
import TagsView from './components/TagsView.vue'
import AppMain from './components/AppMain.vue'
import { useAppStore } from '@/store'
import { storeToRefs } from 'pinia'

const appStore = useAppStore()
const { collapsed } = storeToRefs(appStore)
</script>

<style scoped>
.layout {
  display: flex;
  height: 100%;
}

.layout__sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  transition: width 0.25s;
  z-index: 10;
}

.layout__sidebar--collapsed {
  width: var(--sidebar-width-collapsed);
}

.layout__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
}
</style>
