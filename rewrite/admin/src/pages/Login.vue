<script setup lang="ts">
// 登录页：口令 → 云端签发会话令牌（口令用完即弃·只存令牌）。锁定/失败原文如实显示（不吞错）。
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { client } from '../api'

const router = useRouter()
const password = ref('')
const busy = ref(false)
const message = ref('')

async function submit() {
  if (busy.value || !password.value) return
  busy.value = true
  message.value = ''
  const r = await client.login(password.value)
  busy.value = false
  if (r.ok) {
    password.value = ''
    void router.push('/')
    return
  }
  const e = String(r.error || '')
  message.value =
    e === 'TOO_MANY_ATTEMPTS'
      ? `试错太多次，先歇 ${Number(r.retryAfter) || '几'} 秒`
      : e === 'NO_ENDPOINT'
        ? '后端地址未配置（VITE_ADMIN_API）'
        : e.startsWith('NETWORK')
          ? '网络不通：' + e
          : '口令不对或登录被拒（' + e + '）'
}
</script>

<template>
  <div class="login">
    <div class="card">
      <h1>小棉鸭 · 管理控制台</h1>
      <p class="hint">输入管理口令登录（登录后凭会话令牌工作，口令不会被保存）</p>
      <input v-model="password" type="password" placeholder="管理口令" @keyup.enter="submit" />
      <button :disabled="busy" @click="submit">{{ busy ? '登录中…' : '登录' }}</button>
      <p v-if="message" class="error">{{ message }}</p>
      <p class="agent-note">外包坐席请用<b>坐席工作台</b>登录（不是这个管理后台）——口令登不进这里是正常的。</p>
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
  width: 360px;
  padding: 32px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
}
h1 {
  margin: 0 0 8px;
  font-size: 20px;
  color: var(--ld-purple-ink);
}
.hint {
  font-size: 12px;
  color: var(--ld-purple-meta);
  margin: 0 0 20px;
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
.agent-note {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--ld-line);
  font-size: 11.5px;
  color: var(--ld-content-2);
  line-height: 1.5;
}
</style>
