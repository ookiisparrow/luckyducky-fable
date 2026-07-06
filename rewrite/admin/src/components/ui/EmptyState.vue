<script setup lang="ts">
// 空态·自建原语（design/控制台.pen 语言·换皮期 29 页各写各的空行）。
// icon 传 lucide 组件（可选）；text 主文案；默认槽放次级说明/操作按钮。
import type { Component } from 'vue'
withDefaults(defineProps<{ icon?: Component; text: string }>(), { icon: undefined })
</script>

<template>
  <div class="empty">
    <component :is="icon" v-if="icon" class="empty-ico" :size="30" :stroke-width="1.6" />
    <p class="empty-text">{{ text }}</p>
    <div v-if="$slots.default" class="empty-extra"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 44px 20px;
  text-align: center;
}
.empty-ico {
  color: var(--ld-line-strong);
}
.empty-text {
  margin: 0;
  font-size: 13px;
  color: var(--ld-content-2);
}
.empty-extra {
  margin-top: 4px;
}
</style>
