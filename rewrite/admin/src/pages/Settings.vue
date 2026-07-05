<script setup lang="ts">
// 系统设置（设计语言一致性·M3 UI 批13）：告警推送 webhook（企微群机器人·空=清除退回纯日志）+ 激活码 urlPrefix。
// 逻辑未动，仅套设计语言。激活卡双面设计器（印刷用）随印刷批补——记待办。
import { ref, computed, onMounted } from 'vue'
import { getSettings, saveSettings } from '../api/system'
import { webhookOk } from '../lib/mapSystem'

// 钱链告警事件开关（换皮把 webhook 迁进 Settings 但删了 5+ 事件粒度开关·alertEvents 后端字段悬空·B6 证伪 saveSettings 合并保存不抹）
const EVENTS = [
  { code: 'UNKNOWN_ORDER', label: '收款无单（款到账却找不到订单）' },
  { code: 'PAID_BUT_OOS', label: '付款售罄（款到但库存已空·待退款）' },
  { code: 'WX_SHIP_UPLOAD_FAIL', label: '发货上传微信失败（合规·资金冻结风险）' },
  { code: 'UNKNOWN_AFTERSALE', label: '退款无单（回调找不到售后单）' },
  { code: 'MISMATCH', label: '退款金额不符' },
  { code: 'NOT_SUCCESS', label: '退款未成功' },
]
const alertWebhook = ref('')
const urlPrefix = ref('')
const events = ref<Record<string, boolean>>({}) // code → false=静音（不在表=开启）
const message = ref('')
const ok = ref(false)
const busy = ref(false)

const pushing = computed(() => webhookOk(alertWebhook.value.trim()) && !!alertWebhook.value.trim())
const enabled = (code: string) => events.value[code] !== false
function toggleEvent(code: string) {
  events.value = { ...events.value, [code]: !enabled(code) }
}

onMounted(async () => {
  const r = await getSettings()
  if (r.ok && r.settings) {
    const s = r.settings as Record<string, any>
    alertWebhook.value = String(s.alertWebhook || '')
    urlPrefix.value = String(s.urlPrefix || '')
    events.value = s.alertEvents && typeof s.alertEvents === 'object' ? { ...s.alertEvents } : {}
  } else if (!r.ok) message.value = '加载失败：' + String(r.error || '')
})

async function save() {
  if (busy.value) return
  ok.value = false
  if (!webhookOk(alertWebhook.value.trim())) {
    message.value = 'webhook 形态不对（须是企微群机器人地址，或留空清除）'
    return
  }
  busy.value = true
  const r = await saveSettings({ alertWebhook: alertWebhook.value.trim(), urlPrefix: urlPrefix.value.trim(), alertEvents: events.value })
  busy.value = false
  if (r.ok) {
    ok.value = true
    message.value = '已保存'
  } else {
    message.value = String(r.error) === 'BAD_WEBHOOK' ? 'webhook 被云端拒绝（形态不对）' : '保存失败：' + String(r.error || '')
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>系统设置</h1>
      <p class="sub">钱链告警推送与激活码链接前缀。改动保存后立即生效。</p>
    </header>

    <p v-if="message" class="status" :class="{ ok }">{{ message }}</p>

    <section class="card">
      <h2>钱链告警推送</h2>
      <div class="field">
        <label>企业微信群机器人 webhook（留空 = 只记日志、不推送）
          <span class="push-chip" :class="pushing ? 'on' : 'off'">{{ pushing ? '已开启推送' : '未推送·仅记日志' }}</span>
        </label>
        <input v-model="alertWebhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" />
      </div>

      <div class="field">
        <label>推送哪些事件（关掉的事件只记日志不推群；无 webhook 时开关不生效）</label>
        <div class="events" :class="{ muted: !pushing }">
          <label v-for="e in EVENTS" :key="e.code" class="ev">
            <input type="checkbox" :checked="enabled(e.code)" @change="toggleEvent(e.code)" />
            <span>{{ e.label }}</span>
          </label>
        </div>
      </div>

      <div class="field">
        <label>激活码链接前缀（印刷二维码用）</label>
        <input v-model="urlPrefix" placeholder="https://…" />
      </div>
      <button class="btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</button>
      <p class="hint">激活卡双面设计器（印刷排版）随印刷批补齐。事件开关存 `alertEvents`（后端合并保存·不抹已设 webhook）。</p>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 700px;
}
.page-head {
  margin-bottom: 16px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--ld-ink);
}
.sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
  margin-bottom: 12px;
}
.status.ok {
  color: var(--ld-green);
}
.card {
  padding: 18px 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
h2 {
  margin: 0 0 14px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
.field {
  margin-bottom: 14px;
}
.field label {
  display: block;
  font-size: 12px;
  color: var(--ld-content-2);
  margin-bottom: 5px;
}
input {
  display: block;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
}
.btn-primary {
  padding: 9px 24px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.5;
}
.hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--ld-content-2);
}
.push-chip {
  margin-left: 8px;
  padding: 1px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
}
.push-chip.on {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.push-chip.off {
  background: var(--ld-bg-faint);
  color: var(--ld-content-2);
}
.events {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  background: var(--ld-bg-lilac);
}
.events.muted {
  opacity: 0.55;
}
.ev {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12.5px;
  color: var(--ld-content);
  cursor: pointer;
}
.ev input {
  width: 16px;
  height: 16px;
  accent-color: var(--ld-brand);
}
</style>
