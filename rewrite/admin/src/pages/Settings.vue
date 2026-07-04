<script setup lang="ts">
// 系统设置（M3 批6）：告警推送 webhook（企微群机器人·空=清除退回纯日志）+ 激活码 urlPrefix。
// 激活卡双面设计器（印刷用）随印刷批补——记待办。
import { ref, onMounted } from 'vue'
import { getSettings, saveSettings } from '../api/system'
import { webhookOk } from '../lib/mapSystem'

const alertWebhook = ref('')
const urlPrefix = ref('')
const message = ref('')
const busy = ref(false)

onMounted(async () => {
  const r = await getSettings()
  if (r.ok && r.settings) {
    const s = r.settings as Record<string, any>
    alertWebhook.value = String(s.alertWebhook || '')
    urlPrefix.value = String(s.urlPrefix || '')
  } else if (!r.ok) message.value = '加载失败：' + String(r.error || '')
})

async function save() {
  if (busy.value) return
  if (!webhookOk(alertWebhook.value.trim())) {
    message.value = 'webhook 形态不对（须是企微群机器人地址，或留空清除）'
    return
  }
  busy.value = true
  const r = await saveSettings({ alertWebhook: alertWebhook.value.trim(), urlPrefix: urlPrefix.value.trim() })
  busy.value = false
  message.value = r.ok ? '已保存' : String(r.error) === 'BAD_WEBHOOK' ? 'webhook 被云端拒绝（形态不对）' : '保存失败：' + String(r.error || '')
}
</script>

<template>
  <div>
    <h2>系统设置</h2>
    <p v-if="message" class="status">{{ message }}</p>
    <div class="panel">
      <label>钱链告警推送（企微群机器人 webhook·留空=只记日志不推送）
        <input v-model="alertWebhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" />
      </label>
      <label>激活码链接前缀（印刷二维码用）
        <input v-model="urlPrefix" placeholder="https://…" />
      </label>
      <button class="act" :disabled="busy" @click="save">保存</button>
      <p class="hint">激活卡双面设计器（印刷排版）随印刷批补齐。</p>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
.status {
  font-size: 13px;
  color: #c0392b;
}
.panel {
  padding: 16px 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 640px;
}
label {
  display: block;
  font-size: 12px;
  color: var(--ld-purple-meta);
  margin-bottom: 14px;
}
input {
  display: block;
  width: 100%;
  padding: 8px 10px;
  margin-top: 4px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
}
.hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--ld-purple-meta);
}
.act {
  padding: 8px 24px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.act:disabled {
  opacity: 0.5;
}
</style>
