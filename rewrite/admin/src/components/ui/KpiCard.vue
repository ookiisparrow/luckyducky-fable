<script setup lang="ts">
// KPI 卡·自建原语（design/控制台.pen：label content-2 + 图标 chip bg-lilac + 值 ink 24/700 + 环比 delta 绿↑/红↓）。
// 看板/对账/库存/客服等多页顶部 KPI×N 行——收敛单源。
// icon 传 lucide 组件（页面已各自 import）；delta 传数值文案 + dir，dir 决定颜色与三角。
import { TrendingUp, TrendingDown, Minus } from 'lucide-vue-next'
import type { Component } from 'vue'
withDefaults(
  defineProps<{
    label: string
    value: string | number
    icon?: Component
    delta?: string // 环比文案，如「+12.4% 环比」
    dir?: 'up' | 'down' | 'flat' // 决定 delta 配色与图标
    tone?: 'neutral' | 'red' | 'green' | 'amber' // 值本身的语气（异常红/正向绿/警示琥珀·如净额/退款/未答复）
  }>(),
  { icon: undefined, delta: undefined, dir: 'flat', tone: 'neutral' },
)
const DELTA_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus }
</script>

<template>
  <div class="kpi">
    <div class="kpi-top">
      <span class="kpi-label">{{ label }}</span>
      <span v-if="icon" class="kpi-chip"><component :is="icon" :size="15" :stroke-width="1.8" /></span>
    </div>
    <div class="kpi-value" :class="`tone-${tone}`">{{ value }}</div>
    <div v-if="delta" class="kpi-delta" :class="dir">
      <component :is="DELTA_ICON[dir]" :size="14" :stroke-width="1.9" />
      <span>{{ delta }}</span>
    </div>
    <!-- 尾槽：放进度条/说明等卡内附加内容（如激活率进度条·真数据·不编环比） -->
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
.kpi-delta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
}
.kpi-delta.up {
  color: var(--ld-green);
}
.kpi-delta.down {
  color: var(--ld-red);
}
.kpi-delta.flat {
  color: var(--ld-content-2);
}
</style>
