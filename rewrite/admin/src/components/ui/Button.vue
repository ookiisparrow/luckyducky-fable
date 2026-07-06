<script setup lang="ts">
// 填充按钮·自建原语单源（收敛 admin UI·病根#5 样板复制即漂移）。
// 视觉对齐 design/控制台.pen：primary=幸运紫 brand 填充·圆角 8·白字 600（旧态是 purple-ink 药丸·随新设计重写换掉）。
// 页面禁再手搓填充按钮（守卫 rw-admin-btn-single-source 扫 pages/·本组件不在其扫描面 = 唯一合法处）。
// variant：primary（主 CTA·brand 底）· ghost（次操作·白底描边）· danger（危险·红底）。
// 属性（@click / :disabled / type / title / class）经单根 <button> 原生穿透。
withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg' // sm 紧凑（行内操作）· md 标准（默认）· lg 大 CTA（抽屉底/发布）
    variant?: 'primary' | 'ghost' | 'danger'
    block?: boolean // 整宽（抽屉底 CTA / 登录）
  }>(),
  { size: 'md', variant: 'primary', block: false },
)
</script>

<template>
  <button class="ui-btn" :class="[`is-${size}`, `v-${variant}`, { 'is-block': block }]">
    <slot />
  </button>
</template>

<style scoped>
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: none;
  border: 1px solid transparent;
  border-radius: var(--ld-radius-sm);
  font-family: inherit;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition:
    opacity 0.15s,
    background 0.15s;
}
.ui-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* 变体 */
.v-primary {
  background: var(--ld-brand);
  color: #fff;
}
.v-ghost {
  background: var(--ld-bg);
  border-color: var(--ld-line);
  color: var(--ld-content);
}
.v-ghost:hover:not(:disabled) {
  border-color: var(--ld-purple-line);
  color: var(--ld-purple-ink);
  opacity: 1;
}
.v-danger {
  background: var(--ld-red);
  color: #fff;
}
/* 尺寸 */
.is-sm {
  padding: 6px 12px;
  font-size: 12px;
}
.is-md {
  padding: 8px 16px;
  font-size: 13px;
}
.is-lg {
  padding: 10px 20px;
  font-size: 13.5px;
}
.is-block {
  display: flex;
  width: 100%;
}
</style>
