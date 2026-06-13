<script setup>
/**
 * 订单发货（P5 后台完善第一块）：买家付款后在这里发货。
 * 列表来自云端 orders（adminApi listOrders，倒序）；发货 = 填物流公司 + 运单号 →
 * shipOrder 流转 paid → shipped，小程序订单页即刻显示物流卡（运单号可复制）；
 * 买家「确认收货」（confirmReceive 云函数）后状态翻已完成。已发货可改单号（错填补救）。
 */
import { ref, computed } from 'vue'
import { cloudMode, listOrders, shipOrder, clearFeeMismatch } from '@/api/cloud.js'

const STATUS = {
  pending: { label: '待支付', chip: 'grey' },
  paid: { label: '待发货', chip: 'warn' },
  shipped: { label: '已发货', chip: '' },
  done: { label: '已完成', chip: 'green' },
}
const TABS = [
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '已发货' },
  { key: 'done', label: '已完成' },
  { key: 'all', label: '全部' },
]
const COMPANIES = ['顺丰速运', '中通快递', '圆通速递', '韵达快递', '申通快递', '邮政 EMS', '京东物流']

const list = ref([])
const loading = ref(true)
const loadErr = ref('')
const tab = ref('paid')
const nextCursor = ref(null)
const hasMore = ref(false)
const loadingMore = ref(false)
// 行内发货表单（同时只开一单）：{ id, company, trackingNo, saving, error }
const form = ref(null)

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const paged = await listOrders()
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

// 加载更多（游标分页，根因#7）：追加下一页、按 id 去重防重入
async function loadMore() {
  if (loadingMore.value || !hasMore.value || nextCursor.value == null) return
  loadingMore.value = true
  try {
    const paged = await listOrders(nextCursor.value)
    const ids = new Set(list.value.map((o) => o.id))
    list.value = [...list.value, ...paged.list.filter((o) => !ids.has(o.id))]
    nextCursor.value = paged.nextCursor
    hasMore.value = paged.hasMore
  } catch (e) {
    loadErr.value = '加载更多失败：' + e.message
  } finally {
    loadingMore.value = false
  }
}

const shown = computed(() =>
  tab.value === 'all' ? list.value : list.value.filter((o) => o.status === tab.value),
)
const countOf = (k) => (k === 'all' ? list.value.length : list.value.filter((o) => o.status === k).length)

