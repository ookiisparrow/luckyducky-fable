<script setup>
/**
 * 会话窗口（B2·消息流 + 坐席回复 + 会话操作）。
 *
 * 实时＝轮询（承面C工单 §1 定稿）：每 2.5s 调 getThread(cursor) 拉增量、经 logic/thread.js 合并去重排序；
 * 切换会话/卸载时清理 timer（守卫 agent-poll-cleanup·防泄漏）。
 * 操作（§1 外包最小权·查+回复+升级）：
 *  - sendAgentMessage 坐席回复（回后立即拉一次·出站消息经同一 getThread 流回显·不做乐观插入防重复）
 *  - releaseConversation 退回待接 / escalateToMerchant 升级商户超管 / closeConversation 结束（触 CSAT）
 * 认领/改钱/改状态不在外包权内（§1 定稿）。
 */
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { Send, CornerUpLeft, ArrowUpCircle, CheckCircle2 } from 'lucide-vue-next'
import { getThread, sendAgentMessage, releaseConversation, escalateToMerchant, closeConversation } from '@/api/agentApi.js'
import { mergeThread, advanceCursor } from '@/logic/thread.js'
import { toast, confirmDialog } from '@/utils/ui.js'

const props = defineProps({
  session: { type: Object, required: true },
  insert: { type: Object, default: null }, // { text, id } 快捷回复插入信号
})
const emit = defineEmits(['ended'])

const POLL_MS = 2500
const messages = ref([])
const cursor = ref('')
const draft = ref('')
const sending = ref(false)
const acting = ref(false)
const view = ref(props.session)
const streamEl = ref(null)
let timer = null

const STATUS_LABEL = { pending: '待接', active: '进行中', escalated: '已升级', closed: '已结束' }
const STATUS_CLS = { pending: 'amber', active: 'green', escalated: 'amber', closed: 'grey' }
const fmtClock = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

async function scrollToBottom() {
  await nextTick()
  const el = streamEl.value
  if (el) el.scrollTop = el.scrollHeight
}

async function poll() {
  const sessionId = props.session.sessionId
  try {
    const r = await getThread(sessionId, cursor.value)
    if (!r || !r.ok) return
    if (props.session.sessionId !== sessionId) return // 拉取期间已切会话·丢弃过期结果
    if (r.session) view.value = r.session
    const before = messages.value.length
    messages.value = mergeThread(messages.value, r.messages)
    // 游标推进：优先用服务端 nextCursor（契约·可为不透明串·整合车道 A 时直接透传）；缺省回退按消息 at 推进（mock/兜底）
    cursor.value = r.nextCursor || advanceCursor(r.messages, cursor.value)
    if (messages.value.length > before) scrollToBottom()
  } catch {
    /* 轮询失败静默重试（下个周期）·不打断坐席 */
  }
}

function stopPolling() {
  if (timer) clearInterval(timer) // 清理轮询 timer（守卫 agent-poll-cleanup）
  timer = null
}
function startPolling() {
  stopPolling()
  timer = setInterval(poll, POLL_MS) // getThread 增量轮询（§1 定稿实时=轮询）
}

// 切换会话：重置流 + 游标，立即首拉并重启轮询
watch(
  () => props.session.sessionId,
  () => {
    view.value = props.session
    messages.value = []
    cursor.value = ''
    poll()
    startPolling()
  },
  { immediate: true },
)

// 快捷回复插入到输入框
watch(
  () => props.insert && props.insert.id,
  () => {
    if (props.insert && props.insert.text) {
      draft.value = draft.value ? draft.value + '\n' + props.insert.text : props.insert.text
    }
  },
)

