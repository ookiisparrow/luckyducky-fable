<script setup>
/**
 * 客服会话台（后台360工作站 B5.1·板块#9·外包管控底座）。坐席/质检按客户检索归档会话（微信客服·未来承面C），
 * 看完整时间轴（客户↔客服），供历史追溯 + 质检取证（B5.3 报表/SLA 在此页顶部补）。
 *
 * 越权读（§1.5）：searchConversations 后端经 customer:view 闸 + 强制留痕（查了谁的会话），本页只发起读、不碰审计/能力。
 * bounded：cursor 分页（「加载更多」续取更早消息）·keyword 为当前结果集内子串过滤（真全文检索待真机后升级·根因#8）。
 */
import { ref } from 'vue'
import { cloudMode, searchConversations } from '@/api/cloud.js'
import { Search, MessagesSquare, ArrowDownToLine } from 'lucide-vue-next'

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