const fmtTime = (ms) => {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const summary = (o) => (o.items || []).map((it) => `${it.name}${it.spec ? `（${it.spec}）` : ''} ×${it.qty}`)

function openForm(o) {
  form.value = {
    id: o.id,
    company: o.shipping?.company || COMPANIES[0],
    trackingNo: o.shipping?.trackingNo || '',
    saving: false,
    error: '',
  }
}

// 金额异常单复核解除：先去商户平台核对该单流水，确认无误再点（解除后才能发货）
async function doClearMismatch(o) {
  if (!window.confirm(`确认已在商户平台核对订单 ${o.id} 的支付流水无误？解除后该单可正常发货。`)) return
  try {
    await clearFeeMismatch(o.id)
    o.feeMismatch = false
  } catch (e) {
    window.alert('解除失败：' + e.message)
  }
}

async function doShip(o) {
  const f = form.value
  if (!f || f.saving) return
  if (!f.company.trim() || !f.trackingNo.trim()) {
    f.error = '物流公司和运单号都要填'
    return
  }
  f.saving = true
  f.error = ''
  try {
    await shipOrder(o.id, f.company.trim(), f.trackingNo.trim())
    o.status = 'shipped'
    o.shipping = { company: f.company.trim(), trackingNo: f.trackingNo.trim() }
    if (!o.shippedAt) o.shippedAt = Date.now()
    form.value = null
  } catch (e) {
    f.error = '发货失败：' + e.message
    f.saving = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>订单发货</h1>
        <p class="sub">买家付款后在这里发货 · 填好运单号，小程序订单页即刻可见</p>
      </div>
      <button class="btn ghost" @click="init">↻ 刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">订单发货需云端模式（配置 VITE_ADMIN_API）。</p>
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
        {{ tab === 'paid' ? '没有待发货的订单' : '这个状态下还没有订单' }}
      </p>

      <div v-for="o in shown" :key="o.id" class="card order">
        <div class="row head-row">
          <span class="oid">单号 {{ o.id }}</span>
          <span class="time">{{ fmtTime(o.createdAt) }}</span>
          <span class="chip" :class="STATUS[o.status]?.chip">{{ STATUS[o.status]?.label || o.status }}</span>
        </div>

        <div class="row">
          <div class="goods">
            <div v-for="(line, i) in summary(o)" :key="i" class="goods-line">{{ line }}</div>
          </div>
          <b class="amount">￥{{ Number(o.amount).toFixed(2) }}</b>
        </div>

        <div class="row addr">
          <span class="addr-ico">📮</span>
          <span>{{ o.address?.name }} {{ o.address?.phone }} · {{ o.address?.region }} {{ o.address?.detail }}</span>
        </div>

        <!-- 已发货：物流信息 + 改单号 -->
        <div v-if="o.shipping && form?.id !== o.id" class="row logi">
          <span>🚚 {{ o.shipping.company }} · 运单号 {{ o.shipping.trackingNo }}</span>
          <span class="time">发货 {{ fmtTime(o.shippedAt) }}</span>
          <button v-if="o.status === 'shipped'" class="btn ghost mini" @click="openForm(o)">改单号</button>
        </div>

        <!-- 金额异常单（支付回调金额与订单不符）：标红禁发货，须人工核对流水后解除 -->
        <div v-if="o.feeMismatch" class="row mismatch">
          <span class="mismatch-text"
            >⚠️ 支付金额异常待复核——请先到微信支付商户平台核对该单流水，确认无误后解除</span
          >
          <button class="btn ghost mini" @click="doClearMismatch(o)">已核实，解除</button>
        </div>

        <!-- 待发货 / 改单号：行内表单（金额异常单解除前不出发货按钮） -->
        <div v-if="o.status === 'paid' && !o.feeMismatch && form?.id !== o.id" class="row">
          <button class="btn brand" @click="openForm(o)">📦 发货</button>
        </div>
        <div v-if="form?.id === o.id" class="row ship-form">
          <select v-model="form.company" class="input company">
            <option v-for="c in COMPANIES" :key="c" :value="c">{{ c }}</option>
          </select>
          <input
            v-model="form.trackingNo"
            class="input tracking"
            placeholder="运单号"
            @keyup.enter="doShip(o)"
          />
          <button class="btn brand" :disabled="form.saving" @click="doShip(o)">
            {{ form.saving ? '提交中…' : '确认发货' }}
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
.order {
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
.goods {
  flex: 1;
  min-width: 0;
}
.goods-line {
  font-size: 12.5px;
  color: var(--content);
  padding: 1px 0;
}
.amount {
  font-size: 14px;
  color: var(--ink);
}
.addr {
  font-size: 12px;
  color: var(--content-2);
}
.addr-ico {
  flex: 0 0 auto;
}
.logi {
  font-size: 12.5px;
  color: var(--content);
}
.btn.mini {
  padding: 5px 12px;
  font-size: 11.5px;
}
.ship-form .company {
  width: 150px;
  flex: 0 0 auto;
}
.ship-form .tracking {
  width: 240px;
  flex: 0 0 auto;
  font-family: ui-monospace, Menlo, monospace;
}
.err {
  font-size: 12px;
  color: var(--red);
}
.mismatch {
  background: #fdf0ef;
  border: 1px solid #f0c8c5;
  border-radius: 8px;
  padding: 8px 12px;
}
.mismatch-text {
  flex: 1;
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
