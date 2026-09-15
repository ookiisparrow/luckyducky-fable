<script setup lang="ts">
// KPI 卡·自建原语（design/控制台.pen：label content-2 + 图标 chip bg-lilac + 值 ink 24/700）。
// 看板/对账/库存/客服等多页顶部 KPI×N 行——收敛单源。
// icon 传 lucide 组件（页面已各自 import）。无环比数据源，不编涨跌。
import type { Component } from 'vue'
withDefaults(
  defineProps<{
    label: string
    value: string | number
    icon?: Component
    tone?: 'neutral' | 'red' | 'green' | 'amber' // 值本身的语气（异常红/正向绿/警示琥珀·如净额/退款/未答复）
  }>(),
  { icon: undefined, tone: 'neutral' },
)
</script>

<template>
  <div class="kpi">
    <div class="kpi-top">
      <span class="kpi-label">{{ label }}</span>
      <span v-if="icon" class="kpi-chip"><component :is="icon" :size="15" :stroke-width="1.8" /></span>
    </div>
    <div class="kpi-value" :class="`tone-${tone}`">{{ value }}</div>
    <!-- 尾槽：放进度条/说明等卡内附加内容（如激活率进度条·真数据） -->
    <slot />
  </div>
</template>

<style scoped>
.kpi {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
}
.kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.kpi-label {
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.kpi-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg-lilac);
  color: var(--ld-brand);
}
.kpi-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--ld-ink);
  line-height: 1.1;
}
.kpi-value.tone-red {
  color: var(--ld-red);
}
.kpi-value.tone-green {
  color: var(--ld-green);
}
.kpi-value.tone-amber {
  color: var(--ld-amber);
}
</style>
