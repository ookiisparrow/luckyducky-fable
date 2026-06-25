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
 * - 批量发货（P1·上量瓶颈）：待发货 tab 行多选 → 浮现批量操作栏 → 批量发货面板逐单填运单号 → shipOrders
 *   一次发（各自上报微信合规·一单失败不拖累其余）。电子面单取号/打印需快递 API·诚实延后（手动填）。
 *
 * 发货 = 填物流公司 + 运单号 → shipOrder 流转 paid→shipped，小程序订单页即刻显示物流卡；
 * 买家「确认收货」后翻已完成。金额异常单（feeMismatch）须先核对流水解除才能发货。
 */
import { ref, computed } from 'vue'
import { cloudMode, listOrders, orderCounts, getOrderDetail, shipOrder, shipOrders, clearFeeMismatch } from '@/api/cloud.js'
import { confirmDialog, toast } from '@/utils/ui.js'
import { RefreshCw, AlertTriangle } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'

const STATUS = {
  pending: { label: '待支付', chip: 'grey' },
  paid: { label: '待发货', chip: 'warn' },
  shipped: { label: '已发货', chip: '' },
  done: { label: '已完成', chip: 'green' },
  closed: { label: '已关闭', chip: 'grey' },
  // 钱已收但缺货的死信态（审核 P0）：超时关单回补后晚到的支付到账、库存已售罄，待人工退款。
  // [LD_ALERT] PAID_BUT_OOS 实时告警；退款须商家凭 transactionId 手动发起（后续接 admin 退款工具）。
  refund_required: { label: '待退款', chip: 'warn' },
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
  selectedIds.value = [] // 切标签清空批量选择（防跨标签残留）
  loadList()
}

function doSearch() {
  const t = q.value.trim()
  if (t === activeQ.value) return
  activeQ.value = t
  selectedIds.value = []
  loadList()
}
function clearSearch() {
  if (!activeQ.value && !q.value) return
  q.value = ''
  activeQ.value = ''
  selectedIds.value = []
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
    acts: null, // 逐商品激活态（getOrderDetail 异步取·VMlhp）
  }
  if (cloudMode) {
    getOrderDetail(o.id)
      .then((acts) => {
        if (drawer.value && drawer.value.order.id === o.id) drawer.value.acts = acts
      })
      .catch(() => {})
  }
}

// 订单进度时间线（VMlhp）：下单→付款→发货→收货，从订单字段派生（已发生=有时间戳）
function timeline(o) {
  const steps = [
    { label: '下单', at: o.createdAt, done: true },
    { label: '付款成功', at: o.paidAt, sub: o.transactionId ? '微信支付' : '', done: ['paid', 'shipped', 'done'].includes(o.status) || !!o.paidAt },
    { label: '已发货', at: o.shippedAt, sub: o.shipping ? `${o.shipping.company} · ${o.shipping.trackingNo}` : '', done: ['shipped', 'done'].includes(o.status) },
    { label: o.status === 'done' ? '已完成' : '待收货', at: o.status === 'done' ? o.doneAt : null, sub: o.status === 'done' ? '' : '买家确认收货后完成', done: o.status === 'done' },
  ]
  return steps
}
const actOf = (pid) => (drawer.value?.acts ? drawer.value.acts[pid] : null)
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

// —— 批量发货（P1·上量瓶颈）：待发货 tab 多选 → 一次发 ——
// 仅 paid 且非金额异常单可批量发（feeMismatch 须先单独核对·shipped/done 不在此列）。
const selectedIds = ref([])
const canBatch = computed(() => tab.value === 'paid' && !activeQ.value)
const shippableInList = computed(() => list.value.filter((o) => o.status === 'paid' && !o.feeMismatch))
const isShippable = (o) => o.status === 'paid' && !o.feeMismatch
const isSel = (id) => selectedIds.value.includes(id)
function toggleSel(o) {
  if (!isShippable(o)) return
  selectedIds.value = isSel(o.id) ? selectedIds.value.filter((x) => x !== o.id) : [...selectedIds.value, o.id]
}
const allSelected = computed(
  () => shippableInList.value.length > 0 && shippableInList.value.every((o) => isSel(o.id))
)
function toggleAll() {
  selectedIds.value = allSelected.value ? [] : shippableInList.value.map((o) => o.id)
}
function clearSel() {
  selectedIds.value = []
}

