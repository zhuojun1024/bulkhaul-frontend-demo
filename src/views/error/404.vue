<template>
  <div class="notfound">
    <div class="notfound__code">404</div>
    <p class="notfound__msg">抱歉，您访问的页面不存在或已被移除</p>
    <el-button type="primary" @click="$router.push('/workbench')">返回工作台</el-button>
  </div>
</template>

<style scoped>
.notfound {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--bg-page);
}

.notfound__code {
  font-size: 96px;
  font-weight: 800;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-400));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  line-height: 1;
}

.notfound__msg {
  color: var(--text-secondary);
  margin: 0 0 8px;
}
</style>
