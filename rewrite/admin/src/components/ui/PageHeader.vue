<script setup lang="ts">
// 页头·自建原语（design/控制台.pen Header：H1 20/700 + 副标 content-2 12.5·右侧操作槽）。
// 30 页每页都有页头（换皮期各写各的 .page-head）——收敛单源，右侧放筛选/刷新/主 CTA 用默认插槽。
withDefaults(defineProps<{ title: string; sub?: string }>(), { sub: undefined })
</script>

<template>
  <header class="ph">
    <div class="ph-text">
      <h1 class="ph-title">{{ title }}</h1>
      <p v-if="sub" class="ph-sub">{{ sub }}</p>
    </div>
    <div class="ph-actions"><slot /></div>
  </header>
</template>

<style scoped>
.ph {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.ph-text {
  min-width: 0;
}
.ph-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--ld-ink);
  line-height: 1.25;
}
.ph-sub {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.ph-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
</style>
