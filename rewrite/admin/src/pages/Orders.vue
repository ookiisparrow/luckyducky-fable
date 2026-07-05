<script setup lang="ts">
// 订单发货（design/console.pen S8 视觉·M3 UI 批4）：页头+刷新、状态 chip（计数走云端 orderCounts 精确总数·
// 不受分页影响）、grid 表格、右滑发货抽屉（收货信息卡+物流公司+运单号）。发货/解除禁发逻辑批4 未动。
// 搜索为已载行客户端过滤（跨全量搜索需服务端 action·记待办）。
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, Search, Package, X, PackageCheck, ScanLine, TriangleAlert } from 'lucide-vue-next'
import { listOrders, orderCounts, shipOrder, clearFeeMismatch } from '../api/money'
import { mapOrderRows, type OrderRowVM } from '../lib/mapMoney'

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
const search = ref('')
const shipRow = ref<OrderRowVM | null>(null)
const shipForm = ref<{ company: string; trackingNo: string }>({ company: '', trackingNo: '' })
const clearConfirmId = ref('')

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((r) => r.id.toLowerCase().includes(q) || r.address.toLowerCase().includes(q))
})

async function reload() {
  message.value = '加载中…'
  const [r, c] = await Promise.all([listOrders(tab.value), orderCounts()])
  if ((r as any).error === 'SESSION_LOST') return
  rows.value = r.ok ? mapOrderRows(r.list) : []
  cursor.value = r.ok ? r.nextCursor : null
  hasMore.value = !!(r.ok && r.hasMore)
  if (c.ok && c.counts) counts.value = c.counts as Record<string, number>
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

async function more() {
  if (!hasMore.value || cursor.value == null) return
  const r = await listOrders(tab.value, cursor.value)
  if (!r.ok) return // 翻页失败不覆盖已有
  const seen = new Set(rows.value.map((x) => x.id))
  rows.value = [...rows.value, ...mapOrderRows(r.list).filter((x) => !seen.has(x.id))]
  cursor.value = r.nextCursor
  hasMore.value = !!r.hasMore
}

function pickTab(k: string) {
  tab.value = k
  void reload()
}

function openShip(row: OrderRowVM) {
  shipRow.value = row
  shipForm.value = { company: '', trackingNo: '' }
}
function closeShip() {
  shipRow.value = null
}

async function doShip() {
  const row = shipRow.value
  const f = shipForm.value
  if (!row || busy.value) return
  if (!f.company.trim() || !f.trackingNo.trim()) {
    message.value = '快递公司和运单号都要填'
    return
  }
  busy.value = true
  const r = await shipOrder(row.id, f.company.trim(), f.trackingNo.trim())
  busy.value = false
  if (r.ok) {
    shipRow.value = null
    message.value = ''
    void reload()
  } else {
    message.value = `发货没成功（${String(r.error || '')}）` // 错误原文如实显示·不吞
  }
}

// 解除禁发走两步确认（禁原生 confirm——no-alert 纪律）
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
        <button v-for="t in TABS" :key="t.key" class="chip" :class="{ on: tab === t.key }" @click="pickTab(t.key)">
          {{ t.label }}<span v-if="counts[t.key || 'all'] != null" class="chip-n">{{ counts[t.key || 'all'] }}</span>
        </button>
      </div>
      <div class="searchbox">
        <Search :size="15" :stroke-width="1.8" class="search-ico" />
        <input v-model="search" placeholder="搜索单号 / 收货信息（已载）" />
      </div>
    </div>
    <p class="note">状态计数为云端实时总数、切换状态走服务端筛选——不受当前分页影响。</p>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="shown.length" class="table">
      <div class="thead">
        <span>单号</span>
        <span>下单时间</span>
        <span>收货</span>
        <span>商品</span>
        <span class="r">金额</span>
        <span>状态</span>
        <span class="r">操作</span>
      </div>
      <div v-for="row in shown" :key="row.id" class="trow" :class="{ mismatch: row.feeMismatch }">
        <div class="c-id">
          <div class="oid">{{ row.id }}</div>
          <div v-if="row.trackingNo" class="track">运单 {{ row.trackingNo }}</div>
        </div>
        <span class="time">{{ row.timeLabel }}</span>
        <span class="addr">{{ row.address || '—' }}</span>
        <span class="goods">{{ row.summary || '—' }}<span class="cnt">×{{ row.count }}</span></span>
        <span class="amount r">{{ row.amountLabel }}</span>
        <span class="c-state">
          <span class="state" :class="row.feeMismatch ? 'warn' : row.status">{{ row.feeMismatch ? '待复核' : row.statusLabel }}</span>
        </span>
        <div class="c-ops r">
          <button v-if="row.canShip" class="act ship" @click="openShip(row)">
            <Package :size="14" :stroke-width="1.8" /><span>发货</span>
          </button>
          <button v-if="row.feeMismatch" class="act danger-out" @click="doClearMismatch(row.id)">
            <TriangleAlert :size="14" :stroke-width="1.8" /><span>{{ clearConfirmId === row.id ? '确认已核对流水？' : '去核对' }}</span>
          </button>
        </div>
      </div>
      <div class="tfoot">
        <span>已加载 {{ rows.length }} 单{{ counts.all != null ? ' / ' + counts.all + ' 单' : '' }}</span>
        <button v-if="hasMore" class="more" @click="more">加载更多</button>
      </div>
    </div>
    <p v-else-if="!message" class="status-soft">这一栏没有订单</p>

    <div v-if="shipRow" class="drawer-mask" @click.self="closeShip">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">发货</div>
            <div class="drawer-oid">单号 {{ shipRow.id }}</div>
          </div>
          <button class="drawer-close" @click="closeShip"><X :size="16" :stroke-width="1.8" /></button>
        </div>
        <div class="addr-card">
          <div class="addr-label">收货信息</div>
          <div class="addr-name">{{ shipRow.address || '（无收货信息）' }}</div>
          <div class="addr-goods">
            <span>{{ shipRow.summary || '—' }} ×{{ shipRow.count }}</span>
            <strong>{{ shipRow.amountLabel }}</strong>
          </div>
        </div>
        <div class="field">
          <label>物流公司</label>
          <input v-model="shipForm.company" placeholder="如 顺丰速运 / 中通 / 圆通" />
        </div>
        <div class="field">
          <label>运单号</label>
          <div class="input-ico">
            <ScanLine :size="16" :stroke-width="1.8" class="fico" />
            <input v-model="shipForm.trackingNo" placeholder="扫描或输入运单号" />
          </div>
        </div>
        <div class="drawer-foot">
          <button class="confirm" :disabled="busy" @click="doShip">
            <PackageCheck :size="16" :stroke-width="1.8" /><span>{{ busy ? '发货中…' : '确认发货' }}</span>
          </button>
          <button class="cancel" @click="closeShip">取消</button>
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
  padding: 8px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  min-width: 260px;
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
.table {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1.8fr 1.5fr 0.9fr 0.9fr 1.2fr;
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
.trow.mismatch {
  background: var(--ld-bg-red-soft);
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
.track {
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
/* 右滑发货抽屉 */
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 15, 30, 0.28);
  display: flex;
  justify-content: flex-end;
  z-index: 40;
}
.drawer {
  width: 380px;
  max-width: 92vw;
  height: 100%;
  background: var(--ld-bg);
  border-left: 1px solid var(--ld-line);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
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
.addr-card {
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
.addr-goods {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.addr-goods strong {
  color: var(--ld-ink);
}
.field label {
  display: block;
  margin-bottom: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ld-content);
}
.field input {
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
</style>
