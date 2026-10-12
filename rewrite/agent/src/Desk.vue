<script setup lang="ts">
// 工作台单屏：左=待接队列+我在接；中=会话窗（3s 轮询·卸载清理·合并去重）；右=360 侧栏（双闸）。
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { post, logout, listKb } from './api/client'
import {
  mergeThread,
  keyOf,
  advanceCursor,
  mapQueue,
  deskErrorText,
  filterQuickReplies,
  diffNewSessions,
  diffNewInbound,
  titleWithBadge,
  createStatusController,
  skipWhileBusy,
  type Msg,
  type QueueItem,
  type KbEntry,
} from './lib/desk'

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
const listNote = ref('') // 队列/我在接拉失败出声（病根#14）：首屏失败不得装成「队列空 ✓」
const queueMore = ref(false) // 云端只回一页待接（nextCursor 在＝后面还有人在等），不说坐席会以为就这几个
const threadNote = ref('') // 打开会话拉消息失败出声（病根#14）：与 360 panelNote 同形；后台轮询仍静默
const message = ref('')
// 发送忙碌锁按会话隔离（组件级共享 busy 会让 A 会话发送在途拦住 B 会话发送）——
// reactive Set 按 sessionId 索引，只拦「同一会话」的重复发送；template :disabled 判 sendingIds.has(currentId)。
const sendingIds = reactive(new Set<string>())
const draftLen = computed(() => draft.value.length) // 接近 2000 字上限时显字数，避免后端静默截断坐席却不知道

// 顾客发图坐席可见（图片气泡）：组件内缓存，键＝msgid（只有入站客户消息带 hasMedia/msgid，出站/无媒体不入这张表）。
// 未点开＝表里没有该 key（视同 idle，占位卡「图片 · 点击加载」）；点击才触发 getMediaUrl 下载——回调侧不预下载，坐席按需拉取。
type MediaState = { state: 'idle' | 'loading' | 'loaded' | 'expired' | 'error'; url?: string }
const IDLE_MEDIA: MediaState = { state: 'idle' }
const mediaCache = reactive<Record<string, MediaState>>({})

function mediaOf(m: Msg): MediaState {
  return (m.msgid && mediaCache[m.msgid]) || IDLE_MEDIA
}

/** 点开图片占位卡：只有 idle/失败态才下载，加载中/已加载/已过期点击一律 no-op（已过期无重试路径）。
 *  经 getMediaUrl 下载——按会话归属+消息归属双闸走既有后端校验，前端只管展示三态
 *  （EXPIRED 显“已过期”不可重试；其余失败显“加载失败”可点重试；成功落 URL 供 <img> 显示）。 */
async function loadMedia(m: Msg) {
  const s = mediaOf(m).state
  if (!m.msgid || !currentId.value || (s !== 'idle' && s !== 'error')) return
  const key = m.msgid
  const sid = currentId.value // 快照归属会话（同 send/act/claim 治法：await 期间坐席可能已切会话，但该消息始终归 sid 所有）
  mediaCache[key] = { state: 'loading' }
  const r = await post('getMediaUrl', { sessionId: sid, msgId: key })
  if (r.ok) mediaCache[key] = { state: 'loaded', url: String(r.url || '') }
  else if (r.error === 'EXPIRED') mediaCache[key] = { state: 'expired' } // media_id 3 天有效·过期不提供重试（重试也无用）
  else mediaCache[key] = { state: 'error' } // 其余失败（下载/上传异常）：显示重试
}

/** 查看大图：临时 URL 新标签页打开（组件内缓存的 URL，非持久链接）。 */
function openMedia(m: Msg) {
  const c = mediaOf(m)
  if (c.state === 'loaded' && c.url) window.open(c.url, '_blank')
}

// 快捷回复 + 页内提醒（直接复用后端 listKb）。
const NOTIFY_KEY = 'ldrw_agent_notify_enabled'
const baseTitle = document.title // 还原基准单源＝index.html 定的标题，不复制字面量、避免漂移

const availableReplies = ref<KbEntry[]>([]) // 过滤后全部（供 FAQ 面板/判断整行显隐）
const quickReplies = computed(() => availableReplies.value.slice(0, 4)) // chips 只取前 4 条
const faqOpen = ref(false)
const faqQuery = ref('')
const faqFiltered = computed(() => {
  const q = faqQuery.value.trim().toLowerCase()
  if (!q) return availableReplies.value
  return availableReplies.value.filter((e) => e.question.toLowerCase().includes(q) || e.answer.toLowerCase().includes(q))
})

