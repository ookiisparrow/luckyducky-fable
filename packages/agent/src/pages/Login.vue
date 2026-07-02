<script setup>
/**
 * 坐席登录（承面C 车道 B）· 三态（M⑦ 企微自建应用免登）：
 *  ① 企业微信自建应用内打开（UA 含 wxwork·配了 CORPID/AGENTID）→ snsapi_base 静默 OAuth 拿 code → 免登（免口令）；
 *  ② URL 带 ?code（OAuth 回跳）→ loginByWecomCode 换 session 令牌进工作台；失败落回口令登录并提示；
 *  ③ 其余（普通浏览器 / 未配企微 / 免登失败）→ 口令登录（外包账号口令 / 商户管理口令·checkKey 分身份）。
 * mock 模式：任意 ≥6 位口令即演示外包身份进入。
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { login, loginByWecomCode, useMock } from '@/api/agentApi.js'

const router = useRouter()
const password = ref('')
const err = ref('')
const busy = ref(false)
const autoBusy = ref(false) // 免登进行中（拦住口令表单闪现）

const CORPID = import.meta.env.VITE_WXWORK_CORPID || ''
const AGENTID = import.meta.env.VITE_WXWORK_AGENTID || ''
const inWecom = /wxwork/i.test(navigator.userAgent)

function readCode() {
  return new URLSearchParams(location.search).get('code') || ''
}
// 回跳后清掉 URL 上的 code/state（防刷新重复用已失效 code·保留 session 直达参数）
function stripOAuthParams() {
  const u = new URL(location.href)
  u.searchParams.delete('code')
  u.searchParams.delete('state')
  history.replaceState(null, '', u.pathname + u.search + u.hash)
}
function startWecomOAuth() {
  const redirect = encodeURIComponent(location.href.split('#')[0]) // 回跳到当前页（企微追加 ?code）
  location.href =
    `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${CORPID}` +
    `&redirect_uri=${redirect}&response_type=code&scope=snsapi_base&agentid=${AGENTID}#wechat_redirect`
}

async function submit() {
  if (busy.value) return
  busy.value = true
  err.value = ''
  const res = await login(password.value)
  busy.value = false
  if (res.ok) router.push('/desk')
  else err.value = res.error || '登录失败'
}

onMounted(async () => {
  const code = readCode()
  if (code) {
    // OAuth 回跳：换令牌免登
    autoBusy.value = true
    const res = await loginByWecomCode(code)
    stripOAuthParams()
    autoBusy.value = false
    if (res.ok) return router.push('/desk')
    err.value = (res.error || '免登失败') + '，可用口令登录' // 落回口令登录并提示
    return
  }
  // 企微内 + 已配 CORPID/AGENTID + 非 mock → 主动发起静默 OAuth（免口令）
  if (inWecom && CORPID && AGENTID && !useMock) {
    autoBusy.value = true
    startWecomOAuth()
  }
})
</script>

<template>
  <div class="login card">
    <div class="logo-badge">🦆</div>
    <h1>客服工作台</h1>
    <template v-if="autoBusy">
      <p class="sub">正在通过企业微信登录…</p>
      <p class="note">若长时间无响应，请返回后用口令登录。</p>
    </template>
    <template v-else>
      <p class="sub">Lucky Ducky · 外包坐席 / 商户超管 同门登录·按口令分身份</p>
      <label class="field-label" style="margin-top: 8px">登录口令</label>
      <input v-model="password" class="input" type="password" placeholder="外包账号口令 / 商户管理口令" @keyup.enter="submit" />
      <p v-if="err" class="err">{{ err }}</p>
      <button class="btn primary wide" :disabled="busy" @click="submit">登 录</button>
      <p class="note">
        {{
          useMock
            ? '演示（mock）模式：任意 ≥6 位口令即以演示外包身份进入，数据为内存 mock。'
            : '外包口令由商户在控制台「外包账号」页创建转交；商户管理口令登录＝超管视角（全量会话+升级件）。企业微信内打开可免口令登录。'
        }}
      </p>
    </template>
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
