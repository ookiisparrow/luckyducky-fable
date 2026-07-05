<script setup lang="ts">
// 供应链顶部流程标签（旧线 components/ScmFlowTabs.vue 移植）：5 个 SCM 页是同一条流程的不同环节，
// 给一条可直接互跳的标签条，不必每次退回侧栏找。顺序单源见 lib/scmFlow.ts。
import { useRoute } from 'vue-router'
import { SCM_FLOW } from '../lib/scmFlow'

const route = useRoute()
</script>

<template>
  <nav class="scm-flow-tabs">
    <RouterLink v-for="(s, i) in SCM_FLOW" :key="s.to" :to="s.to" class="tab" :class="{ on: route.path === s.to }">
      <span class="n">{{ i + 1 }}</span>
      <component :is="s.icon" :size="14" :stroke-width="1.8" />
      <span>{{ s.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.scm-flow-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  margin-bottom: 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: 13px;
  overflow-x: auto;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
  padding: 8px 10px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-content-2);
  text-decoration: none;
  white-space: nowrap;
}
.tab:hover {
  background: var(--ld-bg-lilac);
}
.tab.on {
  background: var(--ld-purple-ink);
  color: #fff;
}
.n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-content-2);
  font-size: 10px;
}
.tab.on .n {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}
</style>
