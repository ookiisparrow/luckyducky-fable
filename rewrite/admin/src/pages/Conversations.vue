<script setup lang="ts">
// 客服会话（M3 批5）：按客户检索时间轴 + 质检报表（样本口径诚实标注）。
import { ref, onMounted } from 'vue'
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
  <div>
    <h2>客服会话</h2>
    <div v-if="report" class="panel">
      <h3>质检报表 <span class="note">{{ report.sampleNote }}</span></h3>
      <div class="statgrid">
        <div v-for="s in [...report.volume, ...report.response, ...report.sla]" :key="s.label" class="stat">
          <div class="k">{{ s.label }}</div>
          <div class="v">{{ s.value }}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>会话检索（按客户）</h3>
      <div class="searchrow">
        <input v-model="openid" placeholder="openid" />
        <input v-model="externalUserId" placeholder="或 外部用户号（未绑定时）" />
        <input v-model="keyword" placeholder="关键词（页内过滤）" />
        <button class="act" @click="search">检索</button>
      </div>
      <p v-if="message" class="status">{{ message }}</p>
      <div v-for="m in msgs" :key="m.id" class="msg" :class="{ out: m.who === '客服' }">
        <span class="who">{{ m.who }}</span>
        <span class="text">{{ m.text }}</span>
        <span class="time">{{ m.timeLabel }}</span>
      </div>
      <button v-if="hasMore" class="act ghost" @click="more">更早的消息</button>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
h3 {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--ld-purple-ink);
}
.note {
  font-size: 11px;
  color: var(--ld-purple-meta);
  font-weight: 400;
}
.panel {
  padding: 16px 18px;
  margin-bottom: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
}
.statgrid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.stat {
  min-width: 110px;
}
.stat .k {
  font-size: 11px;
  color: var(--ld-purple-meta);
}
.stat .v {
  font-size: 17px;
  font-weight: 700;
  color: var(--ld-purple-ink);
}
.searchrow {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 8px;
  margin-bottom: 10px;
}
input {
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.status {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.msg {
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: var(--ld-bg-lilac);
  font-size: 13px;
  display: flex;
  gap: 10px;
}
.msg.out {
  background: var(--ld-bg-faint);
}
.who {
  flex-shrink: 0;
  color: var(--ld-purple-tab);
  font-weight: 600;
}
.text {
  flex: 1;
}
.time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--ld-purple-meta);
}
.act {
  padding: 7px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.act.ghost {
  background: transparent;
  color: var(--ld-purple-meta);
  border: 1px solid var(--ld-purple-line);
}
</style>
