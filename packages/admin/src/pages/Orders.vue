<script setup>
/**
 * 订单发货（S8 重设计·密集表格）。买家付款后在这里发货。
 *
 * 重设计要点（修原痛点·根因#7 计数/筛选/搜索失真）：
 * - 标签计数走服务端 orderCounts（.count() 精确·不封顶），不再从「已加载页」数——分页后不再少算。
 * - 切状态走服务端筛选（listOrders status），不在前端 filter 已加载页——不再漏单。
 * - 搜索按单号走服务端精确命中（listOrders q），跨全部状态、不受当前页/标签限制。
 * - 卡片流改密集表格（单号/时间/买家·收货/商品/金额/状态/操作），一屏看更多单。
 * - 发货/改单号/查看收进右侧抽屉，列表保持紧凑。
 *
 * 发货 = 填物流公司 + 运单号 → shipOrder 流转 paid→shipped，小程序订单页即刻显示物流卡；
 * 买家「确认收货」后翻已完成。金额异常单（feeMismatch）须先核对流水解除才能发货。
 */
import { ref, computed } from 'vue'
import { cloudMode, listOrders, orderCounts, shipOrder, clearFeeMismatch } from '@/api/cloud.js'

const STATUS = {
  pending: { label: '待支付', chip: 'grey' },
  paid: { label: '待发货', chip: 'warn' },
  shipped: { label: '已发货', chip: '' },
  done: { label: '已完成', chip: 'green' },
  closed: { label: '已关闭', chip: 'grey' },
}
const TABS = [
  { key: 'paid', label: '待发货', status: 'paid' },
  { key: 'shipped', label: '已发货', status: 'shipped' },
  { key: 'done', label: '已完成', status: 'done' },
  { key: 'all', label: '全部', status: 'all' },
]
const COMPANIES = ['顺丰速运', '中通快递', '圆通速递', '韵达快递', '申通快递', '邮政 EMS', '京东物流']

const counts = ref({}) // 服务端精确计数 { all, pending, paid, shipped, done, closed }
const list = ref([])
const loading = ref(true)
const loadErr = ref('')
const tab = ref('paid')
const q = ref('') // 搜索框输入
const activeQ = ref('') // 已提交的搜索词（空=按标签筛选）
const nextCursor = ref(null)
const hasMore = ref(false)
const loadingMore = ref(false)
// 发货/查看抽屉：{ order, mode:'ship'|'view', company, trackingNo, saving, error }
const drawer = ref(null)

const activeStatus = computed(() => TABS.find((t) => t.key === tab.value)?.status || 'all')
const tabCount = (t) => (t.status === 'all' ? (counts.value.all ?? 0) : (counts.value[t.status] ?? 0))

async function loadCounts() {
  if (!cloudMode) return
  try {
    counts.value = await orderCounts()
  } catch {
    /* 计数失败不阻断列表 */
  }
}

// 重载列表（切标签/搜索/刷新都走它）：服务端按 status/q 过滤，回到第一页
async function loadList() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const paged = await listOrders({ status: activeStatus.value, q: activeQ.value })
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

