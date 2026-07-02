<script setup>
/**
 * 供应链顶部流程标签（用户 2026-07-02「按工作流程顺序排序·加顶部切换标签」拍板）。顺序单源见
 * utils/scmFlow.js（建档 → 算缺口 → 补料 → 产出），与左侧「供应链」导航组共用同一份数据、不重抄。
 * 6 个 SCM 页面互相是同一条流程的不同环节（非独立模块），故给一条可直接互跳的标签条，
 * 不必每次退回侧栏找——页面内本身还是各自独立路由，标签条只是导航捷径。
 */
import { useRoute } from 'vue-router'
import { SCM_FLOW } from '@/utils/scmFlow.js'

const route = useRoute()
</script>

<template>
  <nav class="scm-flow-tabs">
    <router-link
      v-for="(s, i) in SCM_FLOW"
      :key="s.to"
      :to="s.to"
      class="tab"
      :class="{ on: route.path === s.to }"
    >
      <span class="n">{{ i + 1 }}</span>
      <component :is="s.icon" :size="14" />
      <span>{{ s.label }}</span>
    </router-link>
  </nav>
</template>

<style scoped>
.scm-flow-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  margin-bottom: 18px;
  background: var(--white);
  border: 1px solid var(--line);
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
  color: var(--content-2);
  text-decoration: none;
  white-space: nowrap;
}
.tab:hover {
  background: var(--bg-lilac);
}
.tab.on {
  background: var(--purple-ink);
  color: var(--white);
}
.n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--bg-lilac);
  color: var(--content-2);
  font-size: 10px;
}
.tab.on .n {
  background: rgba(255, 255, 255, 0.22);
  color: var(--white);
}
</style>