// 批量发货面板：{ rows:[{id,name,trackingNo,result?}], company, saving, error, done }
const batch = ref(null)
function openBatch() {
  const chosen = list.value.filter((o) => isSel(o.id))
  if (!chosen.length) return
  batch.value = {
    company: COMPANIES[0],
    rows: chosen.map((o) => ({ id: o.id, name: o.address?.name || '—', trackingNo: '', result: null })),
    saving: false,
    error: '',
    done: false,
  }
}
function closeBatch() {
  if (batch.value?.saving) return
  batch.value = null
}
const batchReady = computed(
  () => !!batch.value && batch.value.company.trim() && batch.value.rows.every((r) => r.trackingNo.trim())
)
async function doBatchShip() {
  const b = batch.value
  if (!b || b.saving) return
  if (!batchReady.value) {
    b.error = '每单都要填运单号、并选择快递公司'
    return
  }
  b.saving = true
  b.error = ''
  try {
    const items = b.rows.map((r) => ({ id: r.id, trackingNo: r.trackingNo.trim() }))
    const res = await shipOrders(items, b.company.trim())
    const byId = Object.fromEntries((res.results || []).map((x) => [x.id, x]))
    for (const r of b.rows) r.result = byId[r.id] || { ok: false, error: 'NO_RESULT' }
    // 成功的从列表/选择中裁掉 + 本地翻 shipped
    const okIds = new Set(b.rows.filter((r) => r.result.ok).map((r) => r.id))
    for (const o of list.value) if (okIds.has(o.id)) o.status = 'shipped'
    if (canBatch.value) list.value = list.value.filter((o) => !okIds.has(o.id)) // 待发货 tab：发完即移出
    selectedIds.value = selectedIds.value.filter((id) => !okIds.has(id))
    b.rows = b.rows.filter((r) => !r.result.ok) // 只留失败的待重试
    b.done = true
    b.saving = false
    loadCounts()
    if (!b.rows.length) batch.value = null // 全成功即关
  } catch (e) {
    b.error = '批量发货失败：' + e.message
    b.saving = false
  }
}

