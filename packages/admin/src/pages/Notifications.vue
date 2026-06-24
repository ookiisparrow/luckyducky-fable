<script setup>
/**
 * 消息与通知（S17·设置页）。把已建好的「企微告警」后端配置 UI 补上——此前钱链告警推送
 * （kit/observe.notifyAlert + adminConfig.settings.alertWebhook/alertEvents）后端已落地，
 * 但 owner 没有界面贴 webhook（企微告警#8「剩靠人」）。本页就是那个界面。
 *
 * 诚实范围：只暴露后端**真正会推**的 5 个钱链告警码（notifyAlert 实际调用点）作为开关；
 * 设计稿里更丰富的告警（新订单/待发货堆积/库存预警/日报）与微信订阅消息（发货/物流/激活/完课
 * 提醒）后端尚未接入，不做假开关——以「规划中·未接入」如实标注（根因#8）。
 */
import { ref, computed } from 'vue'
import { cloudMode, getSettings, saveSettings } from '@/api/cloud.js'

// 后端 notifyAlert 实际会推的钱链告警码（alertEvents[code]===false 才不推·默认全开）
const ALERT_EVENTS = [
  ['UNKNOWN_ORDER', '收款无单', '收到付款却找不到订单（疑似掉单）'],
  ['WX_SHIP_UPLOAD_FAIL', '发货上传失败', '发货信息上传微信失败（不处理资金可能冻结）'],
  ['UNKNOWN_AFTERSALE', '退款无单', '退款通知找不到对应售后单'],
  ['MISMATCH', '退款不符', '退款单号或金额对不上（已拒绝置已退款）'],
  ['NOT_SUCCESS', '退款未成功', '微信返回退款未成功'],
]
const WEBHOOK_RE = /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]+$/

const webhook = ref('')
const events = ref({}) // code -> bool
const loading = ref(true)
const loadErr = ref('')
const saving = ref(false)
const saveMsg = ref('')

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const s = await getSettings()
    webhook.value = s.alertWebhook || ''
    const ev = s.alertEvents || {}
    const m = {}
    for (const [code] of ALERT_EVENTS) m[code] = ev[code] !== false // 默认开
    events.value = m
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

const webhookValid = computed(() => !webhook.value.trim() || WEBHOOK_RE.test(webhook.value.trim()))
const pushOn = computed(() => !!webhook.value.trim() && webhookValid.value)

