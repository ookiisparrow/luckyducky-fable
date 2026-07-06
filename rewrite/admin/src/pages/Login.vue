<script setup lang="ts">
// 登录页：口令 → 云端签发会话令牌（口令用完即弃·只存令牌）。锁定/失败原文如实显示（不吞错）。
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { client } from '../api'
import UiButton from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import { KeyRound } from 'lucide-vue-next'

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
    <div class="login-box">
      <Card>
        <div class="brand">
          <span class="brand-mark">🦆</span>
          <div class="brand-lockup">
            <h1 class="brand-name">Lucky Ducky</h1>
            <span class="brand-role">运营控制台</span>
          </div>
        </div>
        <p class="hint">输入管理口令登录（登录后凭会话令牌工作，口令不会被保存）</p>
        <div class="field">
          <KeyRound :size="16" :stroke-width="1.8" class="field-icon" />
          <input
            v-model="password"
            type="password"
            placeholder="管理口令"
            @keyup.enter="submit"
          />
        </div>
        <UiButton block :disabled="busy" @click="submit">{{ busy ? '登录中…' : '登录' }}</UiButton>
        <p v-if="message" class="error">{{ message }}</p>
        <p class="agent-note">外包坐席请用<b>坐席工作台</b>登录（不是这个管理后台）——口令登不进这里是正常的。</p>
      </Card>
    </div>
  </div>
</template>

<style scoped>
/* 登录页在 Shell 外·居中卡（白卡/圆角/幸运紫语言复用 Card 原语）——以下仅本页独有。 */
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--ld-bg-lilac);
}
.login-box {
  width: 360px;
  max-width: 100%;
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}
.brand-mark {
  font-size: 34px;
  line-height: 1;
}
.brand-lockup {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.brand-name {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.3px;
  color: var(--ld-purple-ink);
}
.brand-role {
  font-size: 12.5px;
  color: var(--ld-purple-meta);
}
.hint {
  margin: 16px 0 20px;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
  color: var(--ld-purple-meta);
}
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
}
.field:focus-within {
  border-color: var(--ld-brand);
}
.field-icon {
  flex: none;
  color: var(--ld-purple-meta);
}
.field input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font: inherit;
  font-size: 14px;
  color: var(--ld-content);
}
.field input::placeholder {
  color: var(--ld-content-2);
}
.error {
  margin: 12px 0 0;
  font-size: 12px;
  text-align: center;
  color: var(--ld-red);
}
.agent-note {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--ld-line);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ld-content-2);
}
</style>
