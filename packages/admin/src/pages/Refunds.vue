<script setup>
/**
 * 售后退款（P4 Batch 2，链10）：买家申请退款后在这里审核。
 * 列表来自云端 afterSales（adminApi listRefunds，倒序）；
 * 同意 = approveRefund 触发退款工作流（金额申请时已云端分摊算定，原路退回微信支付）→
 * 微信退款回调（refundCallback）把状态翻「已退款」；拒绝必须填原因（买家小程序可见）。
 * 流程提醒：先线下收到寄回包装并验收扫码（激活码未用）再点同意。
 */
import { ref, computed } from 'vue'
import { cloudMode, listRefunds, approveRefund, rejectRefund } from '@/api/cloud.js'

const STATUS = {
  applied: { label: '待审核', chip: 'warn' },
  approved: { label: '退款处理中', chip: '' },
  refunded: { label: '已退款', chip: 'green' },
  rejected: { label: '已拒绝', chip: 'grey' },
}
const TABS = [
  { key: 'applied', label: '待审核' },
  { key: 'approved', label: '退款处理中' },
  { key: 'refunded', label: '已退款' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'all', label: '全部' },
]

const list = ref([])
const loading = ref(true)
const loadErr = ref('')
const tab = ref('applied')
const nextCursor = ref(null)
const hasMore = ref(false)
const loadingMore = ref(false)
// 行内表单（同时只开一单）：{ id, mode: 'approve'|'reject', reason, saving, error }
const form = ref(null)

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const paged = await listRefunds()
    list.value = paged.list
    nextCursor.value = paged.nextCursor
    hasMore.value = paged.hasMore
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

