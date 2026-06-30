<script setup>
/**
 * 客服会话台（后台360工作站·板块#9/#11·外包管控底座）。坐席/质检按客户检索归档会话（微信客服·未来承面C），
 * 看完整时间轴（客户↔客服），供历史追溯 + 质检取证；顶部「质检报表」（B5.3）显会话量/首次响应时长/SLA/答复率。
 *
 * 越权读（§1.5）：searchConversations 后端经 customer:view 闸 + 强制留痕（查了谁的会话），本页只发起读、不碰审计/能力。
 * bounded：cursor 分页（「加载更多」续取更早消息）·keyword 为当前结果集内子串过滤（真全文检索待真机后升级·根因#8）；
 * 报表为近 N 条 bounded 样本聚合（超量近似·同看板）。
 */
import { ref, onMounted } from 'vue'
import { cloudMode, searchConversations, conversationsReport } from '@/api/cloud.js'
import { Search, MessagesSquare, ArrowDownToLine, RefreshCw } from 'lucide-vue-next'

const idType = ref('openid') // openid（kfBind 绑定后稳定·首选）| externalUserId（未绑定时用外部联系人ID）
const idValue = ref('')
const keyword = ref('')

const messages = ref([])
const cursor = ref(null)
const hasMore = ref(false)
const searched = ref(false)
const loading = ref(false)
const err = ref('')

