<script setup lang="ts">
// 坐席台单屏应用：登录（口令/企微 ?code= 免登）→ 工作台。
import { ref, onMounted } from 'vue'
import { hasSession, loginByWecomCode } from './api/client'
import Login from './Login.vue'
import Desk from './Desk.vue'

const ready = ref(false)
const authed = ref(false)

onMounted(async () => {
  // 企微内打开带 ?code=：免登换令牌（失败落口令登录·不卡死）
  const code = new URLSearchParams(location.search).get('code')
  if (code && !hasSession()) await loginByWecomCode(code).catch(() => undefined)
  authed.value = hasSession()
  ready.value = true
})
</script>

<template>
  <Desk v-if="ready && authed" @logout="authed = false" />
  <Login v-else-if="ready" @authed="authed = true" />
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
