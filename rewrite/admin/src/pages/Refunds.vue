<script setup lang="ts">
// 售后退款（design/console.pen S10 视觉 + 退款决策抽屉·M3 UI 批4）：chip 计数走云端 refundCounts、
// grid 列表、右滑决策抽屉——把「退货权判据」摆到决策位（激活码/进课状态取 getRefundDetail 真判据·
// 根因#8 不伪造徽章）。同意由「人工验收」勾选闸放行，服务端 approveRefund 仍权威复核（进课即拒/降级）。
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, Search, X, CircleCheck, Ticket, GraduationCap, Check } from 'lucide-vue-next'
import { listRefunds, refundCounts, approveRefund, rejectRefund, getRefundDetail } from '../api/money'
import { mapRefundRows, refundVerdict, type RefundRowVM, type RefundVerdictVM } from '../lib/mapMoney'

const TABS = [
  { key: 'applied', label: '待审核' },
  { key: 'approved', label: '退款处理中' },
  { key: 'refunded', label: '已退款' },
  { key: 'rejected', label: '已拒绝' },
  { key: '', label: '全部' },
]

const tab = ref('applied')
const counts = ref<Record<string, number>>({})
const rows = ref<RefundRowVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const message = ref('')
const busy = ref(false)
const search = ref('') // 搜索框输入
const activeQ = ref('') // 已提交搜索词（空=按标签·跨全部状态服务端命中）

interface Verdict {
  loading: boolean
  activated: boolean
  entered: boolean
  code: string
  courseId: string
  lineRefundable: boolean // 本单此行真实可退性（P2·判据绑单·非课程级）
  refundableQty: number | null
  lineFound: boolean
}
const decideRow = ref<RefundRowVM | null>(null)
const verdict = ref<Verdict | null>(null)
const checkPkg = ref(false)
const checkCard = ref(false)
const rejecting = ref(false)
const rejectReason = ref('')
const actionMsg = ref('') // 审批结果（成功·持久·reload 不清·别一闪而过）
const decideErr = ref('') // 同意/拒绝失败原因（抽屉内红条·不被 reload 的"加载中"吞·P2·根因#14）

// 列表页脚分母＝当前标签计数（换皮恒用 counts.all·在「待审核」栏也显全量总数·误导）
const tabTotal = computed(() => counts.value[tab.value || 'all'])
const canApprove = computed(() => !!decideRow.value?.canDecide && checkPkg.value && checkCard.value && !busy.value)
// 判据文案绑本单订单行（P2·根因#8 不失真）：以 lineRefundable 为准，不被课程级激活误导
const verdictVM = computed<RefundVerdictVM | null>(() =>
  verdict.value && !verdict.value.loading
    ? refundVerdict({ lineRefundable: verdict.value.lineRefundable, entered: verdict.value.entered, refundableQty: verdict.value.refundableQty })
    : null
)

