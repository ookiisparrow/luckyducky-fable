<script setup lang="ts">
// 坐席登录（口令→会话令牌·令牌只有「接待」权限）。
import { ref } from 'vue'
import { login } from './api/client'

const emit = defineEmits<{ authed: [] }>()
const password = ref('')
const busy = ref(false)
const message = ref('')

async function submit() {
  if (busy.value || !password.value) return
  busy.value = true
  message.value = ''
  const r = await login(password.value)
  busy.value = false
  if (r.ok) {
    password.value = ''
    emit('authed')
    return
  }
  const e = String(r.error || '')
  message.value =
    e === 'TOO_MANY_ATTEMPTS'
      ? `试错太多，歇 ${Number(r.retryAfter) || '几'} 秒`
      : e === 'NO_ENDPOINT'
        ? '后端地址未配置（VITE_AGENT_API）'
        : e.startsWith('NETWORK')
          ? '网络不通，请检查网络后重试'
          : e === 'AUTH_UNAVAILABLE'
            ? '登录校验服务暂时不可用，请稍后再试（不是口令的问题）'
            : e === 'CALL_TIMEOUT'
              ? '服务器太久没回话，请稍后再试'
              : e === 'BAD_JSON_RESPONSE' || r.status >= 500 // 错口令只会是 4xx；回包读不懂或 5xx 说成口令错会诱人换口令试到被锁
                ? '服务器出错了，请稍后再试（不是口令的问题）'
                : '登录被拒（' + e + '）'
}
</script>

<template>
  <div class="login">
    <div class="card">
      <h1>小棉鸭 · 坐席台</h1>
      <p class="hint">输入你的坐席口令（企微内打开可免登）</p>
      <input v-model="password" type="password" placeholder="坐席口令" @keyup.enter="submit" />
      <button :disabled="busy" @click="submit">{{ busy ? '登录中…' : '开始接待' }}</button>
      <p v-if="message" class="error">{{ message }}</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  width: 340px;
  padding: 32px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
}
h1 {
  margin: 0 0 8px;
  font-size: 19px;
  color: var(--ld-purple-ink);
}
.hint {
  font-size: 12px;
  color: var(--ld-purple-meta);
  margin: 0 0 18px;
}
input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 14px;
  margin-bottom: 12px;
}
button {
  width: 100%;
  padding: 10px 0;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
}
.error {
  margin-top: 12px;
  font-size: 12px;
  color: var(--ld-red);
}
</style>