onUnmounted(stopPolling) // 卸载清理 timer（守卫 agent-poll-cleanup）

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    const r = await sendAgentMessage(props.session.sessionId, text)
    if (r && r.ok) {
      draft.value = ''
      await poll() // 立即拉一次·出站消息经 getThread 流回显（同一路径·不乐观插入防重复）
    } else {
      toast('发送失败' + (r && r.errcode ? `（errcode ${r.errcode}）` : ''), 'err')
    }
  } catch (e) {
    toast('发送失败：' + e.message, 'err')
  } finally {
    sending.value = false
  }
}
function onComposerKey(e) {
  // Enter 发送、Shift+Enter 换行（贴客服工具习惯）
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

async function doRelease() {
  if (acting.value) return
  acting.value = true
  try {
    const r = await releaseConversation(props.session.sessionId)
    if (r && r.ok) {
      toast('已退回待接队列', 'ok')
      emit('ended', { action: 'release' })
    } else toast('退回失败', 'err')
  } catch (e) {
    toast('退回失败：' + e.message, 'err')
  } finally {
    acting.value = false
  }
}
async function doEscalate() {
  if (acting.value) return
  if (!(await confirmDialog({ title: '升级转商户', message: '将本会话升级给商户超管处理？升级后你将退出该会话。' }))) return
  acting.value = true
  try {
    const r = await escalateToMerchant(props.session.sessionId)
    if (r && r.ok) {
      toast('已升级转商户超管', 'ok')
      emit('ended', { action: 'escalate' })
    } else toast('升级失败', 'err')
  } catch (e) {
    toast('升级失败：' + e.message, 'err')
  } finally {
    acting.value = false
  }
}
async function doClose() {
  if (acting.value) return
  if (!(await confirmDialog({ title: '结束会话', message: '确认结束本次会话？结束后将向客户发起满意度评价。', danger: true }))) return
  acting.value = true
  try {
    const r = await closeConversation(props.session.sessionId)
    if (r && r.ok) {
      toast('会话已结束', 'ok')
      emit('ended', { action: 'close' })
    } else toast('结束失败', 'err')
  } catch (e) {
    toast('结束失败：' + e.message, 'err')
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <section class="cw">
    <!-- 头部：客户 + 状态 -->
    <header class="cw-head">
      <div class="cw-who">
        <div class="cw-name">{{ view.display || view.externalUserId }}</div>
        <div class="cw-sub mono">{{ view.openid || '身份未桥接' }}</div>
      </div>
      <span class="chip" :class="STATUS_CLS[view.status] || 'grey'">{{ STATUS_LABEL[view.status] || view.status }}</span>
    </header>

    <!-- 消息流 -->
    <div ref="streamEl" class="cw-stream">
      <p v-if="!messages.length" class="cw-empty">暂无消息</p>
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.direction === 'out' ? 'out' : 'in'">
        <div class="bubble">
          <span class="btext">{{ m.text }}</span>
          <span class="btime">{{ fmtClock(m.at) }}</span>
        </div>
      </div>
    </div>

    <!-- 操作条 -->
    <div class="cw-actions">
      <button class="btn ghost mini" :disabled="acting" @click="doRelease"><CornerUpLeft :size="14" />退回队列</button>
      <button class="btn ghost mini" :disabled="acting" @click="doEscalate"><ArrowUpCircle :size="14" />升级转商户</button>
      <button class="btn ghost mini" :disabled="acting" @click="doClose"><CheckCircle2 :size="14" />结束会话</button>
    </div>

    <!-- 输入框 -->
    <div class="cw-composer">
      <textarea
        v-model="draft"
        class="composer-input"
        rows="2"
        placeholder="输入回复…（Enter 发送 / Shift+Enter 换行；点右侧快捷回复可插入）"
        @keydown="onComposerKey"
      ></textarea>
      <button class="btn primary send" :disabled="sending || !draft.trim()" @click="send"><Send :size="15" />发送</button>
    </div>
  </section>
</template>

<style scoped>
.cw {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.cw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.cw-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}
.cw-sub {
  font-size: 11px;
  color: var(--content-2);
  margin-top: 2px;
}
.cw-stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-lilac);
}
.cw-empty {
  margin: auto;
  color: var(--content-2);
  font-size: 12.5px;
}
.msg {
  display: flex;
}
.msg.out {
  justify-content: flex-end;
}
.bubble {
  max-width: 68%;
  padding: 9px 13px;
  border-radius: 13px;
  font-size: 13px;
  line-height: 1.5;
  position: relative;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.in .bubble {
  background: var(--white);
  border: 1px solid var(--line);
  border-bottom-left-radius: 4px;
  color: var(--content);
}
.msg.out .bubble {
  background: var(--brand);
  color: var(--white);
  border-bottom-right-radius: 4px;
}
.btext {
  display: block;
}
.btime {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  opacity: 0.6;
  text-align: right;
}
.cw-actions {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  background: var(--white);
}
.cw-composer {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  padding: 12px 16px 16px;
  background: var(--white);
}
.composer-input {
  flex: 1;
  resize: none;
  padding: 10px 13px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  outline: none;
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
}
.composer-input:focus {
  border-color: var(--brand);
}
.send {
  flex: 0 0 auto;
}
</style>
