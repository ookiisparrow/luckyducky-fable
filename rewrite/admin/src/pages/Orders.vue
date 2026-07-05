<script setup lang="ts">
// 订单发货（design/console.pen S8 视觉 · 换皮回归还原批）：在 M3 批4 换皮基础上 1:1 还原旧线交互——
// 服务端跨状态搜索（q·不再只搜已载页）、批量发货（多选→批量面板 shipOrders·上量瓶颈 P1）、
// 富详情抽屉（订单进度时间线 / 逐商品激活态 getOrderDetail / 交易单号 / 微信发货合规上报状态）、
// shipped 改单号 · done 查看、物流公司预设下拉、列表手机号掩码（PII）。删除/解除仍走 no-alert 两步确认。
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, Search, Package, X, PackageCheck, ScanLine, TriangleAlert } from 'lucide-vue-next'
import { listOrders, orderCounts, getOrderDetail, shipOrder, shipOrders, clearFeeMismatch } from '../api/money'
import { mapOrderRows, type OrderRowVM } from '../lib/mapMoney'
import { dateTime } from '../lib/format'
import { COMPANIES } from '../lib/fulfill'

const TABS = [
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '已发货' },
  { key: 'done', label: '已完成' },
  { key: '', label: '全部' },
]

const tab = ref('paid')
const counts = ref<Record<string, number>>({})
const rows = ref<OrderRowVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const message = ref('')
const busy = ref(false)
const search = ref('') // 搜索框输入
const activeQ = ref('') // 已提交搜索词（空=按标签筛选·跨全部状态）
const clearConfirmId = ref('')

// 发货/查看抽屉：mode ship=填单发货（paid 首发 / shipped 改单号）· view=只读查看（done 等）
type Acts = Record<string, { activated?: boolean; entered?: boolean } | undefined>
const drawer = ref<{ row: OrderRowVM; mode: 'ship' | 'view'; company: string; trackingNo: string; acts: Acts | null } | null>(null)

// 列表页脚分母＝当前标签计数（换皮恒用 counts.all·在「待发货」栏也显全量总数·误导以为本栏还有一堆没翻）
const tabTotal = computed(() => counts.value[tab.value || 'all'])

// 批量发货（P1·上量瓶颈）：仅待发货 tab 且非搜索态可批量
const selectedIds = ref<string[]>([])
const batch = ref<{
  company: string
  rows: Array<{ id: string; name: string; trackingNo: string; error: string }>
  saving: boolean
  done: boolean
} | null>(null)

