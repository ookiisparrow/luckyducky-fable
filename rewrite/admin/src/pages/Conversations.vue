<script setup lang="ts">
// 客服会话（设计语言一致性·M3 UI 批13）：按客户检索时间轴 + 质检报表（样本口径诚实标注）。
// 逻辑未动，仅套设计语言（页头/统计卡/检索卡/消息气泡时间轴/token）。
import { ref, onMounted } from 'vue'
import { Search } from 'lucide-vue-next'
import { searchConversations, conversationsReport } from '../api/cs'
import { mapMessages, mapReport, type MsgVM, type ReportVM } from '../lib/mapCs'

const openid = ref('')
const externalUserId = ref('')
const keyword = ref('')
const msgs = ref<MsgVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const report = ref<ReportVM | null>(null)
const message = ref('')

async function search() {
  message.value = '检索中…'
  const r = await searchConversations({ openid: openid.value.trim() || undefined, externalUserId: externalUserId.value.trim() || undefined, keyword: keyword.value.trim() || undefined })
  msgs.value = r.ok ? mapMessages(r.messages) : []
  cursor.value = r.ok ? r.nextCursor : null
  hasMore.value = !!(r.ok && r.hasMore)
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

onMounted(async () => {
  const r = await conversationsReport()
  report.value = mapReport(r)
})
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
      </div>
      <div class="stat-grid">
        <div v-for="s in [...report.volume, ...report.response, ...report.sla]" :key="s.label" class="stat-card">
          <div class="stat-label">{{ s.label }}</div>
          <div class="stat-value">{{ s.value }}</div>
        </div>
      </div>
    </div>

    <section class="card">
      <h2>会话检索（按客户）</h2>
      <div class="searchrow">
        <input v-model="openid" placeholder="openid" />
        <input v-model="externalUserId" placeholder="或 外部用户号（未绑定时）" />
        <input v-model="keyword" placeholder="关键词（页内过滤）" />
        <button class="btn-primary" @click="search"><Search :size="14" :stroke-width="1.8" /><span>检索</span></button>
      </div>
      <p v-if="message" class="status">{{ message }}</p>

      <div v-if="msgs.length" class="timeline">
        <div v-for="m in msgs" :key="m.id" class="msg" :class="{ out: m.who === '客服' }">
          <div class="bubble">
            <div class="msg-head"><span class="who">{{ m.who }}</span><span class="time">{{ m.timeLabel }}</span></div>
            <div class="text">{{ m.text }}</div>
          </div>
        </div>
        <button v-if="hasMore" class="more" @click="more">更早的消息</button>
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
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
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
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 3px;
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