const notifyEnabled = ref(localStorage.getItem(NOTIFY_KEY) !== '0') // 缺省开
const badgeCount = ref(0)
let blurQueueIds: string[] | null = null // 窗口失焦时刻的队列会话 id 快照（null＝当前未失焦/已聚焦复位）
let blurMsgs: Msg[] | null = null // 窗口失焦时刻当前会话消息快照（无选中会话时为 null）

let pollTimer: ReturnType<typeof setInterval> | null = null
let listTimer: ReturnType<typeof setInterval> | null = null
// 每次 open() 加一：回包按「哪一次打开」认领。只比会话 id 挡不住重开同一会话（A→A、A→B→A）——
// 上一次打开发出的旧回包会被当成新一轮的，重开首拉又恰好失败时，窗口只剩半截、游标跳过前面的历史再也补不回
let openGen = 0

async function refreshLists() {
  const [q, m] = await Promise.all([post('listQueue'), post('listMyActive')])
  if (q.error === 'SESSION_LOST' || m.error === 'SESSION_LOST') return // 导登录单源＝壳层 onSessionLost；此处只停刷新，不自调 doLogout
  queue.value = q.ok ? mapQueue(q.items, Date.now()) : queue.value // 失败不清已有
  if (q.ok) queueMore.value = !!q.nextCursor
  mine.value = m.ok ? ((m.sessions as Record<string, any>[]) || []) : mine.value
  listNote.value = q.ok && m.ok ? '' : deskErrorText(q.ok ? m.error : q.error)
  recomputeAlert() // 队列增量是提醒聚合公式一半（改动契约 3）
}

async function pollThread(loud = false) {
  if (!currentId.value) return
  const sid = currentId.value // 会话粒度快照（防切会话后旧轮询回包串号——await 期间用户可能已切会话）
  const gen = openGen
  const r = await post('getThread', { sessionId: sid, cursor: cursor.value || undefined })
  // 期间重开过（含切会话）或会话已被 act 清掉·丢弃过期回包（不写进当前窗口的 msgs/cursor）
  if (gen !== openGen || sid !== currentId.value) return
  if (!r.ok) {
    if (loud) threadNote.value = deskErrorText(r.error) // 打开会话首拉失败出声；后台 setInterval 默认静默重试
    return
  }
  threadNote.value = ''
  msgs.value = mergeThread(msgs.value, r.messages) // 去重合并·不重气泡
  cursor.value = advanceCursor(cursor.value, r.nextCursor) // 只进不退
  recomputeAlert() // 当前会话新入站是提醒聚合公式另一半（改动契约 3）
}

/** 快捷回复读知识库（进入 Desk 拉一次·不轮询）：空→整行诚实隐藏；刷新失败不清已有（同 refreshLists）。 */
async function loadKb() {
  const r = await listKb()
  if (r.ok) availableReplies.value = filterQuickReplies(r.list)
}

/** 把答案追加进输入框（不自动发送）；无选中会话时无输入框可写，no-op。 */
function insertReply(answer: string) {
  if (!currentId.value) return
  draft.value = draft.value ? draft.value + '\n' + answer : answer
}

function openFaq() {
  if (!currentId.value) return
  faqOpen.value = true
}

function pickFaq(entry: KbEntry) {
  insertReply(entry.answer)
  faqOpen.value = false
}

/** 消息提醒开关（localStorage 持久·默认开）：关＝零副作用——立即清角标、还原标题，不再改 title/不再发声。 */
function toggleNotify() {
  notifyEnabled.value = !notifyEnabled.value
  localStorage.setItem(NOTIFY_KEY, notifyEnabled.value ? '1' : '0')
  if (!notifyEnabled.value) {
    badgeCount.value = 0
    document.title = baseTitle
  }
}

/** 提醒短音（Web Audio oscillator）：自动播放策略/无音频设备等环境限制下静默降级——非关键 UX 提示音，
 *  不是动钱/动状态的接缝失败，不接 observe.alert。 */
function playAlertSound() {
  try {
    const AudioCtxCls = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtxCls) return
    const ctx = new AudioCtxCls()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.value = 0.15
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
    osc.onended = () => void ctx.close()
  } catch {
    // 见上方函数注释：非关键 UX 提示音，静默降级
  }
}

