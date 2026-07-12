<script setup lang="ts">
// 客服会话（设计语言一致性·M3 UI 批13 + 批 B6 深链预填）：按客户检索时间轴 + 质检报表（样本口径诚实标注）。
// 深链预填（批 B6·本页原无 route.query 读取能力·新增最小实现）：Csat.vue 差评行「查会话」
// router.push({path:'/conversations', query:{externalUserId}}) 跳转过来——挂载时读 route.query.externalUserId/
// openid 预填输入框并自动检索一次（同 Batches.vue/Cards.vue 既有「props(嵌入) || route.query(深链) || 空」范式）。
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Search, RotateCcw, ClipboardCheck } from 'lucide-vue-next'
import { searchConversations, conversationsReport, sampleQc, saveQcMark, listQcSampled } from '../api/cs'
import { mapMessages, mapReport, mapQcRows, type MsgVM, type ReportVM, type QcRowVM } from '../lib/mapCs'
import { useLatest } from '../lib/latest'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const route = useRoute()
const openid = ref(String(route.query.openid || ''))
const externalUserId = ref(String(route.query.externalUserId || ''))
const keyword = ref('')
const msgs = ref<MsgVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const searched = ref(false)
const report = ref<ReportVM | null>(null)
const message = ref('')
// 首响 SLA 阈值（分钟）：初值 5 与后端 conversations.ts DEFAULT_SLA_MS 同口径（P2 顺手改批——此前前端默认 30
// 分钟，首次挂载即把它当参数传给后端，用「猜的默认值」悄悄覆盖了后端实际生效口径，两个数字互相打架）。
// 首次加载不传该值（见 loadReport slaMinInited 分支），让后端用它自己的 DEFAULT_SLA_MS 计算，回包后用后端
// 权威 slaMs 回填本地显示——今后改后端默认值不用两处同步改，前端自动跟上。
const slaMin = ref(5)
let slaMinInited = false // true＝已有一次成功回填（此后「重算」才带用户当前输入值，不再吞后端权威口径）
const reportBusy = ref(false)

async function loadReport() {
  reportBusy.value = true
  const r = await conversationsReport(slaMinInited ? slaMin.value * 60000 : undefined)
  reportBusy.value = false
  report.value = mapReport(r) // 出错/空档都为 null（卡隐）——出错时另透传原文，别让「加载失败」被读成「暂无数据」
  if (r.ok) {
    const backendSlaMs = Number((r as any).slaMs) // 后端回传的本次实际生效阈值（权威·见 conversationsReport 回包 slaMs 字段）
    if (Number.isFinite(backendSlaMs) && backendSlaMs > 0) slaMin.value = Math.round(backendSlaMs / 60000) || slaMin.value
    slaMinInited = true
  } else {
    message.value = '质检报表加载失败：' + String((r as any).error || '') // 报错带原文（病根#14·对齐 search）
  }
}

// 发起检索时的筛选快照（翻页复用·防用户改输入框后点「更早」用新筛选+旧 cursor 串档·P2）
let searchFilter: { openid?: string; externalUserId?: string; keyword?: string } = {}
const pageGen = useLatest() // 检索/翻页乱序守卫（P2·在途时又检索/翻页·旧结果别覆盖/混排新结果·根因#8）
const searching = ref(false) // search 专属在途标志（迭代G·单写布尔·more 加载闸不受 loadReport 等旁路 message 写者干扰）
async function search() {
  message.value = '检索中…'
  searching.value = true
  searchFilter = { openid: openid.value.trim() || undefined, externalUserId: externalUserId.value.trim() || undefined, keyword: keyword.value.trim() || undefined }
  const my = pageGen.begin()
  const r = await searchConversations(searchFilter)
  if (pageGen.isStale(my)) return // 已发起更新的检索·丢弃过期结果（由更新的 search 负责复位 searching）
  searching.value = false // 本次是最新·检索完成
  msgs.value = r.ok ? mapMessages(r.messages) : []
  cursor.value = r.ok ? r.nextCursor : null
  hasMore.value = !!(r.ok && r.hasMore)
  searched.value = true
  message.value = r.ok ? (msgs.value.length ? '' : '没有匹配的会话') : '检索失败：' + String(r.error || '')
}

async function more() {
  if (!hasMore.value || cursor.value == null) return
  if (searching.value) return // 检索在途时不翻页（cursor 还是旧的）——覆盖 search 先于 more 的序（单写布尔·不受 loadReport 等旁路 message 写者干扰）
  const gen = pageGen.peek() // 绑定当前 search 代际·不递增（不反噬在途 search）·新检索会作废本页（迭代F 逮出）
  const r = await searchConversations({ ...searchFilter, cursor: cursor.value }) // 复用检索快照·不现读输入框（防串档）
  if (pageGen.isStale(gen)) return // 期间又检索·放弃本页（防混排）
  if (!r.ok) {
    message.value = '加载更多失败：' + String(r.error || '') // 别静默吞·反复点无反应（病根#14）
    return
  }
  message.value = '' // 翻页成功清旧错（P2·item5：上次失败留的「加载更多失败」提示别一直挂在成功之后）
  const seen = new Set(msgs.value.map((m) => m.id)) // 去重·防双击「更早」重复追加同一页（迭代F·对齐 Orders/Refunds）
  msgs.value = [...msgs.value, ...mapMessages(r.messages).filter((m) => !seen.has(m.id))]
  cursor.value = r.nextCursor
  hasMore.value = !!r.hasMore
}

