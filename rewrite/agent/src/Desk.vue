<script lang="ts">
// 坐席状态并发收敛（Round3 item3）单独放非 setup 的 <script> 块（Vue 官方支持 <script>+<script setup> 并存、
// 顶层绑定 setup script 直接可见）：抽成与 Vue 响应式无关的纯函数，是为了让 tests/desk.test.ts 能在本仓
// 没装 @vue/test-utils/jsdom 的情况下，用 @vue/compiler-sfc 的 parse() 把本块源码原样抽出动态 import 直测——
// 测的是这份真代码本身，不是另抄一份影子实现（P2 findings 复审新增：批5/6 只有人工推演、无回归测试钉住时序）。
// UI 落地经 apply 回调交回调用方（<script setup> 里传 ref.value 赋值），本函数不碰 ref/Vue API。
export function createStatusController(
  post: (_action: string, _payload?: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>,
  initial: 'online' | 'busy' | 'offline' = 'online', // 与 Desk.vue 里 status ref 的初始值同步（调用方传入，防两处漂移）
) {
  let statusSeq = 0 // 代际守卫（P2·回归修复：连续切状态时先发后到的失败请求不得用旧 prev 覆盖已被后一次成功请求确认的新状态——ABA 竞态，同 pollThread/open 的 sid 快照代际治法）
  let confirmedStatus: 'online' | 'busy' | 'offline' = initial // 服务端最后一次确认过的真值（P2·bug sweep Round2 item15·批4 修复不彻底：
  // 回滚锚原取 prev（当次调用前的 UI 乐观值，可能也从未被服务端确认过）——连续两次都失败时会回滚到一个同样没被确认过的中间态，
  // 与服务端实际状态脱节。改锚定"最后一次 r.ok 时的目标值"，回滚落到已知的服务端真值上。
  let confirmedGen = 0 // 锚的代际号（Round3 item3a）：批5「过期成功也无条件刷锚」是矛盾源头——fresh 请求失败、更早发出的 stale 请求后回包成功，
  // 会用旧目标覆盖更新的锚。改为只在 my > confirmedGen 时才让成功回包刷锚，锚只能被更新代际的成功推进、不会被过期成功倒退。
  let inFlight = 0 // 在途请求计数（Round3 item3b）：连续切换在两个请求都挂起时都会乐观改 UI，但只有 fresh 失败会显式回滚——
  // stale 失败或裸的乱序組合下 UI 可能停在一个既非服务端状态、也未被任何分支收尾的错位态。全部请求收尾后（inFlight 归零）
  // 无条件把 UI 收敛到锚，保证「静止后 UI 必等于最后已知服务端真值」，不依赖具体到达顺序。
  //
  // 合并推演（Round3 场景核对，测试见 tests/desk.test.ts「坐席状态并发收敛」）：
  // ① fresh 失败 + stale 成功乱序（先点 busy=R1/my=1，后点 offline=R2/my=2；回包顺序 R2 先且失败、R1 后且成功）：
  //    R2 失败时 my=2===statusSeq → 回滚到当时锚（初值）并报错；R1 成功后到（过期调用·不碰 UI 不弹错），my=1>confirmedGen(0) 把锚推到 busy；
  //    inFlight 归零静止收敛把 UI 收到 confirmedStatus=busy——与服务端一致（两请求只有 R1 被服务端接受）。
  // ② 双成功乱序（先发的后到）：confirmedGen 只会被更大 my 推进，后一次用户意图（更大 my）即使先到也已把锚设对，更早那次即使后到 my 更小也被挡在
  //    if my>confirmedGen 外——锚保持在最后用户意图，不被旧的成功回填。
  // ③ 单请求成功/失败：行为与批5 现状等价（成功刷锚+静止收敛回填同值=no-op；失败回滚到锚+报错，语义不变）。
  // 残余边界：服务端实际处理顺序不可知（无服务端版本号做仲裁），本修复只保证「本地已知信息下 UI 最终收敛到最新确认锚」，不保证与服务端处理顺序强一致，无服务端版本号不可根治，此处记档。
  return {
    async setStatus(
      s: 'online' | 'busy' | 'offline',
      apply: { setStatus: (_v: 'online' | 'busy' | 'offline') => void; setMessage: (_v: string) => void },
      errorText: (_code: string | undefined) => string,
    ) {
      const my = ++statusSeq // 本次操作的代际号
      inFlight++
      apply.setStatus(s) // 乐观更新（下拉选中即时反映）
      const r = await post('setAgentStatus', { status: s })
      inFlight--
      if (r.ok && my > confirmedGen) {
        confirmedStatus = s // 锚按代际取最新成功：只在本次比锚当前代际更新时才刷新，过期成功不再倒退锚
        confirmedGen = my
      }
      if (my === statusSeq && !r.ok) {
        // 报错提示与显式回滚仅对最新一次调用（既有语义保留）：过期调用的失败不弹错、不主动回滚（回滚交给下面的静止收敛统一处理）
        apply.setStatus(confirmedStatus) // 服务端没接受·回滚到最后一次真被确认过的状态（非未必被确认过的 prev）
        apply.setMessage(errorText(r.error)) // 照本文件既有错误提示范式（同 claim/act）
      }
      if (inFlight === 0) apply.setStatus(confirmedStatus) // 静止收敛：全部请求落定后无条件把 UI 收到锚，兜住乱序下未被上面分支覆盖到的错位态
    },
  }
}
</script>

<script setup lang="ts">
// 工作台单屏（M3 批8）：左=待接队列+我在接；中=会话窗（3s 轮询·卸载清理·合并去重）；右=360 侧栏（双闸）。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { post, logout, listKb } from './api/client'
import {
  mergeThread,
  advanceCursor,
  mapQueue,
  deskErrorText,
  filterQuickReplies,
  diffNewSessions,
  diffNewInbound,
  titleWithBadge,
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
const message = ref('')
const busy = ref(false)

// 快捷回复 + 页内提醒（批 B4·预审裁决：listKb 后端零改动直接复用，不新建 listQuickReplies）。
const NOTIFY_KEY = 'ldrw_agent_notify_enabled'
const baseTitle = document.title // 还原基准单源＝index.html 定的标题，不复制字面量、避免漂移

const kbList = ref<KbEntry[]>([])
const availableReplies = computed(() => filterQuickReplies(kbList.value)) // 过滤后全部（供 FAQ 面板/判断整行显隐）
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

async function refreshLists() {
  const [q, m] = await Promise.all([post('listQueue'), post('listMyActive')])
  if (q.error === 'SESSION_LOST' || m.error === 'SESSION_LOST') return doLogout()
  queue.value = q.ok ? mapQueue(q.items, Date.now()) : queue.value // 失败不清已有
  mine.value = m.ok ? ((m.sessions as Record<string, any>[]) || []) : mine.value
  recomputeAlert() // 队列增量是提醒聚合公式一半（改动契约 3）
}

async function pollThread() {
  if (!currentId.value) return
  const sid = currentId.value // 会话粒度快照（P1·item8：防切会话后旧轮询回包串号——await 期间用户可能已切会话）
  const r = await post('getThread', { sessionId: sid, cursor: cursor.value || undefined })
  if (sid !== currentId.value) return // 期间已切别的会话·丢弃过期回包（不写进新会话的 msgs/cursor）
  if (!r.ok) return // 轮询失败静默重试（不打断输入）
  msgs.value = mergeThread(msgs.value, r.messages) // 去重合并·不重气泡
  cursor.value = advanceCursor(cursor.value, r.nextCursor) // 只进不退
  recomputeAlert() // 当前会话新入站是提醒聚合公式另一半（改动契约 3）
}

/** 快捷回复读知识库（进入 Desk 拉一次·不轮询）：失败/空→过滤后自然为空，整行诚实隐藏。 */
async function loadKb() {
  const r = await listKb()
  kbList.value = r.ok ? ((r.list as KbEntry[]) || []) : []
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

/** 提醒聚合（改动契约 3·公式见批规格）：N = 队列新增会话数 + 失焦期间当前会话新入站消息数。
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
  // 快照点击时所在会话（bug sweep II R5）：本文件五个会话敏感异步动作（pollThread/open/act/send/claim）里
  // 最后一个补快照的——claim 在途期间坐席可能已主动打开另一会话并打字，慢回包若无条件 open(sessionId)
  // 会把视图拽回来、且 open 的切会话清草稿把人家正在打的字清掉（同 send/act 治法·item8 家族收口）。
  const before = currentId.value
  const r = await post('claimConversation', { sessionId })
  if (currentId.value === before) {
    message.value = r.ok ? '' : deskErrorText(r.error)
    if (r.ok) void open(sessionId)
  }
  void refreshLists() // 认领已在服务端生效——列表刷新无条件（会话会出现在「我在接」，坐席可自行点开）
}

async function open(sessionId: string) {
  // 切会话前清未发草稿（B2·item8 输入侧同源：草稿留在输入框会随下一次 Ctrl+Enter 以新会话 sessionId 误发）
  if (sessionId !== currentId.value) draft.value = ''
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
  const sid = currentId.value // 会话粒度快照（F4·同 act()/open() 治法：await 期间用户可能已切会话——若不快照，
  // A 发送在途时切到 B 并打新草稿，A 的回包落地会用 currentId.value（此刻已是 B）误清掉 B 正在打的字）
  busy.value = true
  const r = await post('sendAgentMessage', { sessionId: sid, text })
  busy.value = false // 无条件复位（不受 sid 复核约束）：否则切会话后发送按钮永久卡死不可用
  if (currentId.value === sid) {
    // 期间已切别的会话——以下 UI 效果不落地：不清掉新会话正在打的字（open() 切会话时已清过旧草稿，
    // 框里现在是新会话的新字，这里「不清」正是期望行为，不是遗漏）、不把旧会话的失败提示标到新会话上
    if (r.ok) {
      draft.value = '' // 只有发成功才清输入框（旧线 95018 教训：失败清框=顾客话丢了）
      void pollThread()
    } else {
      message.value = deskErrorText(r.error)
    }
  }
}

async function act(action: string) {
  if (!currentId.value) return
  const sid = currentId.value // 会话粒度快照（B3·同 pollThread/open 治法·item8：await 期间用户可能已切会话）
  const r = await post(action, { sessionId: sid })
  if (currentId.value === sid) {
    // 期间已切别的会话·丢弃过期回包的 UI 效果（不把 A 的报错标到 B 上、不清掉正在看的 B 会话）
    message.value = r.ok ? '' : deskErrorText(r.error)
    if (r.ok && (action === 'releaseConversation' || action === 'closeConversation' || action === 'escalateToMerchant')) {
      currentId.value = ''
      msgs.value = []
      // K1（bug sweep II·PII 残留）：右栏「顾客 360」无 v-if="currentId" 门控，不随会话清空——放回队列/结束/升级后
      // 该客户可能已被别的坐席接手，panels/panelNote 若留着上一客户资料即跨会话 PII 残留。与 currentId/msgs 并列清空。
      panels.value = []
      panelNote.value = ''
    }
  }
  void refreshLists()
}

// 状态并发收敛逻辑本体（并发代际/回滚/静止收敛的推演与守卫说明）在上方非 setup 的 <script> 块 createStatusController——
// 抽出去是为了不装 @vue/test-utils/jsdom 也能被 tests/desk.test.ts 直接单测到真代码（见该函数顶部注释）。
const statusCtl = createStatusController(post, status.value)
async function setStatus(s: 'online' | 'busy' | 'offline') {
  await statusCtl.setStatus(s, { setStatus: (v) => (status.value = v), setMessage: (v) => (message.value = v) }, deskErrorText)
}

function doLogout() {
  logout()
  emit('logout')
}

onMounted(() => {
  void refreshLists()
  void loadKb() // KB 拉一次·不轮询（改动契约 1）
  listTimer = setInterval(refreshLists, 10_000)
  pollTimer = setInterval(pollThread, 3_000)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('focus', onWindowFocus)
})
onBeforeUnmount(() => {
  // 轮询必清理（守卫 agent-poll-cleanup 的教训承接）
  if (pollTimer) clearInterval(pollTimer)
  if (listTimer) clearInterval(listTimer)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('focus', onWindowFocus)
  // 卸载必还原标题（P2 修复）：失焦期间登出（如轮询收到 SESSION_LOST）会带着角标态卸载——不还原则标题
  // 永久停留在带角标字符串上；且下次重登 mount 时 line 89 会把这个已污染的标题当新 baseTitle 捕获，
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
      <p v-if="!queue.length" class="empty">队列空 ✓</p>
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
  color: #b9770e;
}
</style>
