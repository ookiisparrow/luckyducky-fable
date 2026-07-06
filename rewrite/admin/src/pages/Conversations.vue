<script setup lang="ts">
// 客服会话（设计语言一致性·M3 UI 批13）：按客户检索时间轴 + 质检报表（样本口径诚实标注）。
// 逻辑未动，仅套设计语言（页头/统计卡/检索卡/消息气泡时间轴/token）。
import { ref, onMounted } from 'vue'
import { Search, RotateCcw } from 'lucide-vue-next'
import { searchConversations, conversationsReport } from '../api/cs'
import { mapMessages, mapReport, type MsgVM, type ReportVM } from '../lib/mapCs'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

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
  <div class="ld-page">
    <PageHeader title="客服会话" sub="按客户检索会话时间轴 + 质检报表（样本口径如实标注，不夸大覆盖）" />

    <!-- 质检报表：mapReport 真值（volume/response/sla），未答复/超时 >0 标红（bad→tone red） -->
    <Card v-if="report" title="质检报表" :sub="report.sampleNote">
      <template #head>
        <label class="sla-in">首响 SLA <input v-model.number="slaMin" type="number" min="1" max="1440" /> 分钟</label>
        <UiButton size="sm" variant="ghost" :disabled="reportBusy" @click="loadReport">
          <RotateCcw :size="14" :stroke-width="1.8" /><span>{{ reportBusy ? '算中…' : '重算' }}</span>
        </UiButton>
      </template>
      <div class="ld-kpi-grid">
        <KpiCard
          v-for="s in [...report.volume, ...report.response, ...report.sla]"
          :key="s.label"
          :label="s.label"
          :value="s.value"
          :tone="s.bad ? 'red' : 'neutral'"
        />
      </div>
      <!-- 首响口径诚实告知（防把机器人秒回误读成人工绩效） -->
      <p class="report-note">首次响应含机器人自动应答；人工接待时长待落档后单列，届时更真实反映坐席绩效。</p>
    </Card>

    <!-- 会话检索（按客户）：本页无「会话列表/客户上下文」数据源，不建三栏实时收件箱，保持检索→时间轴 -->
    <Card title="会话检索（按客户）" sub="按 openid / 外部用户号 / 关键词 检索消息时间轴">
      <div class="ld-toolbar">
        <label class="ld-search"><input v-model="openid" placeholder="openid" @keyup.enter="search" /></label>
        <label class="ld-search"><input v-model="externalUserId" placeholder="或 外部用户号（未绑定时）" @keyup.enter="search" /></label>
        <label class="ld-search"><input v-model="keyword" placeholder="关键词（页内过滤）" @keyup.enter="search" /></label>
        <UiButton @click="search"><Search :size="14" :stroke-width="1.8" /><span>检索</span></UiButton>
      </div>

      <!-- 检索状态/加载反馈：独立于时间轴显示（重检索时「检索中…」不被旧结果抑制） -->
      <p v-if="message" class="ld-status conv-status">{{ message }}</p>
      <div v-if="msgs.length" class="timeline">
        <div v-for="m in msgs" :key="m.id" class="msg" :class="{ out: m.who === '客服' }">
          <div class="bubble">
            <div class="msg-head">
              <span class="who">{{ m.who }}</span>
              <Badge v-if="m.kind" tone="brand">{{ m.kind }}</Badge>
              <Badge v-if="m.channel" tone="neutral">{{ m.channel }}</Badge>
              <span class="flex"></span>
              <span class="time">{{ m.timeLabel }}</span>
            </div>
            <div v-if="m.text" class="text">{{ m.text }}</div>
          </div>
        </div>
        <div class="more-wrap">
          <UiButton v-if="hasMore" size="sm" variant="ghost" @click="more">更早的消息</UiButton>
          <p v-else class="end-mark">— 已到最早 —</p>
        </div>
      </div>
      <EmptyState v-else-if="!message" :icon="Search" text="输入 openid / 外部用户号 / 关键词后检索会话时间轴" />
    </Card>
  </div>
</template>

<style scoped>
/* 质检报表卡头：SLA 阈值输入（重算按 slaMin 换算 ms 传 conversationsReport） */
.sla-in {
  font-size: 11.5px;
  color: var(--ld-content-2);
  white-space: nowrap;
}
.sla-in input {
  width: 54px;
  margin: 0 4px;
  padding: 5px 8px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-family: inherit;
  font-size: 12px;
  color: var(--ld-content);
}
.report-note {
  margin: 14px 0 0;
  font-size: 11px;
  color: var(--ld-content-2);
}

/* 消息时间轴气泡（本页独有·收 bg-grey 左对齐 · 发 brand 白字右对齐） */
.conv-status {
  margin-top: 12px;
}
.timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
.msg {
  display: flex;
}
.msg.out {
  justify-content: flex-end;
}
.bubble {
  max-width: 72%;
  padding: 10px 13px;
  border-radius: var(--ld-radius);
  background: var(--ld-bg-grey);
}
.msg.out .bubble {
  background: var(--ld-brand);
}
.msg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.flex {
  flex: 1;
}
.who {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ld-content-2);
}
.msg.out .who {
  color: #fff;
}
.time {
  font-size: 10.5px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.msg.out .time {
  color: #fff;
  opacity: 0.85;
}
.text {
  font-size: 13px;
  color: var(--ld-content);
  line-height: 1.5;
  word-break: break-word;
}
.msg.out .text {
  color: #fff;
}
.more-wrap {
  display: flex;
  justify-content: center;
  margin-top: 6px;
}
.end-mark {
  width: 100%;
  margin: 6px 0 0;
  text-align: center;
  font-size: 11px;
  color: var(--ld-content-2);
}
</style>