// 加载更多（游标分页，根因#7）：追加下一页、按 _id 去重防重入
async function loadMore() {
  if (loadingMore.value || !hasMore.value || nextCursor.value == null) return
  loadingMore.value = true
  try {
    const paged = await listRefunds(nextCursor.value)
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

const shown = computed(() =>
  tab.value === 'all' ? list.value : list.value.filter((a) => a.status === tab.value),
)
const countOf = (k) => (k === 'all' ? list.value.length : list.value.filter((a) => a.status === k).length)

const fmtTime = (ms) => {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function openForm(a, mode) {
  form.value = { id: a._id, mode, reason: '', saving: false, error: '' }
}

async function doApprove(a) {
  const f = form.value
  if (!f || f.saving) return
  f.saving = true
  f.error = ''
  try {
    await approveRefund(a._id)
    a.status = 'approved'
    a.approvedAt = Date.now()
    form.value = null
  } catch (e) {
    f.error = '退款触发失败：' + e.message
    f.saving = false
  }
}

async function doReject(a) {
  const f = form.value
  if (!f || f.saving) return
  if (!f.reason.trim()) {
    f.error = '拒绝必须填写原因（买家会看到）'
    return
  }
  f.saving = true
  f.error = ''
  try {
    await rejectRefund(a._id, f.reason.trim())
    a.status = 'rejected'
    a.rejectReason = f.reason.trim()
    form.value = null
  } catch (e) {
    f.error = '操作失败：' + e.message
    f.saving = false
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
      <button class="btn ghost" @click="init">↻ 刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">售后审核需云端模式（配置 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <template v-else>
      <div class="tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="tab"
          :class="{ on: tab === t.key }"
          @click="tab = t.key"
        >
          {{ t.label }}<span class="tab-n">{{ countOf(t.key) }}</span>
        </button>
      </div>

      <p v-if="!shown.length" class="hint">
        {{ tab === 'applied' ? '没有待审核的售后申请' : '这个状态下还没有售后单' }}
      </p>

      <div v-for="a in shown" :key="a._id" class="card refund">
        <div class="row head-row">
          <span class="oid">订单 {{ a.orderId }}</span>
          <span class="time">申请 {{ fmtTime(a.appliedAt) }}</span>
          <span class="chip" :class="STATUS[a.status]?.chip">{{ STATUS[a.status]?.label || a.status }}</span>
        </div>

        <div class="row">
          <div class="goods">
            <div class="goods-line">{{ a.name }}{{ a.spec ? `（${a.spec}）` : '' }} ×{{ a.qty }}</div>
            <div v-if="a.reason" class="reason">买家原因：{{ a.reason }}</div>
          </div>
          <b class="amount">退 ￥{{ Number(a.refundAmount).toFixed(2) }}</b>
        </div>

        <div class="row addr">
          <span>👤 {{ a.addressName }} {{ a.phone }}</span>
          <span v-if="a.status === 'refunded'" class="time"
            >退款完成 {{ fmtTime(a.refundedAt) }}{{ a.refundTransactionId ? ' · 退款单 ' + a.refundTransactionId.slice(-8) : '' }}</span
          >
          <span v-else-if="a.status === 'rejected'" class="time">拒绝原因：{{ a.rejectReason }}</span>
          <span v-else-if="a.status === 'approved'" class="time">已触发退款，等微信回调确认</span>
        </div>

        <!-- 待审核：同意 / 拒绝 -->
        <div v-if="a.status === 'applied' && form?.id !== a._id" class="row">
          <button class="btn brand" @click="openForm(a, 'approve')">✅ 同意退款</button>
          <button class="btn ghost" @click="openForm(a, 'reject')">拒绝</button>
        </div>
        <div v-if="form?.id === a._id && form.mode === 'approve'" class="row act-form">
          <span class="confirm-text">确认原路退回 <b>￥{{ Number(a.refundAmount).toFixed(2) }}</b>？（请先确认已收到寄回包装）</span>
          <button class="btn brand" :disabled="form.saving" @click="doApprove(a)">
            {{ form.saving ? '退款中…' : '确认退款' }}
          </button>
          <button class="btn ghost" :disabled="form.saving" @click="form = null">取消</button>
          <span v-if="form.error" class="err">{{ form.error }}</span>
        </div>
        <div v-if="form?.id === a._id && form.mode === 'reject'" class="row act-form">
          <input
            v-model="form.reason"
            class="input reject-reason"
            placeholder="拒绝原因（买家会看到）"
            @keyup.enter="doReject(a)"
          />
          <button class="btn brand" :disabled="form.saving" @click="doReject(a)">
            {{ form.saving ? '提交中…' : '确认拒绝' }}
          </button>
          <button class="btn ghost" :disabled="form.saving" @click="form = null">取消</button>
          <span v-if="form.error" class="err">{{ form.error }}</span>
        </div>
      </div>
      <button v-if="hasMore" class="btn ghost more" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '加载中…' : '加载更多' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
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
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
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
.refund {
  padding: 14px 20px;
  margin-bottom: 14px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
}
.row + .row {
  border-top: 1px solid var(--line);
}
.head-row {
  padding-top: 0;
}
.oid {
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
}
.time {
  flex: 1;
  font-size: 11.5px;
  color: var(--content-2);
}
.chip.warn {
  background: #fdf6ec;
  border-color: #f0ddc0;
  color: #8a6420;
}
.chip.grey {
  background: var(--bg-grey, #f3f3f3);
  color: var(--content-2);
}
.goods {
  flex: 1;
  min-width: 0;
}
.goods-line {
  font-size: 12.5px;
  color: var(--content);
  padding: 1px 0;
}
.reason {
  font-size: 12px;
  color: var(--content-2);
  padding: 2px 0;
}
.amount {
  font-size: 14px;
  color: var(--ink);
}
.addr {
  font-size: 12px;
  color: var(--content-2);
}
.act-form .confirm-text {
  font-size: 12.5px;
  color: var(--content);
}
.reject-reason {
  width: 280px;
  flex: 0 0 auto;
}
.err {
  font-size: 12px;
  color: var(--red);
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
</style>
