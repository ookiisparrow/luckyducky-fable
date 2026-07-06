<script setup lang="ts">
// 库存管理（design/console.pen S14 视觉·M3 UI 批7）：统计卡 + 状态 chip + SKU 表（商品名/价格 join listDrafts
// 真数据·当前库存/低库存预警/售罄/不限量派生）+ 行内调整（保留版本校验 409 并发逻辑）。
// 诚实边界：低库存阈值 10 为显示常量（后端无 per-SKU 阈值）；「批量导入/盘点」无后端 action——省略不加假钮（记待办）。
import { ref, computed, onMounted } from 'vue'
import { Search, Boxes, CircleCheck, TriangleAlert, XCircle, Infinity as InfinityIcon, RefreshCw } from 'lucide-vue-next'
import { listInventory, saveStock } from '../api/system'
import { listDrafts } from '../api/products'
import { mapStock, stockErrorText, type StockRow } from '../lib/mapSystem'
import UiButton from '../components/ui/Button.vue'

const LOW_STOCK = 10 // 默认阈值（per-SKU 未设时退此·仅前端预警线）

interface Row extends StockRow {
  name: string
  priceLabel: string
  status: 'unlimited' | 'out' | 'low' | 'onsale'
}

const rows = ref<Row[]>([])
const truncNote = ref('')
const message = ref('')
const busy = ref(false)
const editKey = ref('')
const editVal = ref('')
const editThreshold = ref('') // per-SKU 阈值编辑（换皮丢·后端 saveStock 早支持 threshold）
const search = ref('')
const filter = ref<'all' | 'onsale' | 'low' | 'out' | 'unlimited'>('all')

const effThreshold = (row: Row) => (row.threshold > 0 ? row.threshold : LOW_STOCK) // per-SKU 优先·未设退默认
function statusOf(stock: number | null, threshold: number): Row['status'] {
  if (stock == null) return 'unlimited'
  if (stock === 0) return 'out'
  if (stock <= (threshold > 0 ? threshold : LOW_STOCK)) return 'low'
  return 'onsale'
}
const STATUS = {
  onsale: { label: '在售', cls: 'onsale' },
  low: { label: '低库存', cls: 'low' },
  out: { label: '售罄', cls: 'out' },
  unlimited: { label: '不限量', cls: 'unlimited' },
}
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'onsale', label: '在售' },
  { key: 'low', label: '低库存' },
  { key: 'out', label: '售罄' },
  { key: 'unlimited', label: '不限量' },
] as const

const counts = computed(() => ({
  all: rows.value.length,
  onsale: rows.value.filter((r) => r.status === 'onsale').length,
  low: rows.value.filter((r) => r.status === 'low').length,
  out: rows.value.filter((r) => r.status === 'out').length,
  unlimited: rows.value.filter((r) => r.status === 'unlimited').length,
}))
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(
    (r) =>
      (filter.value === 'all' || r.status === filter.value) &&
      (!q || r.name.toLowerCase().includes(q) || r.spec.toLowerCase().includes(q) || r.productId.toLowerCase().includes(q))
  )
})

async function reload() {
  busy.value = true
  const [inv, drafts] = await Promise.all([listInventory(), listDrafts()])
  busy.value = false
  const cat: Record<string, { name: string; price: string }> = {}
  if ((drafts as any).ok && Array.isArray((drafts as any).list)) {
    for (const p of (drafts as any).list as Record<string, any>[]) {
      const id = String(p.id || p._id || '')
      if (id) cat[id] = { name: String(p.name || id), price: p.price != null && String(p.price) !== '' ? '¥' + String(p.price) : '—' }
    }
  }
  const m = mapStock((inv as any).ok ? (inv as any).list : [], (inv as any).ok ? (inv as any).truncated : false)
  rows.value = m.rows.map((r) => ({
    ...r,
    name: cat[r.productId]?.name || r.productId,
    priceLabel: cat[r.productId]?.price || '—',
    status: statusOf(r.stock, r.threshold),
  }))
  truncNote.value = m.truncNote
  message.value = (inv as any).ok ? '' : '加载失败：' + String((inv as any).error || '')
}