const fmtTime = (ms) => {
  if (!ms && ms !== 0) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function buildParams(more) {
  const params = { keyword: keyword.value.trim() }
  const v = idValue.value.trim()
  if (v) params[idType.value] = v
  if (more && cursor.value != null) params.cursor = cursor.value
  return params
}

async function doSearch(more = false) {
  if (loading.value) return
  loading.value = true
  err.value = ''
  if (!more) {
    searched.value = true
    messages.value = []
    cursor.value = null
  }
  try {
    const r = await searchConversations(buildParams(more))
    messages.value = more ? messages.value.concat(r.messages) : r.messages
    cursor.value = r.nextCursor
    hasMore.value = r.hasMore
  } catch (e) {
    err.value = '检索失败：' + e.message
  } finally {
    loading.value = false
  }
}

// ── 质检报表（B5.3·会话量/首次响应/SLA/答复率·bounded 聚合）──
const report = ref(null)
const reportLoading = ref(false)
const reportErr = ref('')
const slaMin = ref(5) // SLA 阈值（分钟·首次响应）

const fmtDur = (ms) => {
  const n = Number(ms) || 0
  if (n < 1000) return n + ' 毫秒'
  if (n < 60_000) return (n / 1000).toFixed(1) + ' 秒'
  if (n < 3_600_000) return (n / 60_000).toFixed(1) + ' 分'
  return (n / 3_600_000).toFixed(1) + ' 小时'
}

async function loadReport() {
  if (!cloudMode || reportLoading.value) return
  reportLoading.value = true
  reportErr.value = ''
  try {
    report.value = await conversationsReport({ slaMs: Math.max(1, Number(slaMin.value) || 5) * 60_000 })
  } catch (e) {
    reportErr.value = '报表加载失败：' + e.message
  } finally {
    reportLoading.value = false
  }
}

onMounted(loadReport)
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>客服会话</h1>
        <p class="sub">按客户检索归档会话（微信客服）·看完整时间轴·供历史追溯与质检取证（只读·查询留痕）</p>
      </div>
    </header>

    <p v-if="!cloudMode" class="hint warn">客服会话需云端模式（配置 VITE_ADMIN_API）。</p>

    <template v-else>
      <!-- 质检报表（B5.3·会话量/首次响应/SLA/答复率·近 N 条 bounded 样本聚合·超量近似） -->
      <section class="report card">
        <div class="rhead">
          <h3>质检报表<span v-if="report" class="rsub"> · 近 {{ report.sampleSize }} 条{{ report.approx ? '（近似）' : '' }}</span></h3>
          <div class="sla-ctl">
            <label>SLA 首响阈值</label>
            <input v-model.number="slaMin" class="input mini-in" type="number" min="1" />
            <span class="unit">分钟</span>
            <button class="btn ghost mini" :disabled="reportLoading" @click="loadReport"><RefreshCw :size="13" />刷新</button>
          </div>
        </div>
        <p v-if="reportErr" class="hint warn">{{ reportErr }}</p>
        <p v-else-if="reportLoading && !report" class="muted">报表加载中…</p>
        <div v-else-if="report" class="tiles">
          <div class="tile"><span class="tk">会话消息</span><span class="tv">{{ report.volume.messages }}</span></div>
          <div class="tile"><span class="tk">客户数</span><span class="tv">{{ report.volume.customers }}</span></div>
          <div class="tile"><span class="tk">客户消息</span><span class="tv">{{ report.volume.inbound }}</span></div>
          <div class="tile"><span class="tk">客服消息</span><span class="tv">{{ report.volume.outbound }}</span></div>
          <div class="tile"><span class="tk">平均首响</span><span class="tv">{{ fmtDur(report.response.avgResponseMs) }}</span></div>
          <div class="tile"><span class="tk">最长首响</span><span class="tv">{{ fmtDur(report.response.maxResponseMs) }}</span></div>
          <div class="tile"><span class="tk">答复率</span><span class="tv">{{ report.response.answeredRate }}%</span></div>
          <div class="tile"><span class="tk">未答复</span><span class="tv" :class="{ bad: report.response.unanswered > 0 }">{{ report.response.unanswered }}</span></div>
          <div class="tile"><span class="tk">超 SLA</span><span class="tv" :class="{ bad: report.sla.breaches > 0 }">{{ report.sla.breaches }}（{{ report.sla.breachRate }}%）</span></div>
        </div>
        <p class="rnote">首次响应含机器人自动应答（近实时）；人工接待时长待承面C 人工回复落档后显著。</p>
      </section>

      <div class="bar">
        <select v-model="idType" class="input sel">
          <option value="openid">openid</option>
          <option value="externalUserId">外部联系人ID</option>
        </select>
        <input v-model="idValue" class="input" :placeholder="idType === 'openid' ? '客户 openid' : '外部联系人 external_userid'" @keyup.enter="doSearch(false)" />
        <input v-model="keyword" class="input kw" placeholder="关键词（可选·命中消息内容）" @keyup.enter="doSearch(false)" />
        <button class="btn primary mini" :disabled="loading" @click="doSearch(false)"><Search :size="14" />检索</button>
      </div>

      <p v-if="err" class="hint warn">{{ err }}</p>

      <template v-if="searched && !err">
        <p v-if="loading && !messages.length" class="muted">检索中…</p>
        <p v-else-if="!messages.length" class="hint">没有匹配的会话记录（openid/外部ID 需精确·关键词为已取结果内过滤）</p>
        <div v-else class="timeline">
          <div v-for="m in messages" :key="m.id" class="msg" :class="m.direction">
            <div class="bubble">
              <div class="meta">
                <span class="who">{{ m.direction === 'in' ? '客户' : '客服' }}</span>
                <span class="ch">{{ m.channel }}</span>
                <span v-if="m.msgtype && m.msgtype !== 'text'" class="ty">{{ m.msgtype }}</span>
                <span class="t">{{ fmtTime(m.at) }}</span>
              </div>
              <div class="text">{{ m.text || '（无文本）' }}</div>
            </div>
          </div>
          <button v-if="hasMore" class="btn ghost more" :disabled="loading" @click="doSearch(true)">
            <ArrowDownToLine :size="14" />{{ loading ? '加载中…' : '加载更早消息' }}
          </button>
          <p v-else class="muted end"><MessagesSquare :size="13" /> 已到最早</p>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 18px;
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
/* 质检报表 */
.report {
  padding: 16px 18px;
  margin-bottom: 16px;
}
.rhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.rhead h3 {
  margin: 0;
  font-size: 14px;
  color: var(--ink);
}
.rsub {
  font-weight: 400;
  font-size: 12px;
  color: var(--content-2);
}
.sla-ctl {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--content-2);
}
.mini-in {
  width: 56px;
  text-align: center;
}
.unit {
  margin-right: 4px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  background: var(--bg-lilac);
  border-radius: 9px;
}
.tk {
  font-size: 11px;
  color: var(--content-2);
}
.tv {
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
}
.tv.bad {
  color: var(--red);
}
.rnote {
  margin: 12px 0 0;
  font-size: 11px;
  color: var(--content-2);
}
.bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.sel {
  width: 130px;
}
.bar .input {
  width: 240px;
  max-width: 50vw;
}
.bar .kw {
  width: 220px;
}
.muted {
  color: var(--content-2);
  font-size: 12px;
}
.timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.msg {
  display: flex;
}
.msg.out {
  justify-content: flex-end;
}
.bubble {
  max-width: 70%;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 9px 13px;
  background: var(--white);
}
.msg.in .bubble {
  border-color: var(--purple-line);
  background: var(--bg-lilac);
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--content-2);
}
.who {
  font-weight: 600;
  color: var(--purple-ink);
}
.msg.out .who {
  color: var(--brand);
}
.ch,
.ty {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--bg-lilac);
  font-size: 10px;
}
.t {
  margin-left: auto;
}
.text {
  font-size: 13px;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
}
.more {
  align-self: center;
  margin-top: 4px;
}
.end {
  display: flex;
  align-items: center;
  gap: 5px;
  justify-content: center;
  margin-top: 6px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  margin: 8px 0;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
</style>
