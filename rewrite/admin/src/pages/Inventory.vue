<script setup lang="ts">
// 库存管理（design/console.pen S14 视觉·M3 UI 批7）：统计卡 + 状态 chip + SKU 表（商品名/价格 join listDrafts
// 真数据·当前库存/低库存预警/售罄/不限量派生）+ 行内调整（保留版本校验 409 并发逻辑）。
// 诚实边界：低库存阈值 10 为显示常量（后端无 per-SKU 阈值）；「批量导入/盘点」无后端 action——省略不加假钮（记待办）。
import { ref, computed, onMounted } from 'vue'
import { Search, Boxes, CircleCheck, TriangleAlert, XCircle, Infinity as InfinityIcon, RefreshCw } from 'lucide-vue-next'
import { listInventory, saveStock } from '../api/system'
import { listDrafts } from '../api/products'
import { mapStock, stockErrorText, type StockRow } from '../lib/mapSystem'
import { useLoadStatus } from '../lib/status'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const LOW_STOCK = 10 // 默认阈值（per-SKU 未设时退此·仅前端预警线）

interface Row extends StockRow {
  name: string
  priceLabel: string
  status: 'unlimited' | 'out' | 'low' | 'onsale'
}

const rows = ref<Row[]>([])
const truncNote = ref('')
// 动作反馈/加载态收口（病根#14）：reload 成功不再抹掉 doSave 刚设的 409 冲突原文等动作反馈。
const { message, load } = useLoadStatus()
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
  load((inv as any).ok, '加载失败：' + String((inv as any).error || '')) // 只在加载失败时写·成功不抹动作反馈（409 冲突原文留住）
}

function startEdit(row: Row) {
  editKey.value = row.key
  editVal.value = row.stock == null ? '' : String(row.stock)
  editThreshold.value = row.threshold > 0 ? String(row.threshold) : ''
}

async function doSave(row: Row) {
  const key = editKey.value // 快照发起时的编辑目标（G4·P2）：回包后若已切到别行编辑，不清新行正开着的 editKey
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
    if (editKey.value === key) editKey.value = '' // 仍是发起时那行才收起编辑态，别顶掉新打开的行内编辑（G4）
    message.value = ''
  } else {
    message.value = stockErrorText(r.error, r.status) // 失败提示不受目标切换影响，全局可见（同既有行为）
  }
  void reload()
}

