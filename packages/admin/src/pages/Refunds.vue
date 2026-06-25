<script setup>
/**
 * 售后退款（S10 重设计·密集表格 + 决策抽屉）。买家申请退款后在这里审核。
 *
 * 重设计要点（与订单同治·根因#7 计数/筛选/搜索失真）：
 * - 标签计数走服务端 refundCounts（.count() 精确·不受分页影响），不再数「已加载页」。
 * - 切状态走服务端筛选（listRefunds status）；搜索按订单号服务端精确命中（q）。
 * - 卡片流改密集表格；同意/拒绝funnel进右侧「决策抽屉」。
 * - 决策抽屉＝**自动判据 + 人工验收闸**：① 自动判据（getRefundDetail·激活码状态数据链）显买家是否
 *   已激活/已进课该课程 + 退货权判语（未激活未进课=未失·可退；已激活=已失·谨慎）；② 人工验收闸——
 *   同意前仍须勾「已收寄回包装并验收」+「激活卡未拆封/未用」（寄回物流无数据·靠人）。
 *   不伪造：激活/进课来自真数据（activations），寄回签收暂无数据故留人工（根因#8）。
 *
 * 同意 = approveRefund 触发退款工作流（金额申请时已云端分摊算定，原路退回）→ refundCallback 翻
 * 「已退款」；拒绝必须填原因（买家小程序可见）。
 */
import { ref, computed } from 'vue'
import { cloudMode, listRefunds, refundCounts, getRefundDetail, approveRefund, rejectRefund } from '@/api/cloud.js'
import { RefreshCw } from 'lucide-vue-next'

const STATUS = {
  applied: { label: '待审核', chip: 'warn' },
  approved: { label: '退款处理中', chip: '' },
  refunded: { label: '已退款', chip: 'green' },
  rejected: { label: '已拒绝', chip: 'grey' },
}
const TABS = [
  { key: 'applied', label: '待审核', status: 'applied' },
  { key: 'approved', label: '退款处理中', status: 'approved' },
  { key: 'refunded', label: '已退款', status: 'refunded' },
  { key: 'rejected', label: '已拒绝', status: 'rejected' },
  { key: 'all', label: '全部', status: 'all' },
]

const counts = ref({}) // 服务端精确计数 { all, applied, approved, refunded, rejected }
const list = ref([])
const loading = ref(true)
const loadErr = ref('')
const tab = ref('applied')
const q = ref('')
const activeQ = ref('')
const nextCursor = ref(null)
const hasMore = ref(false)
const loadingMore = ref(false)
// 决策抽屉：{ record, mode:'review'|'view', received, cardUnused, rejecting, reason, saving, error }
const drawer = ref(null)

const activeStatus = computed(() => TABS.find((t) => t.key === tab.value)?.status || 'all')
const tabCount = (t) => (t.status === 'all' ? (counts.value.all ?? 0) : (counts.value[t.status] ?? 0))

async function loadCounts() {
  if (!cloudMode) return
  try {
    counts.value = await refundCounts()
  } catch {
    /* 计数失败不阻断列表 */
  }
}

async function loadList() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const paged = await listRefunds({ status: activeStatus.value, q: activeQ.value })
    list.value = paged.list
    nextCursor.value = paged.nextCursor
    hasMore.value = paged.hasMore
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}

async function init() {
  await Promise.all([loadCounts(), loadList()])
}
init()

async function loadMore() {
  if (loadingMore.value || !hasMore.value || nextCursor.value == null) return
  loadingMore.value = true
  try {
    const paged = await listRefunds({ status: activeStatus.value, q: activeQ.value, cursor: nextCursor.value })
    const ids = new Set(list.value.map((a) => a._id))
    list.value = [...list.value, ...paged.list.filter((a) => !ids.has(a._id))]
    nextCursor.value = paged.nextCursor
    hasMore.value = paged.hasMore
  } catch (e) {
    loadErr.value = '加载更多失败：' + e.message
  } finally {
    loadingMore.value = false
  }
}

