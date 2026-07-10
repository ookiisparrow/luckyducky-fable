<script setup lang="ts">
// 坐席台单屏应用：登录（口令/企微 ?code= 免登）→ 工作台。
import { ref, onMounted } from 'vue'
import { hasSession, loginByWecomCode, logout, onSessionLost } from './api/client'
import Login from './Login.vue'
import Desk from './Desk.vue'

const ready = ref(false)
const authed = ref(false)

// 会话失效集中导登录（单源·根因#5·对照 admin router.ts 同构移植）：client.post 遇无令牌/401 触发此回调，
// 壳层统一登出回登录视图——Desk.vue 内各会话敏感动作（pollThread/send/act/claim/setStatus）不再需要
// 各自显式判 SESSION_LOST 才能导登录（原先只有 refreshLists 有此判断，其余散点会卡在失效态）。
onSessionLost(() => {
  logout()
  authed.value = false
})

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
  --ld-purple-tab: #865dc0; /* 同步 admin tokens.css --ld-brand-active（守卫 rw-agent-tokens-synced 补捉的漂移：原 #7b5caf 与 admin 真值不符） */
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