/** 提醒聚合：N = 队列新增会话数 + 失焦期间当前会话新入站消息数。
 *  未失焦（blurQueueIds 为 null）或提醒已关＝不计，保持零副作用。 */
function recomputeAlert() {
  if (!notifyEnabled.value || blurQueueIds === null) return
  const n =
    diffNewSessions(
      blurQueueIds,
      queue.value.map((q) => q.sessionId),
    ) + diffNewInbound(blurMsgs, msgs.value)
  if (n === badgeCount.value) return
  const grew = n > badgeCount.value
  badgeCount.value = n
  document.title = titleWithBadge(baseTitle, n)
  if (grew) playAlertSound()
}

function onWindowBlur() {
  blurQueueIds = queue.value.map((q) => q.sessionId)
  blurMsgs = currentId.value ? msgs.value.slice() : null
}

function onWindowFocus() {
  badgeCount.value = 0
  blurQueueIds = null
  blurMsgs = null
  document.title = baseTitle
}

async function claim(sessionId: string) {
  // 快照点击时所在会话（五个会话敏感异步动作 pollThread/open/act/send/claim 同一治法）：
  // claim 在途期间坐席可能已主动打开另一会话并打字，慢回包若无条件 open(sessionId)
  // 会把视图拽回来、且 open 的切会话清草稿把人家正在打的字清掉。
  const before = currentId.value
  const r = await post('claimConversation', { sessionId })
  if (currentId.value === before) {
    message.value = r.ok ? '' : deskErrorText(r.error)
    if (r.ok) void open(sessionId)
  }
  void refreshLists() // 认领已在服务端生效——列表刷新无条件（会话会出现在「我在接」，坐席可自行点开）
}

async function open(sessionId: string) {
  // 切会话前清未发草稿（草稿留在输入框会随下一次 Ctrl+Enter 以新会话 sessionId 误发）
  if (sessionId !== currentId.value) draft.value = ''
  openGen++
  currentId.value = sessionId
  msgs.value = []
  cursor.value = 0
  panels.value = []
  panelNote.value = ''
  threadNote.value = ''
  await pollThread(true) // 首拉失败写出 threadNote（与 360 panelNote 同形）；后台轮询仍走默认静默
  const p = await post('getSessionCustomer360', { sessionId })
  if (currentId.value !== sessionId) return // 期间又切了别的会话·丢弃过期 360 回包（同 pollThread 治法）
  if (p.ok) panels.value = (p.panels as Record<string, any>[]) || []
  else panelNote.value = deskErrorText(p.error) // NO_BRIDGE/NO_CONSENT 如实显示
}

async function send() {
  const text = draft.value.trim()
  if (!text || !currentId.value) return
  const sid = currentId.value // 会话粒度快照（同 act()/open() 治法：await 期间用户可能已切会话——若不快照，
  // A 发送在途时切到 B 并打新草稿，A 的回包落地会用 currentId.value（此刻已是 B）误清掉 B 正在打的字）
  if (sendingIds.has(sid)) return // 忙碌锁按会话隔离——只拦同一会话的重复发送，不误伤别的会话
  sendingIds.add(sid)
  try {
    const r = await post('sendAgentMessage', { sessionId: sid, text })
    if (currentId.value === sid) {
      // 期间已切别的会话——以下 UI 效果不落地：不清掉新会话正在打的字（open() 切会话时已清过旧草稿，
      // 框里现在是新会话的新字，这里「不清」正是期望行为，不是遗漏）、不把旧会话的失败提示标到新会话上
      if (r.ok) {
        draft.value = '' // 只有发成功才清输入框（失败清框=顾客话丢了）
        void pollThread()
      } else {
        message.value = deskErrorText(r.error)
      }
    }
  } finally {
    sendingIds.delete(sid) // 无条件复位（不受 currentId 复核约束）：按会话粒度复位，否则该会话按钮永久卡死；不影响其它会话的锁
  }
}