// —— 质检抽检（批 B7）——
// sessionKey＝csSession._id（非 externalUserId·与「会话检索」上方 openid/externalUserId 输入框语义不同）。
// 编辑态附在纯映射 QcRowVM 之外（draftScore/draftNote/busy/err 只在本组件用·mapCs.ts 保持纯映射不掺 UI 态）。
interface QcRow extends QcRowVM {
  draftScore: number // 0=未选（下拉留空态）
  draftNote: string
  busy: boolean
  err: string
}
function toQcRow(v: QcRowVM): QcRow {
  return { ...v, draftScore: v.scored ? v.score : 0, draftNote: v.scored ? v.note : '', busy: false, err: '' }
}
const qcRows = ref<QcRow[]>([])
const qcCursor = ref<unknown>(null)
const qcHasMore = ref(false)
const qcMsg = ref('')
const qcSampling = ref(false)
const qcGen = useLatest() // 乱序守卫（同 search/loadEntries 范式·防在途请求互相覆盖）

// 池内已抽/已评（由已加载的行现算·不编未加载部分的数——诚实反映「当前看到多少」而非库内总数）
function qcStat(): string {
  if (!qcRows.value.length) return ''
  const scored = qcRows.value.filter((r) => r.scored).length
  return `已加载 ${qcRows.value.length} 条抽样 · 已评 ${scored} 条`
}

function mergeQcRows(list: QcRowVM[]) {
  const seen = new Set(qcRows.value.map((r) => r.sessionKey))
  const fresh = list.filter((r) => !seen.has(r.sessionKey)).map(toQcRow)
  qcRows.value = [...qcRows.value, ...fresh]
}

async function loadQcSampled() {
  qcMsg.value = qcRows.value.length ? qcMsg.value : '加载中…'
  const my = qcGen.begin()
  const r = await listQcSampled({})
  if (qcGen.isStale(my)) return
  if (!r.ok) {
    qcMsg.value = '加载失败：' + String(r.error || '')
    return
  }
  qcRows.value = mapQcRows(r.list).map(toQcRow)
  qcCursor.value = r.nextCursor
  qcHasMore.value = !!r.hasMore
  qcMsg.value = qcRows.value.length ? '' : '暂无抽样记录，点「随机抽取」开始质检'
}

async function moreQc() {
  if (!qcHasMore.value || qcCursor.value == null) return
  const gen = qcGen.peek()
  const r = await listQcSampled({ cursor: qcCursor.value })
  if (qcGen.isStale(gen)) return
  if (!r.ok) {
    qcMsg.value = '加载更多失败：' + String(r.error || '')
    return
  }
  qcMsg.value = ''
  mergeQcRows(mapQcRows(r.list)) // dedup-by-id（同 Conversations 消息翻页/Csat 明细范式）
  qcCursor.value = r.nextCursor
  qcHasMore.value = !!r.hasMore
}

async function doSampleQc() {
  qcSampling.value = true
  qcMsg.value = ''
  const r = await sampleQc(10)
  qcSampling.value = false
  if (!r.ok) {
    qcMsg.value = '抽样失败：' + String(r.error || '')
    return
  }
  const fresh = mapQcRows(r.sampled).map(toQcRow)
  if (!fresh.length) {
    qcMsg.value = '候选池已抽完（所有已结束会话都已抽样或已评分）'
    return
  }
  const freshKeys = new Set(fresh.map((row) => row.sessionKey))
  qcRows.value = [...fresh, ...qcRows.value.filter((row) => !freshKeys.has(row.sessionKey))] // 新抽的置顶·dedup 防重复点击
}

async function saveQc(row: QcRow) {
  if (row.draftScore < 1 || row.draftScore > 5) {
    row.err = '请先选择评分'
    return
  }
  row.busy = true
  row.err = ''
  const r = await saveQcMark(row.sessionKey, row.draftScore, row.draftNote.trim())
  row.busy = false
  if (!r.ok) {
    row.err = r.error === 'ALREADY_MARKED' ? '已被评过分（可能是并发保存）' : '保存失败：' + String(r.error || '')
    return
  }
  row.scored = true
  row.score = row.draftScore
  row.note = row.draftNote.trim()
}

function viewQcSession(row: QcRow) {
  if (!row.externalUserId) return
  externalUserId.value = row.externalUserId
  void search()
}

