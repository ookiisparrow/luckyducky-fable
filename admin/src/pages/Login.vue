<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login, cloudMode } from '@/api/cloud.js'

const router = useRouter()
const username = ref('')
const password = ref('')
const err = ref('')
const busy = ref(false)

async function submit() {
  if (busy.value) return
  busy.value = true
  err.value = ''
  const res = await login(username.value.trim(), password.value)
  busy.value = false
  if (res.ok) router.push('/products')
  else err.value = res.error || '登录失败'
}
</script>

<template>
  <div class="login card">
    <div class="logo-badge">🦆</div>
    <h1>Lucky Ducky 内容控制台</h1>
    <p class="sub">商品上新 · 视频上传 · 二维码卡片</p>
    <label class="field-label">账号</label>
    <input v-model="username" class="input" placeholder="管理员账号" @keyup.enter="submit" />
    <label class="field-label" style="margin-top: 12px">密码</label>
    <input v-model="password" class="input" type="password" placeholder="密码" @keyup.enter="submit" />
    <p v-if="err" class="err">{{ err }}</p>
    <button class="btn primary wide" :disabled="busy" @click="submit">登 录</button>
    <p class="note">
      {{
        cloudMode
          ? '云端模式：密码即管理口令（至少 6 位）；首次登录设置口令，之后须凭同一口令进入'
          : '本地演示模式：任意非空账号密码可进入；数据保存在本浏览器'
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
  margin: 0 0 22px;
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