// 金额异常单复核解除：先去商户平台核对流水，确认无误再点（解除后才能发货）
async function doClearMismatch(o) {
  const ok = await confirmDialog({
    title: '解除金额异常',
    message: `确认已在商户平台核对订单 ${o.id} 的支付流水无误？解除后该单可正常发货。`,
    confirmText: '已核对·解除',
  })
  if (!ok) return
  try {
    await clearFeeMismatch(o.id)
    o.feeMismatch = false
    toast('已解除，该单可正常发货', 'ok')
  } catch (e) {
    toast('解除失败：' + e.message, 'err')
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
      <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
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
      <Skeleton v-else-if="loading" class="card" :rows="7" />

      <template v-else>
        <p v-if="!list.length" class="hint">
          {{ activeQ ? '没有匹配该单号的订单' : tab === 'paid' ? '没有待发货的订单' : '这个状态下还没有订单' }}
        </p>

        <div v-else class="card table">
          <div class="row hrow">
            <span class="oid">
              <input
                v-if="canBatch"
                type="checkbox"
                class="ck"
                :checked="allSelected"
                :disabled="!shippableInList.length"
                @change="toggleAll"
              />单号
            </span>
            <span>下单时间</span><span>买家 / 收货</span><span>商品</span>
            <span class="r">金额</span><span>状态</span><span class="r">操作</span>
          </div>
          <div v-for="o in list" :key="o.id" class="row" :class="{ alert: o.feeMismatch, sel: canBatch && isSel(o.id) }">
            <span class="oid">
              <input
                v-if="canBatch"
                type="checkbox"
                class="ck"
                :checked="isSel(o.id)"
                :disabled="!isShippable(o)"
                @click.stop
                @change="toggleSel(o)"
              />{{ o.id }}
            </span>
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
              <button v-if="o.feeMismatch" class="btn ghost mini danger" @click="doClearMismatch(o)"><AlertTriangle :size="13" />去核对</button>
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

    <!-- 批量操作栏（待发货 tab 勾选后浮现·进度式披露） -->
    <div v-if="canBatch && selectedIds.length" class="batchbar">
      <span>已选 <b>{{ selectedIds.length }}</b> 单待发货</span>
      <div class="batchbar-r">
        <button class="btn ghost mini" @click="clearSel">取消</button>
        <button class="btn primary mini" @click="openBatch">批量发货</button>
      </div>
    </div>

    <!-- 批量发货面板 -->
    <div v-if="batch" class="drawer-mask" @click="closeBatch">
      <aside class="drawer" @click.stop>
        <div class="d-head">
          <span class="d-title">批量发货（{{ batch.rows.length }} 单）</span>
          <button class="x" :disabled="batch.saving" @click="closeBatch">×</button>
        </div>
        <div class="d-body">
          <p class="batch-note">
            电子面单取号 / 打印需接快递平台 API（待接）；当前手动填运单号，每单发货后自动上报微信发货合规。
          </p>
          <label class="field-label">快递公司（整批共用）</label>
          <select v-model="batch.company" class="input">
            <option v-for="c in COMPANIES" :key="c" :value="c">{{ c }}</option>
          </select>
          <div class="batch-list">
            <div v-for="r in batch.rows" :key="r.id" class="batch-row" :class="{ bad: r.result && !r.result.ok }">
              <div class="batch-oid">{{ r.id }}<small>{{ r.name }}</small></div>
              <input v-model="r.trackingNo" class="input mini" placeholder="运单号" />
              <span v-if="r.result && !r.result.ok" class="batch-err">{{ r.result.error }}</span>
            </div>
          </div>
          <p v-if="batch.error" class="err">{{ batch.error }}</p>
          <p v-if="batch.done && batch.rows.length" class="hint warn">部分单失败，已保留可改运单号重试。</p>
        </div>
        <div class="d-foot">
          <button class="btn ghost" :disabled="batch.saving" @click="closeBatch">关闭</button>
          <button class="btn primary" :disabled="batch.saving || !batchReady" @click="doBatchShip">
            {{ batch.saving ? '发货中…' : `确认发货 ${batch.rows.length} 单` }}
          </button>
        </div>
      </aside>
    </div>

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
          <!-- 订单进度时间线（VMlhp） -->
          <div class="timeline">
            <div v-for="(s, i) in timeline(drawer.order)" :key="i" class="tl-step" :class="{ done: s.done }">
              <span class="tl-dot" />
              <div class="tl-c">
                <span class="tl-l">{{ s.label }}<em v-if="s.at" class="tl-t">{{ fmtTime(s.at) }}</em></span>
                <span v-if="s.sub" class="tl-s">{{ s.sub }}</span>
              </div>
            </div>
          </div>

          <div class="d-row">
            <span class="d-k">收货人</span>
            <span>{{ drawer.order.address?.name }} · {{ drawer.order.address?.phone }}</span>
          </div>
          <div class="d-row">
            <span class="d-k">收货地址</span>
            <span>{{ drawer.order.address?.region }} {{ drawer.order.address?.detail }}</span>
          </div>
          <!-- 商品 + 逐商品激活态（激活码状态数据链） -->
          <div class="d-row top">
            <span class="d-k">商品</span>
            <span class="d-items">
              <span v-for="it in drawer.order.items || []" :key="it.productId" class="d-item">
                <b>{{ it.name }}{{ it.spec ? `（${it.spec}）` : '' }} ×{{ it.qty }}</b>
                <em v-if="actOf(it.productId)" class="act-tag" :class="actOf(it.productId).activated ? 'used' : 'fresh'">{{
                  actOf(it.productId).activated ? (actOf(it.productId).entered ? '已激活·已进课' : '已激活') : '未激活'
                }}</em>
              </span>
            </span>
          </div>
          <div class="d-row"><span class="d-k">金额</span><b class="amount">￥{{ Number(drawer.order.amount).toFixed(2) }}</b></div>
          <div v-if="drawer.order.transactionId" class="d-row">
            <span class="d-k">交易单号</span><span class="txid">{{ drawer.order.transactionId }}</span>
          </div>

          <!-- 已发货：物流 + 微信发货合规上报状态 -->
          <div v-if="drawer.order.shipping" class="d-logi">
            🚚 {{ drawer.order.shipping.company }} · 运单号 {{ drawer.order.shipping.trackingNo }}
            <small>发货 {{ fmtTime(drawer.order.shippedAt) }}</small>
            <small v-if="drawer.order.wxShipUploaded === false" class="wx-warn">微信发货信息未上传，请到商户平台手动录入</small>
            <small v-else-if="drawer.order.wxShipUploaded" class="wx-ok">✓ 微信发货合规已上报</small>
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
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, Menlo, monospace;
  font-weight: 600;
  font-size: 12px;
  color: var(--ink);
}
.ck {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: var(--brand);
}
.ck:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.row.sel {
  background: var(--bg-lilac);
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
.timeline {
  margin: 0 0 14px;
  padding: 0 0 2px 2px;
}
.tl-step {
  display: flex;
  gap: 11px;
  position: relative;
  padding-bottom: 12px;
}
.tl-step:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 12px;
  bottom: 0;
  width: 1px;
  background: var(--line);
}
.tl-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  margin-top: 3px;
  border-radius: 50%;
  background: var(--bg-grey);
  border: 1px solid var(--line-strong);
  z-index: 1;
}
.tl-step.done .tl-dot {
  background: var(--green);
  border-color: var(--green);
}
.tl-c {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}
.tl-l {
  font-size: 13px;
  color: var(--content-2);
}
.tl-step.done .tl-l {
  color: var(--ink);
  font-weight: 600;
}
.tl-t {
  font-style: normal;
  margin-left: 10px;
  font-size: 11.5px;
  color: var(--content-2);
  font-weight: 400;
}
.tl-s {
  font-size: 11.5px;
  color: var(--content-2);
}
.d-items {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.d-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.act-tag {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
}
.act-tag.fresh {
  background: var(--green-bg);
  border: 1px solid var(--green-line);
  color: var(--green);
}
.act-tag.used {
  background: #fdf6ec;
  border: 1px solid #f0ddc0;
  color: #8a6420;
}
.txid {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  color: var(--content);
  word-break: break-all;
}
.d-logi .wx-ok {
  color: var(--green);
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

/* 批量发货 */
.batchbar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 18px;
  background: var(--purple-ink);
  color: var(--white);
  padding: 12px 18px;
  border-radius: 12px;
  box-shadow: 0 12px 34px #241f3333;
  z-index: 40;
  font-size: 13px;
}
.batchbar b {
  font-size: 15px;
}
.batchbar-r {
  display: flex;
  gap: 8px;
}
.batch-note {
  margin: 0 0 14px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--content-2);
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  border-radius: 9px;
  padding: 9px 12px;
}
.batch-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.batch-row {
  display: grid;
  grid-template-columns: 1fr 150px;
  align-items: center;
  gap: 10px;
}
.batch-row.bad {
  outline: 1px solid #f0c8c5;
  border-radius: 8px;
  padding: 4px;
}
.batch-oid {
  display: flex;
  flex-direction: column;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}
.batch-oid small {
  font-family: inherit;
  font-weight: 400;
  font-size: 11px;
  color: var(--content-2);
}
.input.mini {
  padding: 7px 10px;
  font-size: 12.5px;
}
.batch-err {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--red);
}
</style>