onMounted(() => {
  void loadReport()
  void loadQcSampled()
  if (openid.value || externalUserId.value) void search() // 深链预填带值即自动检索一次（省一次手点）
})
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

    <!-- 质检抽检（批 B7）：closed 会话随机抽样 → 人工评分 1-5 + 备注·粒度=会话档级（非轮次，csSession 无轮次实体） -->
    <Card title="质检抽检" sub="从已结束会话里随机抽样，人工评分 1-5 + 备注留痕">
      <template #head>
        <UiButton size="sm" :disabled="qcSampling" @click="doSampleQc">
          <ClipboardCheck :size="14" :stroke-width="1.8" /><span>{{ qcSampling ? '抽取中…' : '随机抽取 10 条' }}</span>
        </UiButton>
      </template>

      <p v-if="qcStat()" class="ld-status qc-stat">{{ qcStat() }}</p>
      <p v-if="qcMsg" class="ld-status">{{ qcMsg }}</p>
      <!-- 口径告知（同上方「会话检索」report-note 精神）：消息数/首响是按该客户近期消息聚合算的，
           不是本次抽中的这条 closed 会话独有——该客户若还有其他历史/并行会话，数字会混入那些会话 -->
      <p class="report-note qc-agg-note">消息数 / 首响按该客户近期消息聚合计算，非本次抽中会话独有——仅供参考，评分请以时间轴内容为准。</p>

      <div v-if="qcRows.length" class="ld-table">
        <div class="ld-thead">
          <div class="ld-th" :style="{ width: '110px' }">客户尾号</div>
          <div class="ld-th" :style="{ width: '150px' }">抽样时间</div>
          <div class="ld-th" :style="{ width: '80px' }">消息数</div>
          <div class="ld-th" :style="{ width: '90px' }">首响</div>
          <div class="ld-th" :style="{ width: '90px' }">评分</div>
          <div class="ld-th grow">备注</div>
          <div class="ld-th ops-cell" :style="{ width: '130px' }">操作</div>
        </div>
        <div class="ld-tbody">
          <div v-for="row in qcRows" :key="row.sessionKey" class="ld-tr">
            <div class="ld-td mono" :style="{ width: '110px' }">{{ row.tailId }}</div>
            <div class="ld-td muted" :style="{ width: '150px' }">{{ row.sampledLabel }}</div>
            <div class="ld-td" :style="{ width: '80px' }">{{ row.messageCount == null ? '—' : row.messageCount }}</div>
            <div class="ld-td muted" :style="{ width: '90px' }">{{ row.avgResponseLabel }}</div>
            <!-- 已评行只读显示 qc（不可覆盖·后端 409 ALREADY_MARKED 拒二次保存也在此兜底不再露编辑控件） -->
            <template v-if="row.scored">
              <div class="ld-td" :style="{ width: '90px' }"><Badge :tone="row.score <= 3 ? 'red' : 'green'">{{ row.score }} 分</Badge></div>
              <div class="ld-td grow">{{ row.note || '—' }}</div>
              <div class="ld-td ops-cell" :style="{ width: '130px' }">
                <UiButton variant="ghost" size="sm" @click="viewQcSession(row)">
                  <Search :size="13" :stroke-width="1.8" /><span>查会话</span>
                </UiButton>
              </div>
            </template>
            <template v-else>
              <div class="ld-td" :style="{ width: '90px' }">
                <select v-model.number="row.draftScore" class="qc-score-sel">
                  <option :value="0">请选择</option>
                  <option v-for="n in [5, 4, 3, 2, 1]" :key="n" :value="n">{{ n }} 分</option>
                </select>
              </div>
              <div class="ld-td grow"><input v-model="row.draftNote" placeholder="质检备注（可留空）" maxlength="500" class="qc-note-in" /></div>
              <div class="ld-td ops-cell" :style="{ width: '130px' }">
                <UiButton size="sm" :disabled="row.busy" @click="saveQc(row)">{{ row.busy ? '保存中…' : '保存' }}</UiButton>
              </div>
            </template>
          </div>
        </div>
        <p v-for="row in qcRows.filter((r) => r.err)" :key="'err:' + row.sessionKey" class="ld-status qc-row-err">{{ row.tailId }}：{{ row.err }}</p>
        <div class="more-wrap">
          <UiButton v-if="qcHasMore" size="sm" variant="ghost" @click="moreQc">加载更多</UiButton>
          <p v-else-if="qcRows.length" class="end-mark">— 已到最早 —</p>
        </div>
      </div>
      <EmptyState v-else-if="!qcMsg" :icon="ClipboardCheck" text="点「随机抽取 10 条」从已结束会话里抽样质检" />
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

/* 质检抽检（批 B7）：表格辅助类（scoped 边界铁律·各页各自定义、不共享全局，同 Csat.vue 既有范式） */
.mono {
  font-family: var(--ld-font-mono);
  font-size: 12px;
  color: var(--ld-content-2);
}
.muted {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.ops-cell {
  justify-content: flex-end;
}
.qc-stat {
  margin-bottom: 6px;
}
.qc-score-sel {
  width: 100%;
  padding: 5px 6px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ld-content);
  background: var(--ld-bg);
}
.qc-note-in {
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ld-content);
  background: var(--ld-bg);
}
.qc-row-err {
  color: var(--ld-red);
  font-size: 11.5px;
}
</style>
