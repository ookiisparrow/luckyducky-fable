<script setup lang="ts">
// 工作台单屏（M3 批8）：左=待接队列+我在接；中=会话窗（3s 轮询·卸载清理·合并去重）；右=360 侧栏（双闸）。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { post, logout } from './api/client'
import { mergeThread, advanceCursor, mapQueue, deskErrorText, type Msg, type QueueItem } from './lib/desk'

const emit = defineEmits<{ logout: [] }>()

const status = ref<'online' | 'busy' | 'offline'>('online')
const queue = ref<QueueItem[]>([])
const mine = ref<Array<Record<string, any>>>([])
const currentId = ref('')
const msgs = ref<Msg[]>([])
const cursor = ref(0)
const draft = ref('')
const panels = ref<Array<Record<string, any>>>([])
const panelNote = ref('')
const message = ref('')
const busy = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null
let listTimer: ReturnType<typeof setInterval> | null = null

async function refreshLists() {
  const [q, m] = await Promise.all([post('listQueue'), post('listMyActive')])
  if (q.error === 'SESSION_LOST' || m.error === 'SESSION_LOST') return doLogout()
  queue.value = q.ok ? mapQueue(q.items, Date.now()) : queue.value // 失败不清已有
  mine.value = m.ok ? ((m.sessions as Record<string, any>[]) || []) : mine.value
}

async function pollThread() {
  if (!currentId.value) return
  const sid = currentId.value // 会话粒度快照（P1·item8：防切会话后旧轮询回包串号——await 期间用户可能已切会话）
  const r = await post('getThread', { sessionId: sid, cursor: cursor.value || undefined })
  if (sid !== currentId.value) return // 期间已切别的会话·丢弃过期回包（不写进新会话的 msgs/cursor）
  if (!r.ok) return // 轮询失败静默重试（不打断输入）
  msgs.value = mergeThread(msgs.value, r.messages) // 去重合并·不重气泡
  cursor.value = advanceCursor(cursor.value, r.nextCursor) // 只进不退
}

async function claim(sessionId: string) {
  const r = await post('claimConversation', { sessionId })
  message.value = r.ok ? '' : deskErrorText(r.error)
  if (r.ok) void open(sessionId)
  void refreshLists()
}

async function open(sessionId: string) {
  currentId.value = sessionId
  msgs.value = []
  cursor.value = 0
  panels.value = []
  panelNote.value = ''
  await pollThread()
  const p = await post('getSessionCustomer360', { sessionId })
  if (currentId.value !== sessionId) return // 期间又切了别的会话·丢弃过期 360 回包（P1·item8·同 pollThread 治法）
  if (p.ok) panels.value = (p.panels as Record<string, any>[]) || []
  else panelNote.value = deskErrorText(p.error) // NO_BRIDGE/NO_CONSENT 如实显示
}

async function send() {
  const text = draft.value.trim()
  if (!text || !currentId.value || busy.value) return
  busy.value = true
  const r = await post('sendAgentMessage', { sessionId: currentId.value, text })
  busy.value = false
  if (r.ok) {
    draft.value = '' // 只有发成功才清输入框（旧线 95018 教训：失败清框=顾客话丢了）
    void pollThread()
  } else {
    message.value = deskErrorText(r.error)
  }
}

async function act(action: string) {
  if (!currentId.value) return
  const r = await post(action, { sessionId: currentId.value })
  message.value = r.ok ? '' : deskErrorText(r.error)
  if (r.ok && (action === 'releaseConversation' || action === 'closeConversation' || action === 'escalateToMerchant')) {
    currentId.value = ''
    msgs.value = []
  }
  void refreshLists()
}

let statusSeq = 0 // 代际守卫（P2·回归修复：连续切状态时先发后到的失败请求不得用旧 prev 覆盖已被后一次成功请求确认的新状态——ABA 竞态，同 pollThread/open 的 sid 快照代际治法）
let confirmedStatus: 'online' | 'busy' | 'offline' = status.value // 服务端最后一次确认过的真值（P2·bug sweep Round2 item15·批4 修复不彻底：
// 回滚锚原取 prev（当次调用前的 UI 乐观值，可能也从未被服务端确认过）——连续两次都失败时会回滚到一个同样没被确认过的中间态，
// 与服务端实际状态脱节。改锚定"最后一次 r.ok 时的目标值"，回滚落到已知的服务端真值上。
async function setStatus(s: 'online' | 'busy' | 'offline') {
  const my = ++statusSeq // 本次操作的代际号
  status.value = s // 乐观更新（下拉选中即时反映）
  const r = await post('setAgentStatus', { status: s })
  // 过期调用的成功也要更新锚（P1·bug sweep Round2 复审补漏）：先判 my!==statusSeq 就早退会连成功一起丢弃——
  // 三连快切+穿插成败序列下 confirmedStatus 可能永远锚不到服务端最新真值（连续两次都失败时回滚目标本身就错了）。
  // 只丢弃过期调用的**失败**回滚（那会用旧锚去覆盖更晚一次乐观更新的 UI）；过期调用的**成功**仍如实刷新锚。
  if (r.ok) confirmedStatus = s // 服务端已接受·无论是否被更晚一次调用取代都刷新确认锚
  if (my !== statusSeq) return // 期间又发起了更新的 setStatus——UI 展示交给更晚那次收尾，本次到此为止
  if (!r.ok) {
    status.value = confirmedStatus // 服务端没接受·回滚到最后一次真被确认过的状态（非未必被确认过的 prev）
    message.value = deskErrorText(r.error) // 照本文件既有错误提示范式（同 claim/act）
  }
}

