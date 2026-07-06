<script setup lang="ts">
// 主操作按钮·自建原语单源（收敛 admin UI 批1·病根#5 样板复制即漂移）。
// 旧态：23 页各写各的 .btn-primary/.act/.confirm/.approve-btn…，填充色在 --ld-purple-ink↔--ld-brand
// 间漂移（Inspect 曾用 brand·其余 purple-ink）。填充主按钮的样式此后单源在这——页面禁再手搓
// （守卫 rw-admin-btn-single-source 扫 pages/，本组件不在其扫描面 = 唯一合法处）。
// 变体只做 primary（当前唯一有证据的填充按钮）；ghost/danger 待其迁移批到时再加 variant，不投机预留。
// 属性（@click / :disabled / type / title / class）经单根 <button> 原生穿透。
withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg' // sm 紧凑（原 .act/.search-btn）· md 标准（原 .btn-primary）· lg 大 CTA（原 .confirm/.approve-btn）
    block?: boolean // 整宽（抽屉底 CTA / 登录）
  }>(),
  { size: 'md', block: false },
)
</script>

<template>
  <button class="ui-btn" :class="[`is-${size}`, { 'is-block': block }]">
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
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-family: inherit;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition: opacity 0.15s;
}
.ui-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.is-sm {
  padding: 6px 14px;
  font-size: 12.5px;
}
.is-md {
  padding: 10px 18px;
  font-size: 13px;
}
.is-lg {
  padding: 12px 20px;
  font-size: 14px;
}
.is-block {
  display: flex;
  width: 100%;
}
</style>
