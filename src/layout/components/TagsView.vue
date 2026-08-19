<template>
  <div class="tags-view">
    <el-scrollbar class="tags-view__scroll">
      <div class="tags-view__list">
        <router-link
          v-for="tag in tagsStore.visitedTags"
          :key="tag.path"
          :to="tag.path"
          class="tags-view__tag"
          :class="{ 'tags-view__tag--active': $route.path === tag.path }"
          @click.middle="closeTag(tag)"
        >
          <span class="tags-view__dot" />
          {{ tag.title }}
          <el-icon
            v-if="tag.path !== '/workbench'"
            class="tags-view__close"
            @click.prevent.stop="closeTag(tag)"
          >
            <Close />
          </el-icon>
        </router-link>
      </div>
    </el-scrollbar>
    <el-dropdown class="tags-view__ops" trigger="click" @command="onCommand">
      <el-icon :size="14"><ArrowDown /></el-icon>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="closeOthers">关闭其他</el-dropdown-item>
          <el-dropdown-item command="closeAll">关闭全部</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup>
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTagsViewStore } from '@/store'

const route = useRoute()
const router = useRouter()
const tagsStore = useTagsViewStore()

// 路由变化时加入标签
watch(
  () => route.path,
  () => {
    if (route.meta && route.meta.title && !route.meta.hidden) {
      tagsStore.addTag(route)
    }
  },
  { immediate: true }
)

function closeTag(tag) {
  tagsStore.removeTag(tag)
  if (route.path === tag.path) {
    router.push('/workbench')
  }
}

function onCommand(cmd) {
  if (cmd === 'closeOthers') tagsStore.closeOthers(route)
  if (cmd === 'closeAll') tagsStore.closeAll()
}
</script>

<style scoped>
.tags-view {
  height: var(--tagsview-height);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  box-sizing: content-box;
  display: flex;
  align-items: center;
  padding: 0 8px 0 16px;
  gap: 8px;
  flex-shrink: 0;
}

.tags-view__scroll {
  flex: 1;
}

.tags-view__list {
  display: flex;
  gap: 8px;
  padding: 6px 0;
}

.tags-view__tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--bg-page);
  color: var(--text-regular);
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.tags-view__tag:hover {
  color: var(--color-primary);
}

.tags-view__tag--active {
  background: var(--color-primary-light);
  color: var(--color-primary);
  border-color: var(--el-color-primary-light-7);
  font-weight: 500;
}

.tags-view__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
}

.tags-view__tag--active .tags-view__dot {
  opacity: 1;
}

.tags-view__close {
  font-size: 12px;
  border-radius: 50%;
  padding: 1px;
}
.tags-view__close:hover {
  background: rgba(43, 92, 230, 0.15);
}

.tags-view__ops {
  padding: 4px 8px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
}
.tags-view__ops:hover {
  background: var(--bg-page);
  color: var(--color-primary);
}
</style>
