<template>
  <div class="app-main">
    <router-view v-slot="{ Component }">
      <keep-alive :include="tagsStore.cachedViews">
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </div>
</template>

<script setup>
import { useTagsViewStore } from '@/store'

const tagsStore = useTagsViewStore()
</script>

<style scoped>
.app-main {
  flex: 1;
  overflow: auto;
  background: var(--bg-page);
}
</style>