async function save() {
  if (saving.value) return
  saveMsg.value = ''
  const w = webhook.value.trim()
  if (w && !WEBHOOK_RE.test(w)) {
    saveMsg.value = 'webhook 格式不对（应形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…）'
    return
  }
  saving.value = true
  try {
    const ok = await saveSettings({ alertWebhook: w, alertEvents: { ...events.value } })
    saveMsg.value = ok ? '✓ 已保存' : '保存失败（请检查 webhook 格式）'
  } catch (e) {
    saveMsg.value = '保存失败：' + e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>消息与通知</h1>
        <p class="sub">钱链出问题时自动推到你的企业微信群 · 手机实时收，不用盯控制台</p>
      </div>
      <button class="btn primary" :disabled="saving || loading" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">消息通知设置需云端模式。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <template v-else>
      <!-- 企微群机器人告警（推给你·后端已接） -->
      <div class="card sec">
        <div class="sec-head">
          <div>
            <h3>企业微信告警 <span class="tag-on">推给你</span></h3>
            <p class="sec-sub">钱链异常（收款无单 / 退款异常 / 发货上传失败）自动推一条到企微群机器人。</p>
          </div>
          <span class="chip" :class="pushOn ? 'green' : 'grey'">{{ pushOn ? '已开启推送' : '未推送（仅记日志）' }}</span>
        </div>

        <label class="field-label">企业微信群机器人 Webhook</label>
        <input
          v-model="webhook"
          class="input"
          :class="{ bad: !webhookValid }"
          placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=……"
        />
        <p class="tip">
          群设置 → 群机器人 → 添加 → 复制 Webhook 地址粘贴到这里。留空 = 不推送（异常仍记云端日志）。
          <span v-if="!webhookValid" class="err">· 格式不对</span>
        </p>

        <div class="evs">
          <p class="evs-cap">推送事件（这些异常需人工尽快处理，建议全开）</p>
          <label v-for="[code, label, desc] in ALERT_EVENTS" :key="code" class="ev">
            <span class="ev-txt"><b>{{ label }}</b><em>{{ desc }}</em></span>
            <input v-model="events[code]" type="checkbox" class="sw" :disabled="!pushOn" />
          </label>
        </div>
      </div>

      <!-- 规划中·未接入（如实标注，不做假开关） -->
      <div class="card sec planned">
        <h3>更多通知 <span class="tag-soon">规划中 · 本期未接入</span></h3>
        <p class="sec-sub">以下需后端接入对应触发/能力，暂未上线，先列出路线、不做假开关：</p>
        <ul class="plan-list">
          <li><b>更多企微告警</b>：新订单提醒、待发货堆积、库存预警/售罄、每日运营日报。</li>
          <li>
            <b>微信订阅消息（推给买家）</b>：发货通知、物流更新、激活提醒、完课勉励、复购召回——需小程序订阅消息能力
            + 买家下单时一次性授权，是「少客服查单、救激活漏点」的关键，规划中。
          </li>
        </ul>
      </div>

      <p v-if="saveMsg" class="savemsg" :class="{ ok: saveMsg.startsWith('✓') }">{{ saveMsg }}</p>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
h1 {
  font-size: 22px;
  color: var(--ink);
  margin: 0 0 5px;
}
.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--content-2);
}
.sec {
  padding: 20px 22px;
  margin-bottom: 18px;
}
.sec-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.sec h3 {
  font-size: 15px;
  color: var(--ink);
  margin: 0 0 5px;
}
.sec-sub {
  margin: 0;
  font-size: 12px;
  color: var(--content-2);
  max-width: 560px;
  line-height: 1.5;
}
.tag-on {
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-active);
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  border-radius: var(--r-pill);
  padding: 1px 8px;
  margin-left: 4px;
}
.tag-soon {
  font-size: 11px;
  font-weight: 600;
  color: var(--content-2);
  background: var(--bg-grey);
  border-radius: var(--r-pill);
  padding: 1px 8px;
  margin-left: 4px;
}
.input.bad {
  border-color: #f0c8c5;
}
.tip {
  margin: 7px 0 0;
  font-size: 11.5px;
  color: var(--content-2);
  line-height: 1.5;
}
.tip .err {
  color: var(--red);
}
.evs {
  margin-top: 18px;
  border-top: 1px solid var(--line);
  padding-top: 14px;
}
.evs-cap {
  margin: 0 0 6px;
  font-size: 11.5px;
  color: var(--purple-meta);
}
.ev {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
}
.ev + .ev {
  border-top: 1px solid var(--line);
}
.ev-txt {
  display: flex;
  flex-direction: column;
  line-height: 1.45;
}
.ev-txt b {
  color: var(--ink);
  font-size: 13px;
}
.ev-txt em {
  font-style: normal;
  color: var(--content-2);
  font-size: 11.5px;
}
.sw {
  width: 18px;
  height: 18px;
  accent-color: var(--brand);
  flex: 0 0 auto;
}
.sw:disabled {
  opacity: 0.4;
}
.planned {
  background: var(--bg-lilac);
}
.plan-list {
  margin: 10px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--content);
  line-height: 1.7;
}
.plan-list b {
  color: var(--ink);
}
.savemsg {
  font-size: 12.5px;
  color: var(--red);
  margin: 4px 0 0;
}
.savemsg.ok {
  color: var(--green);
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
</style>