async function reload() {
  message.value = '加载中…'
  const [r, c] = await Promise.all([listOrders(tab.value, undefined, 20, activeQ.value), orderCounts()])
  if ((r as any).error === 'SESSION_LOST') return
  rows.value = r.ok ? mapOrderRows((r as any).list) : []
  cursor.value = r.ok ? (r as any).nextCursor : null
  hasMore.value = !!(r.ok && (r as any).hasMore)
  if (c.ok && (c as any).counts) counts.value = (c as any).counts as Record<string, number>
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

async function more() {
  if (!hasMore.value || cursor.value == null) return
  const r = await listOrders(tab.value, cursor.value, 20, activeQ.value)
  if (!r.ok) return // 翻页失败不覆盖已有
  const seen = new Set(rows.value.map((x) => x.id))
  rows.value = [...rows.value, ...mapOrderRows((r as any).list).filter((x) => !seen.has(x.id))]
  cursor.value = (r as any).nextCursor
  hasMore.value = !!(r as any).hasMore
}

function pickTab(k: string) {
  tab.value = k
  search.value = ''
  activeQ.value = '' // 切标签退出搜索
  selectedIds.value = [] // 清批量选择（防跨标签残留）
  void reload()
}

function doSearch() {
  const t = search.value.trim()
  if (t === activeQ.value) return
  activeQ.value = t
  selectedIds.value = []
  void reload()
}
function clearSearch() {
  if (!activeQ.value && !search.value) return
  search.value = ''
  activeQ.value = ''
  selectedIds.value = []
  void reload()
}

// —— 详情/发货抽屉 ——
function openDrawer(row: OrderRowVM, mode: 'ship' | 'view') {
  drawer.value = { row, mode, company: row.company || COMPANIES[0], trackingNo: row.trackingNo || '', acts: null }
  getOrderDetail(row.id)
    .then((r) => {
      if (r.ok && drawer.value && drawer.value.row.id === row.id) drawer.value.acts = (r as any).activations || {}
    })
    .catch(() => {})
}
function closeDrawer() {
  if (busy.value) return
  drawer.value = null
}
// 订单进度时间线（VMlhp）：下单→付款→发货→收货，从订单字段派生（有时间戳=已发生）
function timeline(row: OrderRowVM) {
  return [
    { label: '下单', at: row.createdAtMs, sub: '', done: true },
    { label: '付款成功', at: row.paidAtMs, sub: row.transactionId ? '微信支付' : '', done: ['paid', 'shipped', 'done'].includes(row.status) || !!row.paidAtMs },
    { label: '已发货', at: row.shippedAtMs, sub: row.company ? `${row.company} · ${row.trackingNo}` : '', done: ['shipped', 'done'].includes(row.status) },
    {
      label: row.status === 'done' ? '已完成' : '待收货',
      at: row.status === 'done' ? row.doneAtMs : null,
      sub: row.status === 'done' ? '' : '买家确认收货后完成',
      done: row.status === 'done',
    },
  ]
}
const actOf = (pid: string) => (drawer.value?.acts ? drawer.value.acts[pid] : undefined)
const actLabel = (a: { activated?: boolean; entered?: boolean }) => (a.activated ? (a.entered ? '已激活·已进课' : '已激活') : '未激活')

async function doShip() {
  const d = drawer.value
  if (!d || busy.value) return
  if (!d.company.trim() || !d.trackingNo.trim()) {
    message.value = '快递公司和运单号都要填'
    return
  }
  busy.value = true
  const r = await shipOrder(d.row.id, d.company.trim(), d.trackingNo.trim())
  busy.value = false
  if (r.ok) {
    drawer.value = null
    message.value = ''
    void reload()
  } else {
    message.value = `发货没成功（${String(r.error || '')}）` // 错误原文如实显示·不吞
  }
}

// —— 批量发货（P1·上量瓶颈）：多选 paid 非异常单 → 一次发 ——
const canBatch = computed(() => tab.value === 'paid' && !activeQ.value)
const shippableInList = computed(() => rows.value.filter((r) => r.canShip))
const isSel = (id: string) => selectedIds.value.includes(id)
function toggleSel(row: OrderRowVM) {
  if (!row.canShip) return
  selectedIds.value = isSel(row.id) ? selectedIds.value.filter((x) => x !== row.id) : [...selectedIds.value, row.id]
}
const allSelected = computed(() => shippableInList.value.length > 0 && shippableInList.value.every((r) => isSel(r.id)))
function toggleAll() {
  selectedIds.value = allSelected.value ? [] : shippableInList.value.map((r) => r.id)
}
function clearSel() {
  selectedIds.value = []
}
function openBatch() {
  const chosen = rows.value.filter((r) => isSel(r.id))
  if (!chosen.length) return
  batch.value = {
    company: COMPANIES[0],
    rows: chosen.map((r) => ({ id: r.id, name: r.addrName || '—', trackingNo: '', error: '' })),
    saving: false,
    done: false,
  }
}
function closeBatch() {
  if (batch.value?.saving) return
  batch.value = null
}
const batchReady = computed(() => !!batch.value && !!batch.value.company.trim() && batch.value.rows.every((r) => r.trackingNo.trim()))
async function doBatchShip() {
  const b = batch.value
  if (!b || b.saving) return
  if (!batchReady.value) {
    b.rows.forEach((r) => (r.error = r.trackingNo.trim() ? '' : '缺运单号'))
    return
  }
  b.saving = true
  const items = b.rows.map((r) => ({ id: r.id, trackingNo: r.trackingNo.trim() }))
  const res = await shipOrders(items, b.company.trim())
  b.saving = false
  if (!res.ok) {
    b.rows.forEach((r) => (r.error = String(res.error || '发货失败')))
    return
  }
  const byId = Object.fromEntries(((res as any).results || []).map((x: any) => [x.id, x]))
  b.rows.forEach((r) => (r.error = byId[r.id]?.ok ? '' : String(byId[r.id]?.error || 'NO_RESULT')))
  b.rows = b.rows.filter((r) => r.error) // 只留失败的可改运单号重试
  b.done = true
  selectedIds.value = []
  void reload() // 服务端真值刷新列表与计数
  if (!b.rows.length) batch.value = null // 全成功即关
}

// 金额异常单解除禁发：no-alert 两步确认（先去商户平台核对流水，确认无误再点）
async function doClearMismatch(id: string) {
  if (clearConfirmId.value !== id) {
    clearConfirmId.value = id
    return
  }
  clearConfirmId.value = ''
  const r = await clearFeeMismatch(id)
  message.value = r.ok ? '' : '解除失败：' + String(r.error || '')
  void reload()
}

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>订单发货</h1>
        <p class="sub">买家付款后在这里发货 · 填好运单号，小程序订单页即刻可见</p>
      </div>
      <button class="btn-refresh" :disabled="message === '加载中…'" @click="reload">
        <RefreshCw :size="15" :stroke-width="1.8" />
        <span>刷新</span>
      </button>
    </header>

    <div class="toolbar">
      <div class="chips">
        <button v-for="t in TABS" :key="t.key" class="chip" :class="{ on: tab === t.key && !activeQ }" @click="pickTab(t.key)">
          {{ t.label }}<span v-if="counts[t.key || 'all'] != null" class="chip-n">{{ counts[t.key || 'all'] }}</span>
        </button>
      </div>
      <div class="searchbox">
        <Search :size="15" :stroke-width="1.8" class="search-ico" />
        <input v-model="search" placeholder="搜索单号（精确·跨全部状态）" @keyup.enter="doSearch" />
        <button class="search-btn" @click="doSearch">搜索</button>
      </div>
    </div>
    <p class="note">状态计数为云端实时总数、切换状态走服务端筛选、搜索按单号跨全部状态精确命中——都不受当前分页影响。</p>

    <div v-if="activeQ" class="searching">
      搜索单号「<b>{{ activeQ }}</b>」的结果（跨全部状态）
      <button class="link" @click="clearSearch">清除搜索</button>
    </div>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="rows.length" class="table">
      <div class="thead">
        <span class="c-id-h">
          <input v-if="canBatch" type="checkbox" class="ck" :checked="allSelected" :disabled="!shippableInList.length" @change="toggleAll" />单号
        </span>
        <span>下单时间</span>
        <span>收货</span>
        <span>商品</span>
        <span class="r">金额</span>
        <span>状态</span>
        <span class="r">操作</span>
      </div>
      <div v-for="row in rows" :key="row.id" class="trow" :class="{ mismatch: row.feeMismatch, sel: canBatch && isSel(row.id) }">
        <div class="c-id">
          <input
            v-if="canBatch"
            type="checkbox"
            class="ck"
            :checked="isSel(row.id)"
            :disabled="!row.canShip"
            @click.stop
            @change="toggleSel(row)"
          />
          <span class="c-id-text">
            <span class="oid">{{ row.id }}</span>
            <span v-if="row.trackingNo" class="track">运单 {{ row.trackingNo }}</span>
          </span>
        </div>
        <span class="time">{{ row.timeLabel }}</span>
        <span class="addr">{{ row.address || '—' }}</span>
        <span class="goods">{{ row.summary || '—' }}<span class="cnt">×{{ row.count }}</span></span>
        <span class="amount r">{{ row.amountLabel }}</span>
        <span class="c-state">
          <span class="state" :class="row.feeMismatch ? 'warn' : row.status">{{ row.feeMismatch ? '待复核' : row.statusLabel }}</span>
        </span>
        <div class="c-ops r">
          <button v-if="row.feeMismatch" class="act danger-out" @click="doClearMismatch(row.id)">
            <TriangleAlert :size="14" :stroke-width="1.8" /><span>{{ clearConfirmId === row.id ? '确认已核对流水？' : '去核对' }}</span>
          </button>
          <button v-else-if="row.canShip" class="act ship" @click="openDrawer(row, 'ship')">
            <Package :size="14" :stroke-width="1.8" /><span>发货</span>
          </button>
          <button v-else-if="row.canModify" class="act ghost-out" @click="openDrawer(row, 'ship')">改单号</button>
          <button v-else class="act ghost-out" @click="openDrawer(row, 'view')">查看</button>
        </div>
      </div>
      <div class="tfoot">
        <span>已加载 {{ rows.length }} 单{{ !activeQ && tabTotal != null ? ' / ' + tabTotal + ' 单（本栏）' : '' }}</span>
        <button v-if="hasMore" class="more" @click="more">加载更多</button>
      </div>
    </div>
    <p v-else-if="!message" class="status-soft">{{ activeQ ? '没有匹配该单号的订单' : '这一栏没有订单' }}</p>

    <!-- 批量操作栏（待发货 tab 勾选后浮现·进度式披露） -->
    <div v-if="canBatch && selectedIds.length" class="batchbar">
      <span>已选 <b>{{ selectedIds.length }}</b> 单待发货</span>
      <div class="batchbar-r">
        <button class="bb-ghost" @click="clearSel">取消</button>
        <button class="bb-primary" @click="openBatch">批量发货</button>
      </div>
    </div>

    <!-- 批量发货面板 -->
    <div v-if="batch" class="drawer-mask" @click.self="closeBatch">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">批量发货</div>
            <div class="drawer-oid">{{ batch.rows.length }} 单 · 逐单填运单号</div>
          </div>
          <button class="drawer-close" :disabled="batch.saving" @click="closeBatch"><X :size="16" :stroke-width="1.8" /></button>
        </div>
        <p class="batch-note">电子面单取号 / 打印需接快递平台 API（待接）；当前手动填运单号，每单发货后自动上报微信发货合规。</p>
        <div class="field">
          <label>快递公司（整批共用）</label>
          <select v-model="batch.company">
            <option v-for="c in COMPANIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="batch-list">
          <div v-for="r in batch.rows" :key="r.id" class="batch-row" :class="{ bad: r.error }">
            <div class="batch-oid">{{ r.id }}<small>{{ r.name }}</small></div>
            <input v-model="r.trackingNo" placeholder="运单号" />
            <span v-if="r.error" class="batch-err">{{ r.error }}</span>
          </div>
        </div>
        <p v-if="batch.done && batch.rows.length" class="batch-warn">部分单失败，已保留可改运单号重试。</p>
        <div class="drawer-foot">
          <button class="confirm" :disabled="batch.saving || !batchReady" @click="doBatchShip">
            <PackageCheck :size="16" :stroke-width="1.8" /><span>{{ batch.saving ? '发货中…' : `确认发货 ${batch.rows.length} 单` }}</span>
          </button>
          <button class="cancel" :disabled="batch.saving" @click="closeBatch">关闭</button>
        </div>
      </aside>
    </div>

    <!-- 发货 / 查看抽屉 -->
    <div v-if="drawer" class="drawer-mask" @click.self="closeDrawer">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">{{ drawer.mode === 'ship' ? (drawer.row.canModify ? '改单号' : '发货') : '订单详情' }}</div>
            <div class="drawer-oid">
              单号 {{ drawer.row.id }}
              <span class="state inline" :class="drawer.row.feeMismatch ? 'warn' : drawer.row.status">{{ drawer.row.statusLabel }}</span>
            </div>
          </div>
          <button class="drawer-close" :disabled="busy" @click="closeDrawer"><X :size="16" :stroke-width="1.8" /></button>
        </div>

        <!-- 订单进度时间线 -->
        <div class="timeline">
          <div v-for="(s, i) in timeline(drawer.row)" :key="i" class="tl-step" :class="{ done: s.done }">
            <span class="tl-dot" />
            <div class="tl-c">
              <span class="tl-l">{{ s.label }}<em v-if="s.at" class="tl-t">{{ dateTime(s.at) }}</em></span>
              <span v-if="s.sub" class="tl-s">{{ s.sub }}</span>
            </div>
          </div>
        </div>

        <div class="addr-card">
          <div class="addr-label">收货信息</div>
          <div class="addr-name">{{ drawer.row.addrName || '（无姓名）' }} · {{ drawer.row.addrPhone || '（无电话）' }}</div>
          <div class="addr-region">{{ drawer.row.addrRegion }} {{ drawer.row.addrDetail }}</div>
        </div>

        <!-- 商品 + 逐商品激活态 -->
        <div class="items-card">
          <div class="addr-label">商品 · 激活状态</div>
          <div v-for="it in drawer.row.items" :key="it.productId || it.name" class="ditem">
            <b>{{ it.name }}{{ it.spec ? `（${it.spec}）` : '' }} ×{{ it.qty }}</b>
            <em v-if="actOf(it.productId)" class="act-tag" :class="actOf(it.productId)!.activated ? 'used' : 'fresh'">{{ actLabel(actOf(it.productId)!) }}</em>
          </div>
          <div class="ditem-foot">
            <span>金额</span><strong>{{ drawer.row.amountLabel }}</strong>
          </div>
          <div v-if="drawer.row.transactionId" class="txid-row"><span>交易单号</span><code>{{ drawer.row.transactionId }}</code></div>
        </div>

        <!-- 已发货：物流 + 微信发货合规上报状态 -->
        <div v-if="drawer.row.company" class="logi-card">
          🚚 {{ drawer.row.company }} · 运单号 {{ drawer.row.trackingNo }}
          <small v-if="drawer.row.shippedAtMs">发货 {{ dateTime(drawer.row.shippedAtMs) }}</small>
          <small v-if="drawer.row.wxShipUploaded === false" class="wx-warn">微信发货信息未上传，请到商户平台手动录入</small>
          <small v-else-if="drawer.row.wxShipUploaded === true" class="wx-ok">✓ 微信发货合规已上报</small>
        </div>

        <!-- 发货表单（ship 模式：paid 首发 / shipped 改单号） -->
        <template v-if="drawer.mode === 'ship'">
          <div class="field">
            <label>物流公司</label>
            <select v-model="drawer.company">
              <option v-for="c in COMPANIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="field">
            <label>运单号</label>
            <div class="input-ico">
              <ScanLine :size="16" :stroke-width="1.8" class="fico" />
              <input v-model="drawer.trackingNo" placeholder="扫描或输入运单号" @keyup.enter="doShip" />
            </div>
          </div>
        </template>

        <div class="drawer-foot">
          <template v-if="drawer.mode === 'ship'">
            <button class="confirm" :disabled="busy" @click="doShip">
              <PackageCheck :size="16" :stroke-width="1.8" /><span>{{ busy ? '提交中…' : drawer.row.canModify ? '保存改动' : '确认发货' }}</span>
            </button>
            <button class="cancel" :disabled="busy" @click="closeDrawer">取消</button>
          </template>
          <button v-else class="cancel solo" @click="closeDrawer">关闭</button>
        </div>
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
  min-width: 300px;
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
.note {
  margin: 0 0 10px;
  font-size: 11.5px;
  color: var(--ld-content-2);
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
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
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
  grid-template-columns: 1.5fr 1fr 1.8fr 1.5fr 0.9fr 0.9fr 1.1fr;
  align-items: center;
  gap: 12px;
  padding: 13px 20px;
}
.thead {
  background: var(--ld-bg-lilac);
  font-size: 12px;
  color: var(--ld-content-2);
}
.c-id-h {
  display: flex;
  align-items: center;
  gap: 8px;
}
.trow {
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
}
.trow.mismatch {
  background: var(--ld-bg-red-soft);
}
.trow.sel {
  background: var(--ld-bg-lilac);
}
.r {
  text-align: right;
  justify-self: end;
}
.c-id {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.c-id-text {
  min-width: 0;
}
.ck {
  flex: none;
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: var(--ld-brand);
}
.ck:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.oid {
  font-family: var(--ld-font-mono);
  font-size: 12.5px;
  color: var(--ld-ink);
}
.track {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.time {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.addr {
  color: var(--ld-content);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.goods {
  color: var(--ld-content);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cnt {
  margin-left: 6px;
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
.state.paid {
  background: var(--ld-bg-lilac);
  color: var(--ld-amber);
}
.state.shipped {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.state.done {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.state.warn {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.state.refund_required {
  background: var(--ld-bg-red-soft);
  color: var(--ld-amber);
}
.state.inline {
  margin-left: 8px;
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
.act.ship {
  background: var(--ld-purple-ink);
  color: #fff;
}
.act.danger-out {
  background: var(--ld-bg);
  color: var(--ld-red);
  border: 1px solid var(--ld-red-line);
}
.act.ghost-out {
  background: var(--ld-bg);
  color: var(--ld-content);
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
.more {
  padding: 7px 18px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  cursor: pointer;
  font-size: 12.5px;
  color: var(--ld-content);
}

/* 批量操作浮条 */
.batchbar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 18px;
  background: var(--ld-purple-ink);
  color: #fff;
  padding: 12px 18px;
  border-radius: 12px;
  box-shadow: 0 12px 34px rgba(20, 15, 30, 0.28);
  z-index: 30;
  font-size: 13px;
}
.batchbar b {
  font-size: 15px;
}
.batchbar-r {
  display: flex;
  gap: 8px;
}
.bb-ghost {
  padding: 7px 14px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 999px;
  background: transparent;
  color: #fff;
  font-size: 12.5px;
  cursor: pointer;
}
.bb-primary {
  padding: 7px 16px;
  border: none;
  border-radius: 999px;
  background: #fff;
  color: var(--ld-purple-ink);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

/* 右滑抽屉 */
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
  max-width: 92vw;
  height: 100%;
  background: var(--ld-bg);
  border-left: 1px solid var(--ld-line);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
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
.drawer-close:disabled {
  opacity: 0.5;
}
/* 时间线 */
.timeline {
  padding: 2px 0 2px 2px;
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
  background: var(--ld-line);
}
.tl-dot {
  flex: none;
  width: 9px;
  height: 9px;
  margin-top: 3px;
  border-radius: 50%;
  background: var(--ld-bg-grey);
  border: 1px solid var(--ld-line-strong);
  z-index: 1;
}
.tl-step.done .tl-dot {
  background: var(--ld-green);
  border-color: var(--ld-green);
}
.tl-c {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}
.tl-l {
  font-size: 13px;
  color: var(--ld-content-2);
}
.tl-step.done .tl-l {
  color: var(--ld-ink);
  font-weight: 600;
}
.tl-t {
  font-style: normal;
  margin-left: 10px;
  font-size: 11.5px;
  color: var(--ld-content-2);
  font-weight: 400;
}
.tl-s {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
/* 收货 / 商品卡 */
.addr-card,
.items-card {
  padding: 14px;
  background: var(--ld-bg-lilac);
  border-radius: 10px;
}
.addr-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--ld-purple-meta);
}
.addr-name {
  margin-top: 8px;
  font-size: 13px;
  color: var(--ld-ink);
  line-height: 1.5;
}
.addr-region {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.ditem {
  margin-top: 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ld-content);
}
.ditem b {
  font-weight: 500;
}
.act-tag {
  flex: none;
  font-style: normal;
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
}
.act-tag.fresh {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.act-tag.used {
  background: var(--ld-bg-red-soft);
  color: var(--ld-amber);
}
.ditem-foot {
  margin-top: 11px;
  padding-top: 10px;
  border-top: 1px solid var(--ld-line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.ditem-foot strong {
  font-size: 14px;
  color: var(--ld-ink);
}
.txid-row {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.txid-row code {
  font-family: var(--ld-font-mono);
  color: var(--ld-content);
  word-break: break-all;
  text-align: right;
}
.logi-card {
  padding: 12px 14px;
  background: var(--ld-bg-green-soft);
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--ld-content);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.logi-card small {
  color: var(--ld-content-2);
  font-size: 11.5px;
}
.logi-card .wx-ok {
  color: var(--ld-green);
}
.logi-card .wx-warn {
  color: var(--ld-red);
}
/* 表单 */
.field label {
  display: block;
  margin-bottom: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ld-content);
}
.field input,
.field select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 10px;
  font-size: 13px;
  background: var(--ld-bg);
  color: var(--ld-ink);
}
.input-ico {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 10px;
  background: var(--ld-bg);
}
.input-ico .fico {
  color: var(--ld-content-2);
  flex: none;
}
.input-ico input {
  border: none;
  padding: 10px 0;
}
/* 批量面板 */
.batch-note {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--ld-content-2);
  background: var(--ld-bg-lilac);
  border-radius: 9px;
  padding: 9px 12px;
}
.batch-list {
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
  outline: 1px solid var(--ld-red-line);
  border-radius: 8px;
  padding: 5px;
}
.batch-oid {
  display: flex;
  flex-direction: column;
  font-family: var(--ld-font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--ld-ink);
}
.batch-oid small {
  font-family: inherit;
  font-weight: 400;
  font-size: 11px;
  color: var(--ld-content-2);
}
.batch-row input {
  padding: 8px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 9px;
  font-size: 12.5px;
  background: var(--ld-bg);
  color: var(--ld-ink);
}
.batch-err {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--ld-red);
}
.batch-warn {
  margin: 0;
  font-size: 12px;
  color: var(--ld-red);
}
/* 抽屉底部 */
.drawer-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.confirm {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 13px 0;
  border: none;
  border-radius: 11px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.confirm:disabled {
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
.cancel.solo {
  padding: 13px 0;
  border: 1px solid var(--ld-line);
  border-radius: 11px;
}
</style>
