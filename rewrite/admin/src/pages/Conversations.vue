<script setup lang="ts">
// 客服会话（设计语言一致性·M3 UI 批13）：按客户检索时间轴 + 质检报表（样本口径诚实标注）。
// 逻辑未动，仅套设计语言（页头/统计卡/检索卡/消息气泡时间轴/token）。
import { ref, onMounted } from 'vue'
import { Search, RotateCcw } from 'lucide-vue-next'
import { searchConversations, conversationsReport } from '../api/cs'
import { mapMessages, mapReport, type MsgVM, type ReportVM } from '../lib/mapCs'
import UiButton from '../components/ui/Button.vue'

const openid = ref('')
const externalUserId = ref('')
const keyword = ref('')
const msgs = ref<MsgVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const searched = ref(false)
const report = ref<ReportVM | null>(null)
const message = ref('')
const slaMin = ref(30) // 首响 SLA 阈值（分钟·换皮丢了可调·报表按此算超 SLA）
const reportBusy = ref(false)

async function loadReport() {
  reportBusy.value = true
  const r = await conversationsReport(slaMin.value > 0 ? slaMin.value * 60000 : undefined)
  reportBusy.value = false
  report.value = mapReport(r)
}

async function search() {
  message.value = '检索中…'
  const r = await searchConversations({ openid: openid.value.trim() || undefined, externalUserId: externalUserId.value.trim() || undefined, keyword: keyword.value.trim() || undefined })
  msgs.value = r.ok ? mapMessages(r.messages) : []
  cursor.value = r.ok ? r.nextCursor : null
  hasMore.value = !!(r.ok && r.hasMore)
  searched.value = true
  message.value = r.ok ? (msgs.value.length ? '' : '没有匹配的会话') : '检索失败：' + String(r.error || '')
}

async function more() {
  if (!hasMore.value || cursor.value == null) return
  const r = await searchConversations({ openid: openid.value.trim() || undefined, externalUserId: externalUserId.value.trim() || undefined, keyword: keyword.value.trim() || undefined, cursor: cursor.value })
  if (!r.ok) return
  msgs.value = [...msgs.value, ...mapMessages(r.messages)]
  cursor.value = r.nextCursor
  hasMore.value = !!r.hasMore
}

onMounted(loadReport)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>客服会话</h1>
      <p class="sub">按客户检索会话时间轴 + 质检报表（样本口径如实标注，不夸大覆盖）。</p>
    </header>

    <div v-if="report" class="report">
      <div class="report-head">
        <h2>质检报表</h2>
        <span class="note">{{ report.sampleNote }}</span>
        <span class="flex"></span>
        <label class="sla-in">首响 SLA <input v-model.number="slaMin" type="number" min="1" max="1440" /> 分钟</label>
        <button class="sla-btn" :disabled="reportBusy" @click="loadReport"><RotateCcw :size="13" :stroke-width="1.8" />{{ reportBusy ? '算中…' : '重算' }}</button>
      </div>
      <div class="stat-grid">
        <div v-for="s in [...report.volume, ...report.response, ...report.sla]" :key="s.label" class="stat-card" :class="{ bad: s.bad }">
          <div class="stat-label">{{ s.label }}</div>
          <div class="stat-value">{{ s.value }}</div>
        </div>
      </div>
      <!-- 首响口径诚实告知（换皮丢·防把机器人秒回误读成人工绩效） -->
      <p class="report-note">首次响应含机器人自动应答；人工接待时长待落档后单列，届时更真实反映坐席绩效。</p>
    </div>

    <section class="card">
      <h2>会话检索（按客户）</h2>
      <div class="searchrow">
        <input v-model="openid" placeholder="openid" @keyup.enter="search" />
        <input v-model="externalUserId" placeholder="或 外部用户号（未绑定时）" @keyup.enter="search" />
        <input v-model="keyword" placeholder="关键词（页内过滤）" @keyup.enter="search" />
        <UiButton @click="search"><Search :size="14" :stroke-width="1.8" /><span>检索</span></UiButton>
      </div>
      <p v-if="message" class="status">{{ message }}</p>

      <div v-if="msgs.length" class="timeline">
        <div v-for="m in msgs" :key="m.id" class="msg" :class="{ out: m.who === '客服' }">
          <div class="bubble">
            <div class="msg-head">
              <span class="who">{{ m.who }}</span>
              <span v-if="m.kind" class="kind-chip">{{ m.kind }}</span>
              <span v-if="m.channel" class="ch-chip">{{ m.channel }}</span>
              <span class="flex"></span>
              <span class="time">{{ m.timeLabel }}</span>
            </div>
            <div v-if="m.text" class="text">{{ m.text }}</div>
          </div>
        </div>
        <button v-if="hasMore" class="more" @click="more">更早的消息</button>
        <p v-else class="end-mark">— 已到最早 —</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 920px;
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
.report {
  padding: 18px 20px;
  margin-bottom: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.report-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}
h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
.note {
  font-size: 11px;
  color: var(--ld-content-2);
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}
.stat-card {
  padding: 12px 14px;
  background: var(--ld-bg-lilac);
  border-radius: 10px;
}
.stat-label {
  font-size: 11px;
  color: var(--ld-content-2);
}
.stat-value {
  margin-top: 4px;
  font-size: 19px;
  font-weight: 700;
  color: var(--ld-ink);
}
.stat-card.bad {
  background: var(--ld-bg-red-soft);
}
.stat-card.bad .stat-value {
  color: var(--ld-red);
}
.report-note {
  margin: 12px 0 0;
  font-size: 11px;
  color: var(--ld-content-2);
}
.kind-chip {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
  font-size: 10px;
  font-weight: 600;
}
.card {
  padding: 18px 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.card h2 {
  margin-bottom: 12px;
}
.searchrow {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 8px;
  margin-bottom: 10px;
}
input {
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
}
.status {
  font-size: 13px;
  color: var(--ld-content-2);
}
.timeline {
  margin-top: 6px;
}
.msg {
  display: flex;
  margin-bottom: 8px;
}
.msg.out {
  justify-content: flex-end;
}
.bubble {
  max-width: 72%;
  padding: 9px 13px;
  border-radius: 12px;
  background: var(--ld-bg-lilac);
}
.msg.out .bubble {
  background: var(--ld-bg-green-soft);
}
.msg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.flex {
  flex: 1;
}
.ch-chip {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ld-bg-faint);
  color: var(--ld-content-2);
  font-size: 10px;
  font-weight: 600;
}
.sla-in {
  font-size: 11.5px;
  color: var(--ld-content-2);
  white-space: nowrap;
}
.sla-in input {
  width: 54px;
  padding: 4px 8px;
  font-size: 12px;
  margin: 0 3px;
}
.sla-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content);
  font-size: 12px;
  cursor: pointer;
}
.end-mark {
  text-align: center;
  font-size: 11px;
  color: var(--ld-content-2);
  margin: 12px 0 0;
}
.who {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ld-brand-active);
}
.msg.out .who {
  color: var(--ld-green);
}
.time {
  font-size: 10.5px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.text {
  font-size: 13px;
  color: var(--ld-content);
  line-height: 1.5;
  word-break: break-word;
}
.more {
  display: block;
  margin: 10px auto 0;
  padding: 7px 18px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content);
  font-size: 12.5px;
  cursor: pointer;
}
</style>
