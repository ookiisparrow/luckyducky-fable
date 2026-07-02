<script setup>
/**
 * 外包坐席登录（承面C 车道 B·B1）。复用 adminApi 口令校验（checkKey）：外包账号以 outsourced 角色登录，
 * 须具备坐席台能力位 agent:handle 才放行（agentApi.login 内校验·§1 定稿外包最小权）。
 * mock 模式下任意 ≥6 位口令即以演示外包身份进入。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login, useMock } from '@/api/agentApi.js'

const router = useRouter()
const password = ref('')
const err = ref('')
const busy = ref(false)

async function submit() {
  if (busy.value) return
  busy.value = true
  err.value = ''
  const res = await login(password.value)
  busy.value = false
  if (res.ok) router.push('/desk')
  else err.value = res.error || '登录失败'
}
</script>

<template>
  <div class="login card">
    <div class="logo-badge">🦆</div>
    <h1>客服工作台</h1>
    <p class="sub">Lucky Ducky · 外包坐席 / 商户超管 同门登录·按口令分身份</p>
    <label class="field-label" style="margin-top: 8px">登录口令</label>
    <input v-model="password" class="input" type="password" placeholder="外包账号口令 / 商户管理口令" @keyup.enter="submit" />
    <p v-if="err" class="err">{{ err }}</p>
    <button class="btn primary wide" :disabled="busy" @click="submit">登 录</button>
    <p class="note">
      {{
        useMock
          ? '演示（mock）模式：任意 ≥6 位口令即以演示外包身份进入，数据为内存 mock。'
          : '外包口令由商户在控制台「外包账号」页创建转交；商户管理口令登录＝超管视角（全量会话+升级件）。'
      }}
    </p>
  </div>
</template>

<style scoped>
.login {
  width: 360px;
  padding: 36px 32px;
  display: flex;
  flex-direction: column;
}
.logo-badge {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  margin-bottom: 14px;
}
h1 {
  font-size: 18px;
  color: var(--ink);
  margin: 0 0 4px;
}
.sub {
  font-size: 12px;
  color: var(--content-2);
  margin: 0 0 12px;
}
.err {
  color: var(--red);
  font-size: 12px;
  margin: 8px 0 0;
}
.wide {
  justify-content: center;
  margin-top: 18px;
}
.note {
  font-size: 11px;
  color: var(--content-2);
  margin: 14px 0 0;
  line-height: 1.6;
}
</style>