function switchTab(key) {
  if (tab.value === key && !activeQ.value) return
  tab.value = key
  q.value = ''
  activeQ.value = ''
  loadList()
}
function doSearch() {
  const t = q.value.trim()
  if (t === activeQ.value) return
  activeQ.value = t
  loadList()
}
function clearSearch() {
  if (!activeQ.value && !q.value) return
  q.value = ''
  activeQ.value = ''
  loadList()
}

const fmtTime = (ms) => {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const maskPhone = (p) => (p && p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(-4) : p || '')
const goodsLine = (a) => `${a.name}${a.spec ? `（${a.spec}）` : ''} ×${a.qty}`

function matchesFilter(a) {
  if (activeQ.value) return true
  if (activeStatus.value === 'all') return true
  return a.status === activeStatus.value
}

function openDrawer(a, mode) {
  drawer.value = {
    record: a,
    mode,
    received: false,
    cardUnused: false,
    rejecting: false,
    reason: '',
    saving: false,
    error: '',
    activation: null, // 激活判据（getRefundDetail 异步取）
    actLoading: cloudMode,
  }
  // 激活码状态数据链：买家激活/进课该课程没？给审核员真判据（异步·失败不阻断审核）
  if (cloudMode) {
    getRefundDetail(a._id)
      .then((act) => {
        if (drawer.value && drawer.value.record._id === a._id) drawer.value.activation = act
      })
      .catch(() => {})
      .finally(() => {
        if (drawer.value && drawer.value.record._id === a._id) drawer.value.actLoading = false
      })
  }
}
function closeDrawer() {
  if (drawer.value?.saving) return
  drawer.value = null
}

const canApprove = computed(() => !!drawer.value && drawer.value.received && drawer.value.cardUnused)
// 退货权判语（来自激活码状态数据链）：未激活未进课=退货权未失·可放心退；否则已失·谨慎
const verdict = computed(() => {
  const act = drawer.value?.activation
  if (!act) return null
  if (!act.activated && !act.entered) return { ok: true, label: '退货权未失', detail: '买家未激活该课程，可放心退' }
  return {
    ok: false,
    label: '退货权已失 · 谨慎',
    detail: '买家已激活' + (act.entered ? '并已进课' : '') + '该课程——商品价值已交付，原则上不退',
  }
})

async function doApprove() {
  const d = drawer.value
  if (!d || d.saving || !canApprove.value) return
  d.saving = true
  d.error = ''
  try {
    await approveRefund(d.record._id)
    d.record.status = 'approved'
    d.record.approvedAt = Date.now()
    drawer.value = null
    if (!matchesFilter(d.record)) list.value = list.value.filter((x) => x._id !== d.record._id)
    loadCounts()
  } catch (e) {
    d.error = '退款触发失败：' + e.message
    d.saving = false
  }
}

async function doReject() {
  const d = drawer.value
  if (!d || d.saving) return
  if (!d.reason.trim()) {
    d.error = '拒绝必须填写原因（买家会看到）'
    return
  }
  d.saving = true
  d.error = ''
  try {
    await rejectRefund(d.record._id, d.reason.trim())
    d.record.status = 'rejected'
    d.record.rejectReason = d.reason.trim()
    drawer.value = null
    if (!matchesFilter(d.record)) list.value = list.value.filter((x) => x._id !== d.record._id)
    loadCounts()
  } catch (e) {
    d.error = '操作失败：' + e.message
    d.saving = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>售后退款</h1>
        <p class="sub">先收到寄回包装并验收（激活卡未拆用）再同意 · 同意后原路退回微信支付</p>
      </div>
      <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">售后审核需云端模式（配置 VITE_ADMIN_API）。</p>

    <template v-else>
      <div class="bar">
        <div class="tabs">
          <button
            v-for="t in TABS"
            :key="t.key"
            class="tab"
            :class="{ on: tab === t.key && !activeQ }"
            @click="switchTab(t.key)"
          >
            {{ t.label }}<span class="tab-n">{{ tabCount(t) }}</span>
          </button>
        </div>
        <div class="search">
          <input v-model="q" class="input" placeholder="搜索订单号（精确）" @keyup.enter="doSearch" />
          <button class="btn ghost mini" @click="doSearch">搜索</button>
        </div>
      </div>

      <p class="cloud-note">状态计数与筛选均来自云端实时统计，不受当前页加载量影响（修原「计数失真」问题）。</p>

      <div v-if="activeQ" class="searching">
        搜索订单号「<b>{{ activeQ }}</b>」的结果（跨全部状态）
        <button class="link" @click="clearSearch">清除搜索</button>
      </div>

      <p v-if="loadErr" class="hint warn">{{ loadErr }}</p>
      <p v-else-if="loading" class="hint">加载中…</p>

      <template v-else>
        <p v-if="!list.length" class="hint">
          {{ activeQ ? '没有匹配该订单号的售后单' : tab === 'applied' ? '没有待审核的售后申请' : '这个状态下还没有售后单' }}
        </p>

        <div v-else class="card table">
          <div class="row hrow">
            <span>订单号</span><span>申请时间</span><span>买家</span><span>退款商品 / 原因</span>
            <span class="r">退款额</span><span>状态</span><span class="r">操作</span>
          </div>
          <div v-for="a in list" :key="a._id" class="row">
            <span class="oid">{{ a.orderId }}</span>
            <span class="muted">{{ fmtTime(a.appliedAt) }}</span>
            <span class="buyer"><b>{{ a.addressName || '—' }}</b><em>{{ maskPhone(a.phone) }}</em></span>
            <span class="goods" :title="goodsLine(a) + (a.reason ? ' · ' + a.reason : '')">
              {{ goodsLine(a) }}<small v-if="a.reason">原因：{{ a.reason }}</small>
            </span>
            <span class="r amount">退 ￥{{ Number(a.refundAmount).toFixed(2) }}</span>
            <span><span class="chip" :class="STATUS[a.status]?.chip">{{ STATUS[a.status]?.label || a.status }}</span></span>
            <span class="r ops">
              <button v-if="a.status === 'applied'" class="btn primary mini" @click="openDrawer(a, 'review')">审核</button>
              <button v-else class="btn ghost mini" @click="openDrawer(a, 'view')">查看</button>
            </span>
          </div>
        </div>

        <div v-if="list.length" class="foot">
          <span class="muted">已加载 {{ list.length }}{{ activeQ ? '' : ` / ${tabCount(TABS.find((t) => t.key === tab))} 单` }}</span>
          <button v-if="hasMore" class="btn ghost mini" :disabled="loadingMore" @click="loadMore">
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>
        </div>
      </template>
    </template>

    <!-- 决策抽屉 -->
    <div v-if="drawer" class="drawer-mask" @click="closeDrawer">
      <aside class="drawer" @click.stop>
        <div class="d-head">
          <div>
            <span class="d-title">{{ drawer.mode === 'review' ? '退款审核' : '售后详情' }}</span>
            <span class="chip" :class="STATUS[drawer.record.status]?.chip">{{
              STATUS[drawer.record.status]?.label || drawer.record.status
            }}</span>
          </div>
          <button class="x" :disabled="drawer.saving" @click="closeDrawer">×</button>
        </div>

        <div class="d-body">
          <p class="d-order">订单 {{ drawer.record.orderId }}</p>
          <div class="d-summary">
            <div class="d-row"><span class="d-k">退款商品</span><span>{{ goodsLine(drawer.record) }}</span></div>
            <div class="d-row"><span class="d-k">退款金额</span><b class="amount">￥{{ Number(drawer.record.refundAmount).toFixed(2) }}</b></div>
            <div class="d-row"><span class="d-k">买家原因</span><span>{{ drawer.record.reason || '—' }}</span></div>
            <div class="d-row"><span class="d-k">收货人</span><span>{{ drawer.record.addressName }} · {{ drawer.record.phone }}</span></div>
          </div>

          <!-- 退货权判据（激活码状态数据链·给审核员真判断·非人工猜） -->
          <div class="d-act">
            <p class="d-section">退货权判据</p>
            <p v-if="drawer.actLoading" class="mini-l">查激活状态…</p>
            <template v-else-if="drawer.activation">
              <div v-if="verdict" class="verdict" :class="verdict.ok ? 'good' : 'bad'">
                <b>{{ verdict.ok ? '✓ ' : '⚠ ' }}{{ verdict.label }}</b>
                <span>{{ verdict.detail }}</span>
              </div>
              <div class="act-rows">
                <div class="act-row"><span class="d-k">激活课程</span><span :class="drawer.activation.activated ? 'bad-t' : 'good-t'">{{ drawer.activation.activated ? '已激活' : '未激活' }}</span></div>
                <div class="act-row"><span class="d-k">进入学习</span><span :class="drawer.activation.entered ? 'bad-t' : 'good-t'">{{ drawer.activation.entered ? '已进课' : '未进课' }}</span></div>
                <div v-if="drawer.activation.code" class="act-row"><span class="d-k">激活码</span><code>{{ drawer.activation.code }}</code></div>
              </div>
            </template>
            <p v-else class="mini-l">激活状态取不到（不影响人工判断）</p>
          </div>

          <!-- 审核模式：人工验收闸 -->
          <template v-if="drawer.mode === 'review'">
            <p class="d-section">人工验收（勾选后才可同意）</p>
            <label class="check"><input v-model="drawer.received" type="checkbox" />已收到买家寄回包装并验收</label>
            <label class="check"><input v-model="drawer.cardUnused" type="checkbox" />激活卡未拆封 / 未使用</label>
            <p class="d-tip">
              说明：寄回签收、激活码使用状态暂无法自动核验（需数据补链），先靠人工勾选把关；勾全才放行同意。
            </p>

            <div v-if="drawer.rejecting" class="reject-box">
              <label class="field-label">拒绝原因（买家会看到）</label>
              <input v-model="drawer.reason" class="input" placeholder="如：激活码已使用 / 未收到寄回" @keyup.enter="doReject" />
            </div>
            <p v-if="drawer.error" class="err">{{ drawer.error }}</p>
          </template>

          <!-- 查看模式：结果信息 -->
          <template v-else>
            <div class="d-result">
              <template v-if="drawer.record.status === 'refunded'">
                ✅ 退款完成 {{ fmtTime(drawer.record.refundedAt) }}
                <small v-if="drawer.record.refundTransactionId">退款单 …{{ drawer.record.refundTransactionId.slice(-8) }}</small>
              </template>
              <template v-else-if="drawer.record.status === 'rejected'">⛔ 已拒绝 · 原因：{{ drawer.record.rejectReason }}</template>
              <template v-else>⏳ 已触发退款，等待微信回调确认</template>
            </div>
          </template>
        </div>

        <div v-if="drawer.mode === 'review'" class="d-foot">
          <template v-if="!drawer.rejecting">
            <button class="btn ghost" :disabled="drawer.saving" @click="drawer.rejecting = true">拒绝退款</button>
            <button class="btn primary" :disabled="!canApprove || drawer.saving" @click="doApprove">
              {{ drawer.saving ? '退款中…' : `同意 · 原路退回 ￥${Number(drawer.record.refundAmount).toFixed(2)}` }}
            </button>
          </template>
          <template v-else>
            <button class="btn ghost" :disabled="drawer.saving" @click="drawer.rejecting = false">返回</button>
            <button class="btn primary" :disabled="drawer.saving" @click="doReject">
              {{ drawer.saving ? '提交中…' : '确认拒绝' }}
            </button>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.tabs {
  display: flex;
  gap: 8px;
}
.tab {
  border: 1px solid var(--line-strong);
  background: var(--white);
  border-radius: var(--r-pill);
  padding: 7px 14px;
  font-size: 12.5px;
  color: var(--content-2);
  cursor: pointer;
}
.tab.on {
  background: var(--purple-ink);
  border-color: var(--purple-ink);
  color: var(--white);
  font-weight: 600;
}
.tab-n {
  margin-left: 5px;
  font-size: 11px;
  opacity: 0.75;
}
.search {
  display: flex;
  gap: 8px;
  align-items: center;
}
.search .input {
  width: 220px;
}
.cloud-note {
  margin: 12px 0 6px;
  font-size: 11.5px;
  color: var(--purple-meta);
}
.searching {
  margin: 4px 0 12px;
  font-size: 12.5px;
  color: var(--content);
}
.link {
  margin-left: 10px;
  border: none;
  background: none;
  color: var(--brand);
  cursor: pointer;
  font-size: 12px;
}

.table {
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 104px 84px 1fr 1.5fr 96px 84px 88px;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  font-size: 12.5px;
}
.row + .row {
  border-top: 1px solid var(--line);
}
.hrow {
  background: var(--bg-lilac);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--content-2);
}
.r {
  text-align: right;
  justify-self: end;
}
.oid {
  font-family: ui-monospace, Menlo, monospace;
  font-weight: 600;
  font-size: 12px;
  color: var(--ink);
}
.muted {
  color: var(--content-2);
  font-size: 11.5px;
}
.buyer {
  min-width: 0;
}
.buyer b {
  color: var(--ink);
}
.buyer em {
  font-style: normal;
  color: var(--content-2);
  margin-left: 6px;
  font-size: 11.5px;
}
.goods {
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--content);
  line-height: 1.45;
}
.goods small {
  color: var(--content-2);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.amount {
  font-weight: 600;
  color: var(--ink);
  font-size: 13px;
}
.ops {
  display: flex;
  justify-content: flex-end;
}
.btn.mini {
  padding: 6px 12px;
  font-size: 12px;
}
.chip.warn {
  background: #fdf6ec;
  border-color: #f0ddc0;
  color: #8a6420;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}

/* 抽屉 */
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(36, 23, 51, 0.32);
  display: flex;
  justify-content: flex-end;
  z-index: 50;
}
.drawer {
  width: 420px;
  max-width: 92vw;
  height: 100%;
  background: var(--white);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 30px rgba(36, 23, 51, 0.18);
}
.d-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid var(--line);
}
.d-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--ink);
  margin-right: 10px;
}
.x {
  border: none;
  background: none;
  font-size: 22px;
  line-height: 1;
  color: var(--content-2);
  cursor: pointer;
}
.d-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
}
.d-order {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12.5px;
  color: var(--content-2);
  margin: 0 0 12px;
}
.d-summary {
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  border-radius: 10px;
  padding: 10px 14px;
}
.d-row {
  display: flex;
  gap: 12px;
  padding: 5px 0;
  font-size: 13px;
  color: var(--content);
}
.d-k {
  flex: 0 0 64px;
  color: var(--content-2);
  font-size: 12px;
}
.d-section {
  margin: 18px 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--purple-meta);
}
.mini-l {
  font-size: 12px;
  color: var(--content-2);
  margin: 0;
}
.verdict {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 13px;
  border-radius: 10px;
  font-size: 12.5px;
  margin-bottom: 10px;
}
.verdict b {
  font-size: 13px;
}
.verdict.good {
  background: var(--green-bg);
  border: 1px solid var(--green-line);
  color: var(--green);
}
.verdict.bad {
  background: #fdf6ec;
  border: 1px solid #f0ddc0;
  color: #8a6420;
}
.verdict span {
  color: var(--content);
}
.act-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.act-row {
  display: flex;
  gap: 12px;
  font-size: 12.5px;
  padding: 3px 0;
}
.act-row code {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  color: var(--content);
}
.good-t {
  color: var(--green);
  font-weight: 600;
}
.bad-t {
  color: #8a6420;
  font-weight: 600;
}
.check {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--content);
  cursor: pointer;
}
.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--purple-ink);
}
.d-tip {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--content-2);
  line-height: 1.5;
}
.reject-box {
  margin-top: 16px;
}
.d-result {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--content);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.d-result small {
  color: var(--content-2);
  font-size: 11.5px;
}
.err {
  color: var(--red);
  font-size: 12px;
  margin: 10px 0 0;
}
.d-foot {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 16px 22px;
  border-top: 1px solid var(--line);
}
</style>