function startEdit(row: Row) {
  editKey.value = row.key
  editVal.value = row.stock == null ? '' : String(row.stock)
  editThreshold.value = row.threshold > 0 ? String(row.threshold) : ''
}

async function doSave(row: Row) {
  const v = editVal.value.trim()
  const stock = v === '' ? null : Number(v)
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
    message.value = '库存数须为非负整数，或留空表示不限量'
    return
  }
  const th = editThreshold.value.trim()
  const threshold = th === '' ? 0 : Number(th)
  if (th !== '' && (!Number.isInteger(threshold) || threshold < 0)) {
    message.value = '低库存阈值须为非负整数（留空=用默认 ' + LOW_STOCK + '）'
    return
  }
  const r = await saveStock(row.productId, row.spec, stock, row.updatedAt, threshold) // 带版本·被人先改过会 409
  if (r.ok) {
    editKey.value = ''
    message.value = ''
  } else {
    message.value = stockErrorText(r.error, r.status)
  }
  void reload()
}

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>库存管理</h1>
        <p class="sub">实物库存按 SKU 追踪 · 下单即预留、超时/退款自动回补、缺货自动售罄</p>
      </div>
      <button class="btn-refresh" :disabled="busy" @click="reload">
        <RefreshCw :size="15" :stroke-width="1.8" :class="{ spin: busy }" /><span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </button>
    </header>

    <p v-if="truncNote" class="warn-note">{{ truncNote }}</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-head"><span class="stat-label">SKU 总数</span><Boxes class="stat-ico" :size="18" :stroke-width="1.8" /></div>
        <div class="stat-value">{{ counts.all }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><span class="stat-label">在售</span><CircleCheck class="stat-ico ok" :size="18" :stroke-width="1.8" /></div>
        <div class="stat-value">{{ counts.onsale }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><span class="stat-label">低库存预警</span><TriangleAlert class="stat-ico amber" :size="18" :stroke-width="1.8" /></div>
        <div class="stat-value amber">{{ counts.low }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><span class="stat-label">售罄</span><XCircle class="stat-ico red" :size="18" :stroke-width="1.8" /></div>
        <div class="stat-value red">{{ counts.out }}</div>
      </div>
    </div>

    <div class="toolbar">
      <div class="chips">
        <button v-for="f in FILTERS" :key="f.key" class="chip" :class="{ on: filter === f.key }" @click="filter = f.key">
          {{ f.label }}<span class="chip-n">{{ counts[f.key] }}</span>
        </button>
      </div>
      <div class="searchbox">
        <Search :size="15" :stroke-width="1.8" class="search-ico" />
        <input v-model="search" placeholder="搜索商品 / 规格" />
      </div>
    </div>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="shown.length" class="table">
      <div class="thead">
        <span>商品 · 规格</span>
        <span>价格</span>
        <span>当前库存</span>
        <span>状态</span>
        <span class="r">操作</span>
      </div>
      <div v-for="row in shown" :key="row.key" class="trow">
        <div class="prod">
          <div class="prod-name">{{ row.name }}</div>
          <div class="prod-spec">规格：{{ row.spec || '默认款' }}</div>
        </div>
        <span class="price">{{ row.priceLabel }}</span>
        <div class="stock">
          <template v-if="editKey === row.key">
            <input v-model="editVal" class="stockin" placeholder="空=不限量" @keyup.enter="doSave(row)" />
            <input v-model="editThreshold" class="threshin" :placeholder="'阈值(默认' + LOW_STOCK + ')'" title="低库存预警阈值·per-SKU" @keyup.enter="doSave(row)" />
          </template>
          <template v-else-if="row.status === 'unlimited'">
            <InfinityIcon :size="16" :stroke-width="1.8" class="inf" /><span class="stock-hint">现做不限量</span>
          </template>
          <template v-else>
            <span class="stock-num" :class="row.status">{{ row.stock }}</span><span class="unit">件</span>
            <span v-if="row.status === 'low'" class="stock-hint amber">低于阈值 {{ effThreshold(row) }}</span>
            <span v-else-if="row.status === 'out'" class="stock-hint red">需补货</span>
          </template>
        </div>
        <span class="c-state"><span class="state" :class="STATUS[row.status].cls">{{ STATUS[row.status].label }}</span></span>
        <div class="c-ops r">
          <template v-if="editKey === row.key">
            <UiButton size="sm" @click="doSave(row)">保存</UiButton>
            <button class="act ghost" @click="editKey = ''">取消</button>
          </template>
          <template v-else>
            <button class="act ghost" @click="startEdit(row)">调整</button>
            <UiButton v-if="row.status === 'low' || row.status === 'out'" size="sm" @click="startEdit(row)">＋ 补货</UiButton>
          </template>
        </div>
      </div>
    </div>
    <p v-else-if="!message" class="status-soft">{{ rows.length ? '没有符合筛选的 SKU' : '还没有库存档（不限量商品无档是正常的）' }}</p>
    <p class="foot-note">留空 = 不限量（缺货前不拦下单）；下单即预留、超时关单自动回补。调整时可设 per-SKU 低库存阈值（留空退默认 {{ LOW_STOCK }}）。</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 1160px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
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
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.threshin {
  width: 92px;
  margin-left: 6px;
  padding: 6px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 8px;
  font-size: 12px;
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
.warn-note {
  font-size: 12px;
  color: var(--ld-amber);
  margin: 0 0 12px;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}
.stat-card {
  padding: 18px 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stat-label {
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.stat-ico {
  color: var(--ld-brand);
}
.stat-ico.ok {
  color: var(--ld-green);
}
.stat-ico.amber {
  color: var(--ld-amber);
}
.stat-ico.red {
  color: var(--ld-red);
}
.stat-value {
  margin-top: 10px;
  font-size: 28px;
  font-weight: 700;
  color: var(--ld-ink);
  line-height: 1.1;
}
.stat-value.amber {
  color: var(--ld-amber);
}
.stat-value.red {
  color: var(--ld-red);
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
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
  min-width: 240px;
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
  grid-template-columns: 2.2fr 1fr 1.8fr 1fr 1.4fr;
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
.prod-name {
  font-weight: 600;
  color: var(--ld-ink);
}
.prod-spec {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.price {
  color: var(--ld-content);
}
.stock {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stock-num {
  font-size: 15px;
  font-weight: 700;
  color: var(--ld-ink);
}
.stock-num.low {
  color: var(--ld-amber);
}
.stock-num.out {
  color: var(--ld-red);
}
.unit {
  color: var(--ld-content-2);
  font-size: 12px;
}
.inf {
  color: var(--ld-content-2);
}
.stock-hint {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.stock-hint.amber {
  color: var(--ld-amber);
}
.stock-hint.red {
  color: var(--ld-red);
}
.stockin {
  width: 110px;
  padding: 6px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 8px;
  font-size: 13px;
}
.state {
  padding: 3px 11px;
  border-radius: 999px;
  font-size: 11.5px;
  white-space: nowrap;
}
.state.onsale {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.state.low {
  background: var(--ld-bg-lilac);
  color: var(--ld-amber);
}
.state.out {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.state.unlimited {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.c-ops {
  display: flex;
  gap: 6px;
}
/* .act 基类仅留次级按钮（ghost）共享布局；填充主按钮（保存/补货）已收进 UiButton */
.act {
  padding: 6px 13px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.act.ghost {
  background: var(--ld-bg);
  color: var(--ld-content-2);
  border: 1px solid var(--ld-line);
}
.foot-note {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
</style>