async function act(action: string) {
  if (!currentId.value) return
  const sid = currentId.value // 会话粒度快照（同 pollThread/open 治法：await 期间用户可能已切会话）
  const r = await post(action, { sessionId: sid })
  if (currentId.value === sid) {
    // 期间已切别的会话·丢弃过期回包的 UI 效果（不把 A 的报错标到 B 上、不清掉正在看的 B 会话）
    message.value = r.ok ? '' : deskErrorText(r.error)
    if (r.ok && (action === 'releaseConversation' || action === 'closeConversation' || action === 'escalateToMerchant')) {
      currentId.value = ''
      msgs.value = []
      // 防 PII 残留：右栏「顾客 360」无 v-if="currentId" 门控，不随会话清空——放回队列/结束/升级后
      // 该客户可能已被别的坐席接手，panels/panelNote 若留着上一客户资料即跨会话 PII 残留。与 currentId/msgs 并列清空。
      panels.value = []
      panelNote.value = ''
    }
  }
  void refreshLists()
}

const statusCtl = createStatusController(post, status.value)
async function setStatus(s: 'online' | 'busy' | 'offline') {
  await statusCtl.setStatus(s, { setStatus: (v) => (status.value = v), setMessage: (v) => (message.value = v) }, deskErrorText)
}

function doLogout() {
  void logout() // 本地令牌同步清掉，服务端吊销不等回包
  emit('logout')
}

// 包装只建一次：切回可见的补拉也走同一把在途闸，隐藏时发出的慢请求没回来就不重复发
const tickLists = skipWhileBusy(refreshLists)
const tickThread = skipWhileBusy(() => pollThread(), () => currentId.value)

// 隐藏只降频不全停（#400-31）：坐席切去别的标签页时，标题角标+提示音（recomputeAlert）仍靠轮询发现新顾客/新消息，
// 全停就等于人不回来顾客一直没人理。30s 是「发现延迟」与「后台计费」的折中旋钮。
// 注意 Chrome 隐藏满 5 分钟后本就把链式定时器压到每分钟一次，所以降频省下的主要是隐藏后头 5 分钟；
// 稳态计费大头是可见挂着的 3s/10s，不在这里。
function schedule() {
  if (pollTimer) clearInterval(pollTimer)
  if (listTimer) clearInterval(listTimer)
  const hidden = document.visibilityState === 'hidden'
  listTimer = setInterval(tickLists, hidden ? 30_000 : 10_000)
  pollTimer = setInterval(tickThread, hidden ? 30_000 : 3_000)
}

function onVisibilityChange() {
  schedule()
  if (document.visibilityState === 'hidden') return
  void tickLists() // 切回来不等下一拍：后台那段最多落后 30s
  void tickThread()
}

