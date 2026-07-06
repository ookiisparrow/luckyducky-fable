<script setup lang="ts">
// 系统设置（设计语言一致性·M3 UI 批13）：告警推送 webhook（企微群机器人·空=清除退回纯日志）+ 激活码 urlPrefix。
// 逻辑未动，仅套设计语言。激活卡双面设计器（印刷用）随印刷批补——记待办。
import { ref, computed, onMounted } from 'vue'
import { getSettings, saveSettings } from '../api/system'
import { webhookOk } from '../lib/mapSystem'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import { ChevronRight } from 'lucide-vue-next'

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
  <div class="ld-page">
    <PageHeader title="系统设置" sub="钱链告警推送与激活码链接前缀 · 改动保存后立即生效">
      <UiButton :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</UiButton>
    </PageHeader>

    <p v-if="message" class="status" :class="{ ok }">{{ message }}</p>

    <div class="ld-cols-2">
      <Card title="激活码">
        <div class="field">
          <label class="field-label">链接前缀（印刷二维码用）</label>
          <input v-model="urlPrefix" placeholder="https://…" />
          <p class="field-note">激活卡双面设计器（印刷排版）随印刷批补齐。</p>
        </div>
      </Card>

      <Card title="钱链告警推送">
        <template #head>
          <Badge :tone="pushing ? 'green' : 'neutral'" dot>{{ pushing ? '已开启推送' : '未推送·仅记日志' }}</Badge>
        </template>
        <div class="field">
          <label class="field-label">企业微信群机器人 webhook</label>
          <input v-model="alertWebhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" />
          <p class="field-note">留空 = 只记日志、不推送。</p>
        </div>
      </Card>
    </div>

    <Card title="推送事件" sub="关掉的事件只记日志不推群 · 无 webhook 时开关不生效">
      <div class="events" :class="{ muted: !pushing }">
        <div v-for="e in EVENTS" :key="e.code" class="ev">
          <span class="ev-label">{{ e.label }}</span>
          <button
            class="switch"
            :class="{ on: enabled(e.code) }"
            :disabled="!pushing"
            @click="toggleEvent(e.code)"
          >
            <span class="knob"></span>
          </button>
        </div>
      </div>
      <p v-if="!pushing" class="field-note ev-note">
        先填 webhook 才能逐事件开关（无 webhook 时只记日志、开关不生效）。
      </p>
    </Card>

    <!-- 规划中·未接入（诚实披露·不做假开关；native details 折叠·无需额外状态） -->
    <details class="roadmap">
      <summary><ChevronRight class="chev" :size="14" />规划中（未接入 · 不做假开关）</summary>
      <p>更多企微告警维度（库存预警日报 / 会话堆积）· 面向买家的微信订阅消息（发货 / 物流 / 激活 / 完课 / 复购）——需通知偏好后端字段，后端就绪后再逐项接入，当前不占位假开关。</p>
    </details>

    <p class="hint">事件开关存 <code>alertEvents</code>（后端合并保存 · 不抹已设 webhook）。</p>
  </div>
</template>

<style scoped>
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status.ok {
  color: var(--ld-green);
}

/* 表单字段（design Box：label 12/600 + 输入框圆角8·描边） */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ld-content-2);
}
.field input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  font: inherit;
  font-size: 13px;
  color: var(--ld-content);
}
.field input::placeholder {
  color: var(--ld-content-2);
}
.field input:focus {
  outline: none;
  border-color: var(--ld-purple-line);
}
.field-note {
  margin: 2px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ld-content-2);
}

/* 事件推送开关（逐事件·gated on webhook·行底分线） */
.events {
  display: flex;
  flex-direction: column;
}
.events.muted {
  opacity: 0.55;
}
.ev {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--ld-line);
}
.ev:last-child {
  border-bottom: none;
}
.ev-label {
  font-size: 13px;
  color: var(--ld-content);
}
.ev-note {
  margin-top: 12px;
}

/* 开关（沿用控制台开关语言：off 灰轨·on brand·白钮） */
.switch {
  width: 36px;
  height: 20px;
  border-radius: 99px;
  border: none;
  background: var(--ld-line-strong);
  position: relative;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 0.15s;
}
.switch.on {
  background: var(--ld-brand);
}
.switch:disabled {
  cursor: not-allowed;
}
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--ld-bg);
  transition: left 0.15s;
}
.switch.on .knob {
  left: 18px;
}

/* 规划中折叠（未接入·诚实披露） */
.roadmap {
  border: 1px dashed var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  padding: 12px 14px;
  background: var(--ld-bg-lilac);
}
.roadmap summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-content-2);
  cursor: pointer;
  list-style: none;
}
.roadmap summary::-webkit-details-marker {
  display: none;
}
.chev {
  color: var(--ld-content-2);
  transition: transform 0.15s;
}
.roadmap[open] .chev {
  transform: rotate(90deg);
}
.roadmap p {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--ld-content-2);
}

.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ld-content-2);
}
.hint code {
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
  color: var(--ld-content);
}
</style>
