<script setup>
// 加载骨架（admin·UX）：替纯文字「加载中…」。渲染 N 条 shimmer 占位条，撑住将到内容的版式、
// 减少布局跳动 + 感知更快。用法：<Skeleton v-else-if="loading" class="card" :rows="6" />
defineProps({
  rows: { type: Number, default: 6 },
  height: { type: Number, default: 40 },
})
</script>

<template>
  <div class="sk">
    <div v-for="n in rows" :key="n" class="sk-bar" :style="{ height: height + 'px' }" />
  </div>
</template>

<style scoped>
.sk {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}
.sk-bar {
  border-radius: 9px;
  background: linear-gradient(90deg, var(--bg-grey) 25%, #ededf2 37%, var(--bg-grey) 63%);
  background-size: 400% 100%;
  animation: sk-shimmer 1.4s ease infinite;
}
@keyframes sk-shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
</style>