onMounted(() => {
  void refreshLists()
  void loadKb() // KB 拉一次·不轮询（改动契约 1）
  schedule()
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (listTimer) clearInterval(listTimer)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  // 卸载必还原标题：失焦期间登出（如轮询收到 SESSION_LOST）会带着角标态卸载——不还原则标题
  // 永久停留在带角标字符串上；且下次重登 mount 时会把这个已污染的标题当新 baseTitle 捕获，
  // 跨多次「失焦掉线-重登」循环叠加复合（与 toggleNotify/onWindowFocus 的还原语义保持一致）。
  document.title = baseTitle
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
        <button class="pill" :class="{ off: !notifyEnabled }" @click="toggleNotify">消息提醒 · {{ notifyEnabled ? '开' : '关' }}</button>
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
      <p v-if="queueMore" class="note">待接不止 {{ queue.length }} 条，列表未显示全部</p>
      <p v-if="listNote" class="note">{{ listNote }}</p>
      <p v-else-if="!queue.length" class="empty">队列空 ✓</p>
      <h3>我在接（{{ mine.length }}）</h3>
      <div v-for="s in mine" :key="s.sessionId" class="qitem" :class="{ on: s.sessionId === currentId }" @click="open(String(s.sessionId))">
        <span class="euid">{{ String(s.externalUserId || '').slice(-8) }}</span>
      </div>
    </aside>

    <main>
      <p v-if="message" class="status">{{ message }}</p>
      <div v-if="availableReplies.length" class="quickbar">
        <button
          v-for="qr in quickReplies"
          :key="qr.key"
          class="chip"
          :disabled="!currentId"
          :title="qr.question"
          @click="insertReply(qr.answer)"
        >{{ qr.question.length > 12 ? qr.question.slice(0, 12) + '…' : qr.question }}</button>
        <button class="chip faq" :disabled="!currentId" @click="openFaq">FAQ 面板</button>
      </div>
      <template v-if="currentId">
        <p v-if="threadNote" class="note">{{ threadNote }}</p>
        <div class="thread">
          <!-- :key 与 lib/desk.ts 去重键 keyOf 同源：若用 at+direction+text 当键，同秒同向
               两张图（msgid 不同、text 恒为占位）时撞 Vue 重复 key——去重键认 msgid，key 必须同源 -->
          <div v-for="m in msgs" :key="keyOf(m)" class="bubble" :class="m.direction">
            <template v-if="m.msgtype === 'image' && m.hasMedia">
              <div class="media" :class="mediaOf(m).state" @click="loadMedia(m)">
                <img v-if="mediaOf(m).state === 'loaded'" :src="mediaOf(m).url" class="media-img" @click.stop="openMedia(m)" />
                <span v-else-if="mediaOf(m).state === 'loading'">加载中…</span>
                <span v-else-if="mediaOf(m).state === 'expired'">图片已过期（超 3 天）</span>
                <span v-else-if="mediaOf(m).state === 'error'">加载失败，点击重试</span>
                <span v-else>图片 · 点击加载</span>
              </div>
              <button v-if="mediaOf(m).state === 'loaded'" class="ghost media-view" @click="openMedia(m)">查看大图</button>
            </template>
            <span v-else class="text">{{ m.text || '[' + (m.msgtype || '非文本') + ']' }}</span>
          </div>
        </div>
        <div class="composer">
          <div class="composer-field">
            <textarea
              v-model="draft"
              maxlength="2000"
              placeholder="回复顾客…（Ctrl+Enter 发送）"
              @keydown.ctrl.enter="send"
            />
            <!-- 与 agentDesk.ts MAX_TEXT 手动同步——kit str() 超长静默截断，接近上限先给坐席看见 -->
            <span v-if="draftLen >= 1900" class="charcount">{{ draftLen }}/2000</span>
          </div>
          <button class="act" :disabled="sendingIds.has(currentId)" @click="send">发送</button>
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

    <div v-if="faqOpen" class="faq-overlay" @click.self="faqOpen = false">
      <div class="faq-panel">
        <div class="faq-head">
          <input v-model="faqQuery" class="faq-search" placeholder="搜关键字…" />
          <button class="ghost" @click="loadKb">刷新</button>
          <button class="ghost" @click="faqOpen = false">关闭</button>
        </div>
        <div class="faq-list">
          <div v-for="e in faqFiltered" :key="e.key" class="faq-item" @click="pickFaq(e)">
            <strong>{{ e.question }}</strong>
            <p>{{ e.answer }}</p>
          </div>
          <p v-if="!faqFiltered.length" class="empty">没有匹配的条目</p>
        </div>
      </div>
    </div>
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
  color: var(--ld-amber);
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
  color: var(--ld-red);
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
.media {
  cursor: pointer;
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.media.error {
  color: var(--ld-red);
}
.media-img {
  max-width: 100%;
  max-height: 220px;
  border-radius: 8px;
  display: block;
  cursor: pointer;
}
.media-view {
  margin-top: 6px;
}
.composer {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.composer-field {
  position: relative;
  flex: 1;
}
textarea {
  display: block;
  width: 100%;
  min-height: 60px;
  padding: 10px 12px 24px;
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  font-size: 14px;
  resize: vertical;
}
.charcount {
  position: absolute;
  right: 16px;
  bottom: 6px;
  font-size: 11px;
  color: var(--ld-purple-meta);
  pointer-events: none;
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
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.pill {
  padding: 6px 14px;
  border: 1px solid var(--ld-purple-tab);
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-purple-ink);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.pill.off {
  border-color: var(--ld-purple-line);
  background: transparent;
  color: var(--ld-purple-meta);
}
.quickbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.chip {
  padding: 6px 12px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-purple-ink);
  font-size: 12px;
  cursor: pointer;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip.faq {
  background: transparent;
  border-color: var(--ld-purple-tab);
}
.chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.faq-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.faq-panel {
  width: min(480px, 90vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--ld-bg);
  border-radius: var(--ld-radius);
  border: 1px solid var(--ld-purple-line);
  padding: 14px;
}
.faq-head {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.faq-search {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.faq-list {
  overflow-y: auto;
}
.faq-item {
  padding: 8px 10px;
  margin-bottom: 6px;
  background: var(--ld-bg-lilac);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.faq-item p {
  margin: 4px 0 0;
  color: var(--ld-purple-meta);
  font-size: 12px;
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
  color: var(--ld-amber);
}
</style>