// 加载更多（游标分页·根因#7）：沿用当前 status/q 上下文，按 id 去重防重入
async function loadMore() {
  if (loadingMore.value || !hasMore.value || nextCursor.value == null) return
  loadingMore.value = true
  try {
    const paged = await listOrders({ status: activeStatus.value, q: activeQ.value, cursor: nextCursor.value })
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

function switchTab(key) {
  if (tab.value === key && !activeQ.value) return
  tab.value = key
  q.value = ''
  activeQ.value = '' // 切标签即退出搜索
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
const itemLines = (o) => (o.items || []).map((it) => `${it.name}${it.spec ? `（${it.spec}）` : ''} ×${it.qty}`)
const itemBrief = (o) => {
  const lines = itemLines(o)
  return lines.length <= 1 ? lines[0] || '—' : `${lines[0]} 等 ${lines.length} 件`
}

// 抽屉是否仍匹配当前筛选（发货后状态变了要不要留在列表）
function matchesFilter(o) {
  if (activeQ.value) return true
  if (activeStatus.value === 'all') return true
  return o.status === activeStatus.value
}

function openDrawer(o, mode) {
  drawer.value = {
    order: o,
    mode,
    company: o.shipping?.company || COMPANIES[0],
    trackingNo: o.shipping?.trackingNo || '',
    saving: false,
    error: '',
  }
}
function closeDrawer() {
  if (drawer.value?.saving) return
  drawer.value = null
}

async function doShip() {
  const d = drawer.value
  if (!d || d.saving) return
  if (!d.company.trim() || !d.trackingNo.trim()) {
    d.error = '物流公司和运单号都要填'
    return
  }
  d.saving = true
  d.error = ''
  try {
    await shipOrder(d.order.id, d.company.trim(), d.trackingNo.trim())
    const o = d.order
    o.status = 'shipped'
    o.shipping = { company: d.company.trim(), trackingNo: d.trackingNo.trim() }
    if (!o.shippedAt) o.shippedAt = Date.now()
    drawer.value = null
    // 发货后状态变了：从列表裁掉不再匹配的单 + 刷新服务端计数（paid--/shipped++）
    if (!matchesFilter(o)) list.value = list.value.filter((x) => x.id !== o.id)
    loadCounts()
  } catch (e) {
    d.error = '发货失败：' + e.message
    d.saving = false
  }
}

// 金额异常单复核解除：先去商户平台核对流水，确认无误再点（解除后才能发货）
async function doClearMismatch(o) {
  if (!window.confirm(`确认已在商户平台核对订单 ${o.id} 的支付流水无误？解除后该单可正常发货。`)) return
  try {
    await clearFeeMismatch(o.id)
    o.feeMismatch = false
  } catch (e) {
    window.alert('解除失败：' + e.message)
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
          <input
            v-model="q"
            class="input"
            placeholder="搜索单号（精确）"
            @keyup.enter="doSearch"
          />
          <button class="btn ghost mini" @click="doSearch">搜索</button>
        </div>
      </div>

      <p class="cloud-note">
        状态计数与筛选均来自云端实时统计，不受当前页加载量影响（修原「计数失真」问题）。
      </p>

      <div v-if="activeQ" class="searching">
        搜索单号「<b>{{ activeQ }}</b>」的结果（跨全部状态）
        <button class="link" @click="clearSearch">清除搜索</button>
      </div>

      <p v-if="loadErr" class="hint warn">{{ loadErr }}</p>
      <p v-else-if="loading" class="hint">加载中…</p>

      <template v-else>
        <p v-if="!list.length" class="hint">
          {{ activeQ ? '没有匹配该单号的订单' : tab === 'paid' ? '没有待发货的订单' : '这个状态下还没有订单' }}
        </p>

        <div v-else class="card table">
          <div class="row hrow">
            <span>单号</span><span>下单时间</span><span>买家 / 收货</span><span>商品</span>
            <span class="r">金额</span><span>状态</span><span class="r">操作</span>
          </div>
          <div v-for="o in list" :key="o.id" class="row" :class="{ alert: o.feeMismatch }">
            <span class="oid">{{ o.id }}</span>
            <span class="muted">{{ fmtTime(o.createdAt) }}</span>
            <span class="buyer">
              <b>{{ o.address?.name || '—' }}</b><em>{{ maskPhone(o.address?.phone) }}</em>
              <small>{{ o.address?.region }} {{ o.address?.detail }}</small>
            </span>
            <span class="goods" :title="itemLines(o).join('、')">{{ itemBrief(o) }}</span>
            <span class="r amount">￥{{ Number(o.amount).toFixed(2) }}</span>
            <span>
              <span class="chip" :class="STATUS[o.status]?.chip">{{ STATUS[o.status]?.label || o.status }}</span>
            </span>
            <span class="r ops">
              <button v-if="o.feeMismatch" class="btn ghost mini danger" @click="doClearMismatch(o)">⚠ 去核对</button>
              <button v-else-if="o.status === 'paid'" class="btn primary mini" @click="openDrawer(o, 'ship')">发货</button>
              <button v-else-if="o.status === 'shipped'" class="btn ghost mini" @click="openDrawer(o, 'ship')">改单号</button>
              <button v-else class="btn ghost mini" @click="openDrawer(o, 'view')">查看</button>
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

    <!-- 发货 / 查看抽屉 -->
    <div v-if="drawer" class="drawer-mask" @click="closeDrawer">
      <aside class="drawer" @click.stop>
        <div class="d-head">
          <div>
            <span class="d-title">订单 {{ drawer.order.id }}</span>
            <span class="chip" :class="STATUS[drawer.order.status]?.chip">{{
              STATUS[drawer.order.status]?.label || drawer.order.status
            }}</span>
          </div>
          <button class="x" :disabled="drawer.saving" @click="closeDrawer">×</button>
        </div>

        <div class="d-body">
          <div class="d-row"><span class="d-k">下单时间</span><span>{{ fmtTime(drawer.order.createdAt) }}</span></div>
          <div class="d-row">
            <span class="d-k">收货人</span>
            <span>{{ drawer.order.address?.name }} · {{ drawer.order.address?.phone }}</span>
          </div>
          <div class="d-row">
            <span class="d-k">收货地址</span>
            <span>{{ drawer.order.address?.region }} {{ drawer.order.address?.detail }}</span>
          </div>
          <div class="d-row top">
            <span class="d-k">商品</span>
            <span class="d-goods">
              <span v-for="(line, i) in itemLines(drawer.order)" :key="i">{{ line }}</span>
            </span>
          </div>
          <div class="d-row"><span class="d-k">金额</span><b class="amount">￥{{ Number(drawer.order.amount).toFixed(2) }}</b></div>

          <!-- 已发货：现有物流信息 -->
          <div v-if="drawer.order.shipping" class="d-logi">
            🚚 {{ drawer.order.shipping.company }} · 运单号 {{ drawer.order.shipping.trackingNo }}
            <small>发货 {{ fmtTime(drawer.order.shippedAt) }}</small>
            <small v-if="drawer.order.wxShipUploaded === false" class="wx-warn">微信发货信息未上传，请到商户平台手动录入</small>
          </div>

          <!-- 发货表单（ship 模式：paid 首发 / shipped 改单号） -->
          <template v-if="drawer.mode === 'ship'">
            <div class="d-form">
              <label class="field-label">物流公司</label>
              <select v-model="drawer.company" class="input">
                <option v-for="c in COMPANIES" :key="c" :value="c">{{ c }}</option>
              </select>
              <label class="field-label">运单号</label>
              <input v-model="drawer.trackingNo" class="input mono" placeholder="请输入运单号" @keyup.enter="doShip" />
              <p v-if="drawer.error" class="err">{{ drawer.error }}</p>
            </div>
          </template>
        </div>

        <div v-if="drawer.mode === 'ship'" class="d-foot">
          <button class="btn ghost" :disabled="drawer.saving" @click="closeDrawer">取消</button>
          <button class="btn primary" :disabled="drawer.saving" @click="doShip">
            {{ drawer.saving ? '提交中…' : drawer.order.status === 'shipped' ? '保存改动' : '确认发货' }}
          </button>
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

/* 密集表格：grid 七列 */
.table {
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 104px 92px 1.5fr 1.2fr 92px 78px 96px;
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
.row.alert {
  background: #fdf0ef;
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.5;
}
.buyer b {
  color: var(--ink);
  display: inline;
}
.buyer em {
  font-style: normal;
  color: var(--content-2);
  margin-left: 6px;
  font-size: 11.5px;
}
.buyer small {
  color: var(--content-2);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.goods {
  color: var(--content);
  min-width: 0;
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
.btn.mini.danger {
  border-color: #f0c8c5;
  color: var(--red);
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
  font-family: ui-monospace, Menlo, monospace;
  font-weight: 600;
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
.d-row {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--content);
}
.d-row.top {
  align-items: flex-start;
}
.d-k {
  flex: 0 0 64px;
  color: var(--content-2);
  font-size: 12px;
}
.d-goods {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.d-logi {
  margin-top: 14px;
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
.d-logi small {
  color: var(--content-2);
  font-size: 11.5px;
}
.d-logi .wx-warn {
  color: var(--red);
}
.d-form {
  margin-top: 18px;
}
.d-form .input {
  margin-bottom: 12px;
}
.d-form .mono {
  font-family: ui-monospace, Menlo, monospace;
}
.err {
  color: var(--red);
  font-size: 12px;
  margin: 0;
}
.d-foot {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 16px 22px;
  border-top: 1px solid var(--line);
}
</style>