function doLogout() {
  logout()
  emit('logout')
}

onMounted(() => {
  void refreshLists()
  listTimer = setInterval(refreshLists, 10_000)
  pollTimer = setInterval(pollThread, 3_000)
})
onBeforeUnmount(() => {
  // 轮询必清理（守卫 agent-poll-cleanup 的教训承接）
  if (pollTimer) clearInterval(pollTimer)
  if (listTimer) clearInterval(listTimer)
})
</script>

<template>
  <div class="desk">
    <aside>
      <div class="topbar">
        <select :value="status" @change="setStatus(($event.target as HTMLSelectElement).value as never)">
          <option value="online">🟢 在线</option>
          <option value="busy">🟡 忙碌</option>
          <option value="offline">⚪ 离线</option>
        </select>
        <button class="ghost" @click="doLogout">退出</button>
      </div>
      <h3>待接（{{ queue.length }}）</h3>
      <div v-for="q in queue" :key="q.sessionId" class="qitem">
        <div class="qinfo">
          <span class="euid">{{ q.externalUserId.slice(-8) || q.sessionId.slice(-8) }}</span>
          <span class="wait">等了 {{ q.waitLabel }}</span>
          <span v-if="q.status === 'escalated'" class="esc">升级件</span>
        </div>
        <button class="act" @click="claim(q.sessionId)">接</button>
      </div>
      <p v-if="!queue.length" class="empty">队列空 ✓</p>
      <h3>我在接（{{ mine.length }}）</h3>
      <div v-for="s in mine" :key="s.sessionId" class="qitem" :class="{ on: s.sessionId === currentId }" @click="open(String(s.sessionId))">
        <span class="euid">{{ String(s.externalUserId || '').slice(-8) }}</span>
      </div>
    </aside>

    <main>
      <p v-if="message" class="status">{{ message }}</p>
      <template v-if="currentId">
        <div class="thread">
          <div v-for="m in msgs" :key="m.at + m.direction + m.text" class="bubble" :class="m.direction">
            <span class="text">{{ m.text || '[' + (m.msgtype || '非文本') + ']' }}</span>
          </div>
        </div>
        <div class="composer">
          <textarea v-model="draft" placeholder="回复顾客…（Ctrl+Enter 发送）" @keydown.ctrl.enter="send" />
          <button class="act" :disabled="busy" @click="send">发送</button>
        </div>
        <div class="sessionops">
          <button class="ghost" @click="act('releaseConversation')">放回队列</button>
          <button class="ghost" @click="act('escalateToMerchant')">升级给商户</button>
          <button class="ghost warn" @click="act('closeConversation')">结束会话</button>
        </div>
      </template>
      <p v-else class="empty center">从左边接一单开始 · 或点「我在接」切换会话</p>
    </main>

    <aside class="right">
      <h3>顾客 360</h3>
      <p v-if="panelNote" class="note">{{ panelNote }}</p>
      <div v-for="p in panels" :key="p.key" class="panel">
        <strong>{{ p.label }}</strong>
        <p v-if="p.error" class="note">取数失败</p>
        <template v-else-if="p.data && typeof p.data === 'object' && !Array.isArray(p.data)">
          <p v-for="(v, k) in p.data" :key="k" class="kv">{{ k }}：{{ v }}</p>
        </template>
        <p v-else-if="Array.isArray(p.data)" class="kv">{{ p.data.length }} 条</p>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.desk {
  display: grid;
  grid-template-columns: 240px 1fr 260px;
  height: 100vh;
}
aside {
  padding: 14px;
  background: var(--ld-bg);
  border-right: 1px solid var(--ld-purple-line);
  overflow-y: auto;
}
aside.right {
  border-right: none;
  border-left: 1px solid var(--ld-purple-line);
}
.topbar {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
select {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
h3 {
  margin: 12px 0 8px;
  font-size: 13px;
  color: var(--ld-purple-ink);
}
.qitem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  background: var(--ld-bg-lilac);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.qitem.on {
  outline: 2px solid var(--ld-purple-tab);
}
.qinfo {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.euid {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.wait {
  font-size: 11px;
  color: var(--ld-purple-meta);
}
.esc {
  font-size: 11px;
  color: #b9770e;
}
.empty {
  font-size: 12px;
  color: var(--ld-purple-meta);
}
.empty.center {
  text-align: center;
  margin-top: 40vh;
}
main {
  display: flex;
  flex-direction: column;
  padding: 14px;
}
.status {
  font-size: 13px;
  color: #c0392b;
  margin: 0 0 8px;
}
.thread {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.bubble {
  max-width: 70%;
  padding: 8px 12px;
  margin-bottom: 8px;
  border-radius: 12px;
  font-size: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
}
.bubble.out {
  margin-left: auto;
  background: var(--ld-bg-lilac);
  border-color: var(--ld-purple-tab);
}
.composer {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
textarea {
  flex: 1;
  min-height: 60px;
  padding: 10px 12px;
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  font-size: 14px;
  resize: vertical;
}
.sessionops {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.act {
  padding: 8px 20px;
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
.ghost {
  padding: 6px 14px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 999px;
  background: transparent;
  color: var(--ld-purple-meta);
  font-size: 12px;
  cursor: pointer;
}
.ghost.warn {
  color: #c0392b;
  border-color: #f0c0ba;
}
.panel {
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--ld-bg-lilac);
  border-radius: 8px;
  font-size: 12px;
}
.kv {
  margin: 3px 0;
  color: var(--ld-purple-meta);
}
.note {
  font-size: 12px;
  color: #b9770e;
}
</style>