async function reload() {
  message.value = '加载中…'
  const [r, c] = await Promise.all([listRefunds(tab.value, undefined, 20, activeQ.value), refundCounts()])
  if ((r as any).error === 'SESSION_LOST') return
  rows.value = r.ok ? mapRefundRows((r as any).list) : []
  cursor.value = r.ok ? (r as any).nextCursor : null
  hasMore.value = !!(r.ok && (r as any).hasMore)
  if (c.ok && c.counts) counts.value = c.counts as Record<string, number>
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

// 加载更多（游标分页·根因#7·换皮丢了这个·退款首页 20 条封顶·第 21 单起翻不到）
async function more() {
  if (!hasMore.value || cursor.value == null) return
  const r = await listRefunds(tab.value, cursor.value, 20, activeQ.value)
  if (!r.ok) return
  const seen = new Set(rows.value.map((x) => x.id))
  rows.value = [...rows.value, ...mapRefundRows((r as any).list).filter((x) => !seen.has(x.id))]
  cursor.value = (r as any).nextCursor
  hasMore.value = !!(r as any).hasMore
}

function pickTab(k: string) {
  tab.value = k
  search.value = ''
  activeQ.value = '' // 切标签退出搜索
  void reload()
}
function doSearch() {
  const t = search.value.trim()
  if (t === activeQ.value) return
  activeQ.value = t
  void reload()
}
function clearSearch() {
  if (!activeQ.value && !search.value) return
  search.value = ''
  activeQ.value = ''
  void reload()
}

async function openDecide(row: RefundRowVM) {
  decideRow.value = row
  checkPkg.value = false
  checkCard.value = false
  rejecting.value = false
  rejectReason.value = ''
  decideErr.value = ''
  verdict.value = { loading: true, activated: false, entered: false, code: '', courseId: '', lineRefundable: true, refundableQty: null, lineFound: false }
  const r = await getRefundDetail(row.id)
  const a = (r as any)?.activation || {}
  verdict.value = {
    loading: false,
    activated: !!a.activated,
    entered: !!a.entered,
    code: String(a.code || ''),
    courseId: String(a.courseId || ''),
    lineRefundable: (r as any)?.lineRefundable !== false, // 缺字段/老后端默认可退（不误判会拦）
    refundableQty: (r as any)?.refundableQty ?? null,
    lineFound: !!(r as any)?.lineFound,
  }
}
function closeDecide() {
  decideRow.value = null
}

async function doApprove() {
  const row = decideRow.value
  if (!row || !canApprove.value) return
  busy.value = true
  decideErr.value = ''
  const r = await approveRefund(row.id)
  busy.value = false
  if (r.ok) {
    actionMsg.value = `✓ 已受理退款 ${row.orderId}，等微信回调确认到账`
    closeDecide()
    void reload()
  } else {
    // 失败：不关抽屉、不刷新——真实原因留在眼前（P2·根因#14 admin 侧·别被 reload 的"加载中…"盖掉）
    decideErr.value = `退款触发失败：${String(r.error || '未知错误')}`
  }
}

async function doReject() {
  const row = decideRow.value
  if (!row || busy.value) return
  if (!rejectReason.value.trim()) {
    decideErr.value = '拒绝必须写原因（会展示给买家）'
    return
  }
  busy.value = true
  decideErr.value = ''
  const r = await rejectRefund(row.id, rejectReason.value.trim())
  busy.value = false
  if (r.ok) {
    actionMsg.value = `已拒绝退款 ${row.orderId}`
    closeDecide()
    void reload()
  } else {
    // 失败：留抽屉 + 红条（同 doApprove·不被刷新吞）
    decideErr.value = '拒绝没成功：' + String(r.error || '')
  }
}

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>售后退款</h1>
        <p class="sub">先收到寄回包装并验收（激活卡未拆用）再同意 · 同意后原路退回微信支付</p>
      </div>
      <button class="btn-refresh" :disabled="message === '加载中…'" @click="reload">
        <RefreshCw :size="15" :stroke-width="1.8" /><span>刷新</span>
      </button>
    </header>

    <div class="toolbar">
      <div class="chips">
        <button v-for="t in TABS" :key="t.key" class="chip" :class="{ on: tab === t.key }" @click="pickTab(t.key)">
          {{ t.label }}<span v-if="counts[t.key || 'all'] != null" class="chip-n">{{ counts[t.key || 'all'] }}</span>
        </button>
      </div>
      <div class="searchbox">
        <Search :size="15" :stroke-width="1.8" class="search-ico" />
        <input v-model="search" placeholder="搜索订单号（精确·跨全部状态）" @keyup.enter="doSearch" />
        <button class="search-btn" @click="doSearch">搜索</button>
      </div>
    </div>
    <p class="note">状态计数为云端实时总数、切换状态走服务端筛选、搜索按订单号跨全部状态精确命中——都不受当前分页影响。</p>
    <div v-if="activeQ" class="searching">
      搜索订单号「<b>{{ activeQ }}</b>」的结果（跨全部状态）
      <button class="link" @click="clearSearch">清除搜索</button>
    </div>

    <p v-if="message" class="status">{{ message }}</p>
    <p v-if="actionMsg" class="action-msg">{{ actionMsg }}<button class="link" @click="actionMsg = ''">知道了</button></p>

    <div v-if="rows.length" class="table">
      <div class="thead">
        <span>订单号</span>
        <span>申请时间</span>
        <span>退款商品 / 原因</span>
        <span class="r">退款额</span>
        <span>状态</span>
        <span class="r">操作</span>
      </div>
      <div v-for="row in rows" :key="row.id" class="trow">
        <span class="oid">{{ row.orderId }}<small v-if="row.buyerName || row.buyerMasked" class="buyer">{{ row.buyerName }} {{ row.buyerMasked }}</small></span>
        <span class="time">{{ row.timeLabel }}</span>
        <div class="what">
          <div class="what-goods">{{ row.what }}</div>
          <div class="what-reason">原因：{{ row.reason || '—' }}</div>
        </div>
        <span class="amount r">退 {{ row.refundAmountLabel }}</span>
        <span class="c-state"><span class="state" :class="row.status">{{ row.statusLabel }}</span></span>
        <div class="c-ops r">
          <button v-if="row.canDecide" class="act approve" @click="openDecide(row)">
            <Check :size="14" :stroke-width="2" /><span>审核</span>
          </button>
          <button v-else class="act view" @click="openDecide(row)">查看</button>
        </div>
      </div>
      <div class="tfoot">
        <span>已加载 {{ rows.length }} 单{{ !activeQ && tabTotal != null ? ' / ' + tabTotal + ' 单（本栏）' : '' }}</span>
        <button v-if="hasMore" class="more" @click="more">加载更多</button>
      </div>
    </div>
    <p v-else-if="!message" class="status-soft">{{ activeQ ? '没有匹配该订单号的售后单' : '这一栏没有售后单' }}</p>

    <div v-if="decideRow" class="drawer-mask" @click.self="closeDecide">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">{{ decideRow.canDecide ? '退款审核' : '退款详情' }}</div>
            <div class="drawer-oid">订单 {{ decideRow.orderId }}</div>
          </div>
          <button class="drawer-close" @click="closeDecide"><X :size="16" :stroke-width="1.8" /></button>
        </div>

        <div class="summary">
          <div class="srow"><span>退款商品</span><strong>{{ decideRow.what }}</strong></div>
          <div class="srow"><span>退款金额</span><strong>{{ decideRow.refundAmountLabel }}</strong></div>
          <!-- 收货人（换皮丢·联系买家核对寄回/退货）：抽屉给全号 -->
          <div v-if="decideRow.buyerName || decideRow.buyerPhone" class="srow"><span>收货人</span><span class="sval">{{ decideRow.buyerName || '—' }} · {{ decideRow.buyerPhone || '（无电话）' }}</span></div>
          <div class="srow"><span>买家原因</span><span class="sval">{{ decideRow.reason || '—' }}</span></div>
        </div>

        <!-- 结果区（已退款/已拒绝单·换皮丢了这块）：到账时间 / 拒绝原因 -->
        <div v-if="decideRow.refundedAtLabel || decideRow.rejectReason" class="result" :class="decideRow.status">
          <template v-if="decideRow.refundedAtLabel">✓ 已原路退回微信 · 到账 {{ decideRow.refundedAtLabel }}</template>
          <template v-else>✕ 已拒绝 · 原因：{{ decideRow.rejectReason }}</template>
        </div>

        <div v-if="verdictVM" class="verdict" :class="verdictVM.tone">
          <CircleCheck :size="20" :stroke-width="1.8" />
          <div>
            <div class="verdict-t">{{ verdictVM.title }}</div>
            <div class="verdict-s">{{ verdictVM.sub }}</div>
          </div>
        </div>
        <p v-else-if="verdict" class="verdict-loading">判据加载中…</p>

        <div class="crit-label">退货权判据（云端真数据）</div>
        <div v-if="verdict && !verdict.loading" class="crits">
          <div class="crit">
            <div class="crit-l">
              <div class="crit-ib"><Ticket :size="15" :stroke-width="1.8" /></div>
              <div>
                <div class="crit-a">激活码</div>
                <div class="crit-b">{{ verdict.code || '未绑定' }}</div>
              </div>
            </div>
            <span class="crit-chip" :class="verdict.activated ? 'bad' : 'good'">{{ verdict.activated ? '已激活' : '未使用' }}</span>
          </div>
          <div class="crit">
            <div class="crit-l">
              <div class="crit-ib"><GraduationCap :size="15" :stroke-width="1.8" /></div>
              <div>
                <div class="crit-a">这门课进课（课程级）</div>
                <div class="crit-b">{{ verdict.courseId || '—' }} · 是否拦本单看上方判据</div>
              </div>
            </div>
            <span class="crit-chip" :class="verdict.entered ? 'note' : 'good'">{{ verdict.entered ? '已进课' : '未进课' }}</span>
          </div>
        </div>

        <!-- 同意/拒绝失败原因（P2·不被刷新的"加载中"吞·留在眼前直到重试或关抽屉） -->
        <p v-if="decideErr" class="decide-err">{{ decideErr }}</p>

        <template v-if="decideRow.canDecide && !rejecting">
          <div class="crit-label">人工验收（勾选后才可同意）</div>
          <label class="ck"><input v-model="checkPkg" type="checkbox" /><span>已收到买家寄回包装并验收</span></label>
          <label class="ck"><input v-model="checkCard" type="checkbox" /><span>激活卡未拆封 / 未使用</span></label>
          <div class="drawer-foot">
            <button class="approve-btn" :disabled="!canApprove" @click="doApprove">
              <CircleCheck :size="16" :stroke-width="1.8" /><span>{{ busy ? '受理中…' : '同意退款 · 原路退回 ' + decideRow.refundAmountLabel }}</span>
            </button>
            <button class="reject-btn" @click="rejecting = true">拒绝退款（需填原因）</button>
          </div>
        </template>

        <template v-else-if="decideRow.canDecide && rejecting">
          <div class="crit-label">拒绝原因（买家可见·必填）</div>
          <textarea v-model="rejectReason" maxlength="100" rows="3" placeholder="如：激活卡已拆用，不符合退货规则" />
          <div class="drawer-foot">
            <button class="reject-confirm" :disabled="busy" @click="doReject">确认拒绝</button>
            <button class="cancel" @click="rejecting = false">返回</button>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1200px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
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
.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content);
  font-size: 13px;
  cursor: pointer;
}
.btn-refresh:disabled {
  opacity: 0.6;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 6px;
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 13px;
  cursor: pointer;
}
.chip.on {
  background: var(--ld-purple-ink);
  border-color: var(--ld-purple-ink);
  color: #fff;
}
.chip-n {
  opacity: 0.7;
}
.searchbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 4px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  min-width: 280px;
}
.search-btn {
  flex: none;
  padding: 6px 14px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12.5px;
  cursor: pointer;
}
.searching {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ld-content);
}
.link {
  margin-left: 10px;
  border: none;
  background: none;
  color: var(--ld-brand);
  cursor: pointer;
  font-size: 12px;
}
.result {
  padding: 11px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 600;
}
.result.refunded {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.result.rejected {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.more {
  padding: 7px 18px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  cursor: pointer;
  font-size: 12.5px;
  color: var(--ld-content);
}
.search-ico {
  color: var(--ld-content-2);
  flex: none;
}
.searchbox input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  width: 100%;
  color: var(--ld-ink);
}
.note {
  margin: 0 0 14px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
}
.action-msg {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--ld-green);
  background: var(--ld-bg-green-soft);
  padding: 8px 14px;
  border-radius: 10px;
  margin: 0 0 6px;
}
.table {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 1.3fr 1fr 2.4fr 1fr 0.9fr 1fr;
  align-items: center;
  gap: 12px;
  padding: 13px 20px;
}
.thead {
  background: var(--ld-bg-lilac);
  font-size: 12px;
  color: var(--ld-content-2);
}
.trow {
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
}
.r {
  text-align: right;
  justify-self: end;
}
.oid {
  font-family: var(--ld-font-mono);
  font-size: 12.5px;
  color: var(--ld-ink);
}
.buyer {
  display: block;
  margin-top: 3px;
  font-family: var(--ld-font);
  font-size: 11px;
  color: var(--ld-content-2);
}
.time {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.what-goods {
  color: var(--ld-content);
}
.what-reason {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.amount {
  font-weight: 700;
  color: var(--ld-ink);
}
.state {
  padding: 3px 11px;
  border-radius: 999px;
  font-size: 11.5px;
  white-space: nowrap;
  background: var(--ld-bg-faint);
  color: var(--ld-content-2);
}
.state.applied {
  background: var(--ld-bg-lilac);
  color: var(--ld-amber);
}
.state.approved {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.state.refunded {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.state.rejected {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.c-ops {
  display: flex;
  gap: 6px;
}
.act {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 13px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.act.approve {
  background: var(--ld-purple-ink);
  color: #fff;
}
.act.view {
  background: transparent;
  color: var(--ld-brand-active);
  border: 1px solid var(--ld-line);
}
.tfoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--ld-line);
  font-size: 12px;
  color: var(--ld-content-2);
}
/* 决策抽屉 */
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 15, 30, 0.28);
  display: flex;
  justify-content: flex-end;
  z-index: 40;
}
.drawer {
  width: 420px;
  max-width: 94vw;
  height: 100%;
  background: var(--ld-bg);
  border-left: 1px solid var(--ld-line);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  animation: slidein 0.18s ease;
}
@keyframes slidein {
  from {
    transform: translateX(24px);
    opacity: 0.6;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.drawer-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--ld-ink);
}
.drawer-oid {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.drawer-close {
  display: flex;
  padding: 6px;
  border: none;
  border-radius: 8px;
  background: var(--ld-bg-grey);
  color: var(--ld-content-2);
  cursor: pointer;
}
.summary {
  padding: 14px;
  background: var(--ld-bg-lilac);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.srow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
}
.srow > span:first-child {
  color: var(--ld-content-2);
  flex: none;
}
.srow strong {
  color: var(--ld-ink);
}
.sval {
  color: var(--ld-content);
  text-align: right;
}
.verdict {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid transparent;
}
.verdict.ok {
  background: var(--ld-bg-green-soft);
  border-color: var(--ld-green);
  color: var(--ld-green);
}
.verdict.lost {
  background: var(--ld-bg-red-soft);
  border-color: var(--ld-red-line);
  color: var(--ld-red);
}
.verdict-t {
  font-size: 13.5px;
  font-weight: 700;
}
.verdict-s {
  margin-top: 2px;
  font-size: 11.5px;
  opacity: 0.85;
}
.verdict-loading {
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.crit-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--ld-purple-meta);
  margin-top: 2px;
}
.crits {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.crit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 10px;
}
.crit-l {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.crit-ib {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 8px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand);
}
.crit-a {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-ink);
}
.crit-b {
  font-size: 10.5px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.crit-chip {
  flex: none;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.crit-chip.good {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.crit-chip.bad {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.crit-chip.note {
  background: var(--ld-bg-lilac);
  color: var(--ld-amber);
}
.decide-err {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
  font-size: 12.5px;
  font-weight: 600;
  border: 1px solid var(--ld-red-line);
}
.ck {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12.5px;
  color: var(--ld-content);
  cursor: pointer;
}
.ck input {
  width: 16px;
  height: 16px;
  accent-color: var(--ld-purple-ink);
}
.drawer-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
}
.approve-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 13px 0;
  border: none;
  border-radius: 11px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}
.approve-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.reject-btn {
  padding: 11px 0;
  border: 1px solid var(--ld-line-strong);
  border-radius: 11px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 10px;
  font-size: 13px;
  font-family: var(--ld-font);
  resize: vertical;
  color: var(--ld-ink);
}
.reject-confirm {
  padding: 12px 0;
  border: none;
  border-radius: 11px;
  background: var(--ld-red);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}
.reject-confirm:disabled {
  opacity: 0.6;
}
.cancel {
  padding: 10px 0;
  border: none;
  background: transparent;
  color: var(--ld-content-2);
  font-size: 13px;
  cursor: pointer;
}
</style>
