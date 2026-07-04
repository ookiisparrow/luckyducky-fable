<script setup lang="ts">
// 根组件：只挂路由出口（登录/壳布局由路由决定）。
</script>

<template>
  <router-view />
</template>

<style>
:root {
  --ld-purple: #a371ea;
  --ld-purple-tab: #7b5caf;
  --ld-purple-meta: #7e6e96;
  --ld-purple-line: #c9bbe0;
  --ld-purple-ink: #241733;
  --ld-ink: #222222;
  --ld-bg: #ffffff;
  --ld-bg-lilac: #fcfaff;
  --ld-bg-faint: #fafafa;
  --ld-radius: 12px;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: var(--ld-bg-lilac);
  color: var(--ld-ink);
}
</style>