onMounted(reload)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="实物库存" sub="实物库存按 SKU 追踪 · 下单即预留、超时/退款自动回补、缺货自动售罄">
      <UiButton variant="ghost" size="sm" :disabled="busy" @click="reload">
        <RefreshCw :size="14" :stroke-width="1.8" :class="{ spin: busy }" />
        <span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </UiButton>
    </PageHeader>

    <p v-if="truncNote" class="ld-status">{{ truncNote }}</p>

    <div class="ld-kpi-grid">
      <KpiCard label="SKU 总数" :value="counts.all" :icon="Boxes" />
      <KpiCard label="在售" :value="counts.onsale" :icon="CircleCheck" />
      <KpiCard label="低库存预警" :value="counts.low" :icon="TriangleAlert" />
      <KpiCard label="售罄" :value="counts.out" :icon="XCircle" tone="red" />
    </div>

    <div class="ld-toolbar">
      <button v-for="f in FILTERS" :key="f.key" class="ld-chip" :class="{ on: filter === f.key }" @click="filter = f.key">
        {{ f.label }}<span class="chip-n">{{ counts[f.key] }}</span>
      </button>
      <div class="ld-search search-r">
        <Search :size="15" :stroke-width="1.8" class="search-ico" />
        <input v-model="search" placeholder="搜索商品 / 规格" />
      </div>
    </div>

    <p v-if="message" class="ld-status msg-err">{{ message }}</p>

    <div v-if="shown.length" class="ld-table">
      <div class="ld-thead">
        <div class="ld-th grow">商品 · 规格</div>
        <div class="ld-th" :style="{ width: '100px' }">售价</div>
        <div class="ld-th" :style="{ width: '250px' }">当前库存</div>
        <div class="ld-th" :style="{ width: '110px' }">状态</div>
        <div class="ld-th ops-cell" :style="{ width: '180px' }">操作</div>
      </div>
      <div class="ld-tbody">
        <div v-for="row in shown" :key="row.key" class="ld-tr">
          <div class="ld-td grow">
            <div class="prod">
              <div class="prod-name">{{ row.name }}</div>
              <div class="prod-spec">规格：{{ row.spec || '默认款' }}</div>
            </div>
          </div>
          <div class="ld-td" :style="{ width: '100px' }">{{ row.priceLabel }}</div>
          <div class="ld-td stock-cell" :style="{ width: '250px' }">
            <template v-if="editKey === row.key">
              <input v-model="editVal" class="stockin" placeholder="空=不限量" @keyup.enter="doSave(row)" />
              <input
                v-model="editThreshold"
                class="threshin"
                :placeholder="'阈值(默认' + LOW_STOCK + ')'"
                title="低库存预警阈值·per-SKU"
                @keyup.enter="doSave(row)"
              />
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
          <div class="ld-td" :style="{ width: '110px' }">
            <Badge :tone="row.status === 'onsale' ? 'green' : row.status === 'low' ? 'amber' : row.status === 'out' ? 'red' : 'brand'">{{
              STATUS[row.status].label
            }}</Badge>
          </div>
          <div class="ld-td ops-cell" :style="{ width: '180px' }">
            <template v-if="editKey === row.key">
              <UiButton size="sm" @click="doSave(row)">保存</UiButton>
              <UiButton variant="ghost" size="sm" @click="editKey = ''">取消</UiButton>
            </template>
            <template v-else>
              <UiButton variant="ghost" size="sm" @click="startEdit(row)">调整</UiButton>
              <UiButton v-if="row.status === 'low' || row.status === 'out'" size="sm" @click="startEdit(row)">＋ 补货</UiButton>
            </template>
          </div>
        </div>
      </div>
    </div>
    <EmptyState
      v-else-if="!message"
      :icon="Boxes"
      :text="rows.length ? '没有符合筛选的 SKU' : '还没有库存档（不限量商品无档是正常的）'"
    />
    <p class="foot-note">留空 = 不限量（缺货前不拦下单）；下单即预留、超时关单自动回补。调整时可设 per-SKU 低库存阈值（留空退默认 {{ LOW_STOCK }}）。</p>
  </div>
</template>

<style scoped>
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
/* 工具条：搜索靠右 + 内嵌搜索图标（.ld-toolbar/.ld-chip/.ld-search 走全局 console.css） */
.search-r {
  margin-left: auto;
}
.search-ico {
  color: var(--ld-content-2);
  flex: none;
}
/* chip 内嵌数字徽章（design：bg-grey·激活转 brand·圆角99·小字） */
.chip-n {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ld-bg-grey);
  color: var(--ld-content-2);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
}
.ld-chip.on .chip-n {
  background: var(--ld-brand);
  color: #fff;
}
/* 商品·规格双行单元 */
.prod {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.prod-name {
  font-weight: 600;
  color: var(--ld-ink);
}
.prod-spec {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
/* 库存单元：数字 + 单位 + 提示 / 行内编辑双输入 */
.stock-cell {
  gap: 6px;
  flex-wrap: wrap;
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
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
}
.threshin {
  width: 92px;
  padding: 6px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 12px;
}
/* 操作单元靠右 */
.ops-cell {
  gap: 6px;
  justify-content: flex-end;
}
/* 错误/校验提示：覆盖 .ld-status 的灰底为红（本页 message 恒为错误态） */
.msg-err {
  color: var(--ld-red);
}
.foot-note {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
</style>
