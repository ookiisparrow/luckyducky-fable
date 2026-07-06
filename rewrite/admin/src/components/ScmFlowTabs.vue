<script setup lang="ts">
// 供应链顶部流程标签（旧线 components/ScmFlowTabs.vue 移植）：5 个 SCM 页是同一条流程的不同环节，
// 给一条可直接互跳的标签条，不必每次退回侧栏找。顺序单源见 lib/scmFlow.ts。
import { useRoute } from 'vue-router'
import { SCM_FLOW } from '../lib/scmFlow'

const route = useRoute()
</script>

<template>
  <nav class="ld-toolbar scm-flow-tabs">
    <RouterLink
      v-for="(s, i) in SCM_FLOW"
      :key="s.to"
      :to="s.to"
      class="ld-chip"
      :class="{ on: route.path === s.to }"
    >
      <span class="step-n">{{ i + 1 }}</span>
      <component :is="s.icon" :size="14" :stroke-width="1.8" />
      <span>{{ s.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
/* flow-specific：给流程胶囊加序号徽标（.ld-toolbar/.ld-chip.on 走全局 kit） */
.scm-flow-tabs .ld-chip {
  text-decoration: none;
}
.step-n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-content-2);
  font-size: 10px;
  font-weight: 600;
}
.ld-chip.on .step-n {
  background: var(--ld-purple-line);
  color: var(--ld-purple-ink);
}
</style>
