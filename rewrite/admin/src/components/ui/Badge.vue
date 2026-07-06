<script setup lang="ts">
// 状态徽章·自建原语（design/控制台.pen 徽章语言：小圆角药丸·语义配色底+字）。
// 订单/退款/进销存/系统等表格里的状态标签遍地手搓——收敛单源。
// tone：neutral（灰）· brand（紫）· green（成功/在售）· red（异常/危险）· amber（预警/进行中）。
// dot=true 前置一个状态圆点（坐席在线/忙碌/离线那种）。
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'brand' | 'green' | 'red' | 'amber'
    dot?: boolean
  }>(),
  { tone: 'neutral', dot: false },
)
</script>

<template>
  <span class="badge" :class="`t-${tone}`">
    <i v-if="dot" class="badge-dot" />
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
}
.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  flex: none;
}
.t-neutral {
  background: var(--ld-bg-grey);
  color: var(--ld-content-2);
}
.t-brand {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.t-green {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.t-red {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.t-amber {
  background: var(--ld-bg-amber-soft);
  color: var(--ld-amber);
}
</style>
