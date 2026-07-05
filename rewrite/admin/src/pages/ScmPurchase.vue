<script setup lang="ts">
// 采购单（设计语言一致性·M3 UI 批16）：草稿→已下单→已收货（收货首次流转入库·重复收货不双入）；总价服务端算。
// 逻辑未动，仅套设计语言（页头/草稿表单卡/grid 表/token）。
import { ref, onMounted, computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import { listPurchases, savePurchase, markOrdered, receivePurchase, cancelPurchase, listMaterials, listSuppliers } from '../api/scm'
import { materialHuman, purchaseStatusLabel, yuanToFen, fenLabel, scmErrorText } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import { consumePurchaseHandoff } from '../lib/scmHandoff'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'

const orders = ref<Array<Record<string, any>>>([])
const mats = ref<Array<Record<string, any>>>([])
const sups = ref<Array<Record<string, any>>>([])
const message = ref('')
const msgOk = ref(false) // 换皮 .status 恒红→成功信息显红 bug·区分成功(绿)/失败(红)
function note(ok: boolean, okText: string, errText: string) {
  message.value = ok ? okText : errText
  msgOk.value = ok
}
const form = ref<{ purchaseId?: string; supplierId: string; lines: Array<{ materialId: string; qty: number; priceYuan: string }> } | null>(null)
const confirmKey = ref('')
const expanded = ref('') // 采购行项展开（换皮丢·非草稿单看不到买了啥·只显行数）
const supplierName = (id: unknown) => (sups.value.find((s) => s._id === id) || {}).name || String(id || '')
const filter = ref('') // 状态筛选（换皮丢·恒取全部）
const FILTERS = [
  { key: '', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'ordered', label: '已下单' },
  { key: 'received', label: '已收货' },
  { key: 'cancelled', label: '已取消' },
]
function pickFilter(k: string) {
  filter.value = k
  void reload()
}

// 逐行小计 + 总价预览（换皮丢·建单看不到花多少钱·总价要保存后才知道）：客户端预览，服务端 savePurchase 仍权威核算
function lineFen(l: { qty: number; priceYuan: string }): number | null {
  const fen = yuanToFen(l.priceYuan)
  return fen === null ? null : fen * (Number(l.qty) || 0)
}
const draftTotalFen = computed(() => {
  if (!form.value) return null
  let sum = 0
  for (const l of form.value.lines) {
    const f = lineFen(l)
    if (f === null) return null // 有非法/未填价的行→整单无法预览
    sum += f
  }
  return sum
})

async function reload() {
  const [p, m, s] = await Promise.all([listPurchases(filter.value || undefined), listMaterials(), listSuppliers()])
  orders.value = p.ok ? (p.list as Record<string, any>[]) : []
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  sups.value = s.ok ? ((s.list as Record<string, any>[]) || []).filter((x) => x.type === 'factory') : []
  note(p.ok, '', '加载失败：' + String(p.error || ''))
}

function newOrder() {
  form.value = { purchaseId: '', supplierId: '', lines: [{ materialId: '', qty: 1, priceYuan: '' }] }
}
// 草稿编辑（换皮丢·草稿建完只能取消重建·后端 savePurchase 收 purchaseId 支持改）：预填表单
function editDraft(o: Record<string, any>) {
  form.value = {
    purchaseId: String(o._id || ''),
    supplierId: String(o.supplierId || ''),
    lines: ((o.lines as Record<string, any>[]) || []).map((l) => ({ materialId: String(l.materialId || ''), qty: Number(l.qty) || 1, priceYuan: l.unitPriceFen != null ? (Number(l.unitPriceFen) / 100).toFixed(2) : '' })),
  }
  if (!form.value.lines.length) form.value.lines.push({ materialId: '', qty: 1, priceYuan: '' })
}

async function doSave() {
  const f = form.value
  if (!f) return
  const lines: Array<{ materialId: string; qty: number; unitPriceFen: number }> = []
  for (const l of f.lines) {
    const fen = yuanToFen(l.priceYuan)
    if (fen === null) {
      note(false, '', '单价不合法（元·最多两位小数）')
      return
    }
    lines.push({ materialId: l.materialId, qty: Number(l.qty), unitPriceFen: fen })
  }
  const r = await savePurchase(f.supplierId, lines, f.purchaseId || undefined) // 传 purchaseId＝改草稿·空＝新建
  note(r.ok, `草稿已${f.purchaseId ? '更新' : '建'}（总价 ${fenLabel(r.totalFen)}·服务端核算）`, scmErrorText(r.error))
  if (r.ok) form.value = null
  void reload()
}

async function step(fn: (_id: string) => Promise<Record<string, unknown>>, id: string, key: string) {
  if (key.startsWith('recv') || key.startsWith('cancel') || key.startsWith('ord')) {
    // 下单/收货/取消都两步确认（换皮下单无任何确认·花钱的动作应有一道·带金额）
    if (confirmKey.value !== key) {
      confirmKey.value = key
      return
    }
    confirmKey.value = ''
  }
  const r = (await fn(id)) as Record<string, any>
  message.value = r.ok ? '' : scmErrorText(r.error)
  void reload()
}

onMounted(async () => {
  await reload()
  // 从备货计算器「去采购开单」带来的缺口预填（一次性 consume）：新草稿 + 供应商 + 缺口行（价待填）
  const h = consumePurchaseHandoff()
  if (h) {
    form.value = { purchaseId: '', supplierId: h.supplierId, lines: h.lines.length ? h.lines.map((l) => ({ materialId: l.materialId, qty: l.qty, priceYuan: '' })) : [{ materialId: '', qty: 1, priceYuan: '' }] }
    note(true, '已按备货缺口预填草稿，补单价后保存', '')
  }
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>采购单（向厂家）</h1>
        <p class="sub">草稿 → 已下单 → 已收货；收货首次流转才入库（重复收货不双入），总价服务端核算。</p>
      </div>
      <button class="btn-primary" @click="newOrder"><Plus :size="15" :stroke-width="2" /><span>新建采购单</span></button>
    </header>

    <ScmFlowTabs />
    <p v-if="message" class="status" :class="{ ok: msgOk }">{{ message }}</p>

    <section v-if="form" class="draft">
      <select v-model="form.supplierId" class="sup-sel">
        <option value="">选厂家…</option>
        <option v-for="s in sups" :key="s._id" :value="s._id">{{ s.name }}</option>
      </select>
      <div v-for="(l, i) in form.lines" :key="i" class="linerow">
        <select v-model="l.materialId">
          <option value="">选料…</option>
          <option v-for="m in mats" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}</option>
        </select>
        <input v-model.number="l.qty" type="number" min="1" placeholder="数量" />
        <input v-model="l.priceYuan" placeholder="单价（元）" />
        <span class="line-sub">{{ lineFen(l) === null ? '—' : fenLabel(lineFen(l)) }}</span>
        <button class="act ghost" @click="form.lines.splice(i, 1)">删行</button>
      </div>
      <div class="draft-total">
        合计预览：<strong>{{ draftTotalFen === null ? '填全单价后显示' : fenLabel(draftTotalFen) }}</strong>
        <span class="total-hint">（保存时以服务端核算为准）</span>
      </div>
      <div class="ops">
        <button class="act ghost" @click="form.lines.push({ materialId: '', qty: 1, priceYuan: '' })"><Plus :size="13" :stroke-width="2" /><span>加行</span></button>
        <button class="act primary" @click="doSave">保存草稿</button>
        <button class="act ghost" @click="form = null">取消</button>
      </div>
    </section>

    <div class="filters">
      <button v-for="f in FILTERS" :key="f.key" class="fchip" :class="{ on: filter === f.key }" @click="pickFilter(f.key)">{{ f.label }}</button>
    </div>

    <div v-if="orders.length" class="table">
      <div class="thead"><span>单号</span><span>供应商</span><span class="r">行数</span><span class="r">总价</span><span>状态</span><span>时间</span><span class="r">操作</span></div>
      <template v-for="o in orders" :key="o._id">
        <div class="trow">
          <span class="mono">{{ o._id }}</span>
          <span>{{ supplierName(o.supplierId) }}</span>
          <span class="r"><button class="lines-btn" :title="'看这单买了啥'" @click="expanded = expanded === o._id ? '' : o._id">{{ (o.lines || []).length }} 行 {{ expanded === o._id ? '▴' : '▾' }}</button></span>
          <span class="r strong">{{ fenLabel(o.totalFen) }}</span>
          <span><span class="state" :class="o.status">{{ purchaseStatusLabel(o.status) }}</span></span>
          <span class="muted">{{ dateTime(o.createdAt) }}</span>
          <div class="c-ops r">
            <button v-if="o.status === 'draft'" class="act ghost" @click="editDraft(o)">编辑</button>
            <button v-if="o.status === 'draft'" class="act primary" @click="step(markOrdered, o._id, 'ord:' + o._id)">
              {{ confirmKey === 'ord:' + o._id ? `向「${supplierName(o.supplierId)}」下单 ${fenLabel(o.totalFen)}？` : '标记已下单' }}
            </button>
            <button v-if="o.status === 'ordered'" class="act primary" @click="step(receivePurchase, o._id, 'recv:' + o._id)">
              {{ confirmKey === 'recv:' + o._id ? '确认到货入库？' : '收货入库' }}
            </button>
            <button v-if="o.status === 'draft' || o.status === 'ordered'" class="act warn" @click="step(cancelPurchase, o._id, 'cancel:' + o._id)">
              {{ confirmKey === 'cancel:' + o._id ? '确认取消？' : '取消' }}
            </button>
          </div>
        </div>
        <!-- 采购行项（换皮丢·非草稿单看不到买了啥）：物料名 ×数量（所有状态可查） -->
        <div v-if="expanded === o._id" class="trow sub-row">
          <span class="lines-detail">{{ (o.lines || []).map((l) => materialHuman(l.materialId) + ' ×' + (Number(l.qty) || 0) + (l.unitPriceFen != null ? '（' + fenLabel(l.unitPriceFen) + '）' : '')).join(' · ') || '（无行项）' }}</span>
        </div>
      </template>
    </div>
    <p v-else-if="!form" class="status-soft">{{ filter ? '这个状态下没有采购单' : '还没有采购单' }}</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 1120px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
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
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 10px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.status {
  font-size: 13px;
  color: var(--ld-red);
  margin-bottom: 10px;
}
.status.ok {
  color: var(--ld-green);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
}
.filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.fchip {
  padding: 6px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 12.5px;
  cursor: pointer;
}
.fchip.on {
  background: var(--ld-purple-ink);
  border-color: var(--ld-purple-ink);
  color: #fff;
}
.draft {
  padding: 16px 18px;
  margin-bottom: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  max-width: 760px;
}
.sup-sel {
  display: block;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
}
.linerow {
  display: grid;
  grid-template-columns: 2fr 90px 120px 90px auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.line-sub {
  text-align: right;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.draft-total {
  margin: 4px 0 12px;
  font-size: 13px;
  color: var(--ld-content);
}
.draft-total strong {
  color: var(--ld-brand-active);
  font-size: 15px;
}
.total-hint {
  font-size: 11px;
  color: var(--ld-content-2);
}
.linerow select,
.linerow input {
  padding: 8px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
}
.ops {
  display: flex;
  gap: 8px;
  margin-top: 4px;
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
  grid-template-columns: 1.4fr 1.4fr 0.6fr 0.9fr 0.9fr 1.1fr 1.6fr;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
}
.thead {
  background: var(--ld-bg-lilac);
  font-size: 12px;
  color: var(--ld-content-2);
}
.trow {
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
  color: var(--ld-content);
}
.trow.sub-row {
  display: block;
  padding: 8px 18px 10px;
  background: var(--ld-bg-lilac);
}
.lines-detail {
  font-size: 12px;
  color: var(--ld-content);
  font-family: var(--ld-font-mono);
  line-height: 1.5;
}
.lines-btn {
  padding: 2px 9px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-brand-active);
  font-size: 11px;
  cursor: pointer;
}
.r {
  text-align: right;
  justify-self: end;
}
.mono {
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
  color: var(--ld-ink);
}
.strong {
  font-weight: 700;
  color: var(--ld-ink);
}
.muted {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.state {
  padding: 3px 11px;
  border-radius: 999px;
  font-size: 11.5px;
  white-space: nowrap;
  background: var(--ld-bg-faint);
  color: var(--ld-content-2);
}
.state.draft {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.state.ordered {
  background: var(--ld-bg-lilac);
  color: var(--ld-amber);
}
.state.received {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.c-ops {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.act {
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.act.primary {
  background: var(--ld-purple-ink);
  color: #fff;
}
.act.ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  border: 1px solid var(--ld-line);
}
.act.warn {
  background: var(--ld-red);
  color: #fff;
}
</style>
