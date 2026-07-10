<script setup lang="ts">
// 采购单（设计语言一致性·M3 UI 批16）：草稿→已下单→已收货（收货首次流转入库·重复收货不双入）；总价服务端算。
// 逻辑未动，仅套设计语言（页头/草稿表单卡/grid 表/token）。
import { ref, onMounted, computed } from 'vue'
import { Plus, Trash2, ClipboardList, ChevronDown, ChevronUp } from 'lucide-vue-next'
import { listPurchases, savePurchase, markOrdered, receivePurchase, cancelPurchase, listMaterials, listSuppliers } from '../api/scm'
import { materialHuman, purchaseStatusLabel, yuanToFen, fenLabel, scmErrorText } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import { consumePurchaseHandoff } from '../lib/scmHandoff'
import { useLoadStatus } from '../lib/status'
import { useLatest } from '../lib/latest'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const orders = ref<Array<Record<string, any>>>([])
const mats = ref<Array<Record<string, any>>>([])
const sups = ref<Array<Record<string, any>>>([])
// 动作反馈(note)/加载态(load) 收口（病根#14）：reload 成功不再抹掉动作刚设的成功/失败原文。
const { message, ok: msgOk, note, load } = useLoadStatus()
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

const listGen = useLatest() // 采购单乱序守卫（P2·快切 chip 时旧结果别覆盖当前筛选·根因#8）
const saving = ref(false) // 建单在途锁（P2·防双击建两张重复草稿·后端建单无 id 幂等）
async function reload() {
  confirmKey.value = '' // 换筛选/刷新即复位危险态（P1·防旧武装的下单/收货/取消按钮跨上下文残留一击直发·批3 规格）
  const my = listGen.begin()
  const [p, m, s] = await Promise.all([listPurchases(filter.value || undefined), listMaterials(), listSuppliers()])
  if (listGen.isStale(my)) return // 已切别 chip·丢弃过期采购单
  orders.value = p.ok ? (p.list as Record<string, any>[]) : []
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  sups.value = s.ok ? ((s.list as Record<string, any>[]) || []).filter((x) => x.type === 'factory') : []
  load(p.ok, '加载失败：' + String(p.error || '')) // 只在加载失败时写·成功静默不抹动作反馈
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
  if (!f || saving.value) return // 在途禁再发·防双击建重复草稿
  const snap = f // 快照本次编辑目标（H1·同批G G3/G4 范式）：editDraft 无 saving 门控，await 期间若已切到另一张草稿/新建，回包收尾效果不该打过去
  const lines: Array<{ materialId: string; qty: number; unitPriceFen: number }> = []
  for (const l of f.lines) {
    const fen = yuanToFen(l.priceYuan)
    if (fen === null) {
      note(false, '', '单价不合法（元·最多两位小数）')
      return
    }
    lines.push({ materialId: l.materialId, qty: Number(l.qty), unitPriceFen: fen })
  }
  saving.value = true
  const r = await savePurchase(f.supplierId, lines, f.purchaseId || undefined) // 传 purchaseId＝改草稿·空＝新建
  saving.value = false
  if (form.value === snap) {
    note(r.ok, `草稿已${f.purchaseId ? '更新' : '建'}（总价 ${fenLabel(r.totalFen)}·服务端核算）`, scmErrorText(r.error))
    if (r.ok) form.value = null
  }
  void reload() // 列表刷新与目标是否已切无关·恒执行
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
  note(r.ok, '', scmErrorText(r.error)) // 失败走 note 设 msgOk=false（红）·换皮只写 message 致失败显成功绿
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
  <div class="ld-page">
    <PageHeader title="采购单（向厂家）" sub="草稿 → 已下单 → 已收货；收货首次流转才入库（重复收货不双入），总价服务端核算。">
      <UiButton @click="newOrder"><Plus :size="15" :stroke-width="2" /><span>新建采购单</span></UiButton>
    </PageHeader>

    <ScmFlowTabs />
    <p v-if="message" class="msg" :class="{ ok: msgOk }">{{ message }}</p>

    <!-- 草稿编辑器（本页独有·多行采购明细 + 合计预览） -->
    <Card v-if="form" :title="form.purchaseId ? '编辑采购草稿' : '新建采购草稿'" sub="选厂家 → 逐行填料/数量/单价 → 保存（服务端权威核算总价）" class="draft-card">
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
        <UiButton variant="ghost" size="sm" @click="form.lines.splice(i, 1)"><Trash2 :size="13" :stroke-width="1.8" /></UiButton>
      </div>
      <div class="draft-total">
        合计预览：<strong>{{ draftTotalFen === null ? '填全单价后显示' : fenLabel(draftTotalFen) }}</strong>
        <span class="total-hint">（保存时以服务端核算为准）</span>
      </div>
      <div class="ops">
        <UiButton variant="ghost" @click="form.lines.push({ materialId: '', qty: 1, priceYuan: '' })"><Plus :size="14" :stroke-width="2" /><span>加行</span></UiButton>
        <UiButton @click="doSave">保存草稿</UiButton>
        <UiButton variant="ghost" @click="form = null">取消</UiButton>
      </div>
    </Card>

    <div class="ld-toolbar">
      <button v-for="f in FILTERS" :key="f.key" class="ld-chip" :class="{ on: filter === f.key }" @click="pickFilter(f.key)">{{ f.label }}</button>
    </div>

    <div v-if="orders.length" class="ld-table">
      <div class="ld-thead">
        <div class="ld-th grow">单号</div>
        <div class="ld-th" :style="{ width: '150px' }">供应商</div>
        <div class="ld-th" :style="{ width: '112px' }">行数</div>
        <div class="ld-th r" :style="{ width: '110px' }">总价</div>
        <div class="ld-th" :style="{ width: '100px' }">状态</div>
        <div class="ld-th" :style="{ width: '140px' }">时间</div>
        <div class="ld-th r" :style="{ width: '210px' }">操作</div>
      </div>
      <div class="ld-tbody">
        <template v-for="o in orders" :key="o._id">
          <div class="ld-tr">
            <div class="ld-td grow oid">{{ o._id }}</div>
            <div class="ld-td" :style="{ width: '150px' }">{{ supplierName(o.supplierId) }}</div>
            <div class="ld-td" :style="{ width: '112px' }">
              <UiButton variant="ghost" size="sm" title="看这单买了啥" @click="expanded = expanded === o._id ? '' : o._id">
                <span>{{ (o.lines || []).length }} 行</span>
                <ChevronUp v-if="expanded === o._id" :size="13" :stroke-width="1.8" />
                <ChevronDown v-else :size="13" :stroke-width="1.8" />
              </UiButton>
            </div>
            <div class="ld-td r total" :style="{ width: '110px' }">{{ fenLabel(o.totalFen) }}</div>
            <div class="ld-td" :style="{ width: '100px' }">
              <Badge :tone="o.status === 'received' ? 'green' : o.status === 'ordered' ? 'amber' : o.status === 'draft' ? 'brand' : 'neutral'">{{ purchaseStatusLabel(o.status) }}</Badge>
            </div>
            <div class="ld-td muted" :style="{ width: '140px' }">{{ dateTime(o.createdAt) }}</div>
            <div class="ld-td r ops" :style="{ width: '210px' }">
              <UiButton v-if="o.status === 'draft'" variant="ghost" size="sm" @click="editDraft(o)">编辑</UiButton>
              <UiButton v-if="o.status === 'draft'" variant="primary" size="sm" @click="step(markOrdered, o._id, 'ord:' + o._id)">
                {{ confirmKey === 'ord:' + o._id ? `向「${supplierName(o.supplierId)}」下单 ${fenLabel(o.totalFen)}？` : '标记已下单' }}
              </UiButton>
              <UiButton v-if="o.status === 'ordered'" variant="primary" size="sm" @click="step(receivePurchase, o._id, 'recv:' + o._id)">
                {{ confirmKey === 'recv:' + o._id ? '确认到货入库？' : '收货入库' }}
              </UiButton>
              <UiButton v-if="o.status === 'draft' || o.status === 'ordered'" variant="danger" size="sm" @click="step(cancelPurchase, o._id, 'cancel:' + o._id)">
                {{ confirmKey === 'cancel:' + o._id ? '确认取消？' : '取消' }}
              </UiButton>
            </div>
          </div>
          <!-- 采购行项（本页独有·非草稿单看不到买了啥）：物料名 ×数量（所有状态可查） -->
          <div v-if="expanded === o._id" class="ld-tr detail-row">
            <div class="ld-td grow detail-cell">{{ (o.lines || []).map((l) => materialHuman(l.materialId) + ' ×' + (Number(l.qty) || 0) + (l.unitPriceFen != null ? '（' + fenLabel(l.unitPriceFen) + '）' : '')).join(' · ') || '（无行项）' }}</div>
          </div>
        </template>
      </div>
    </div>
    <EmptyState v-else-if="!form" :icon="ClipboardList" :text="filter ? '这个状态下没有采购单' : '还没有采购单'" />
  </div>
</template>

<style scoped>
/* 本页独有：msgOk 双态提示行 / 草稿多行明细表单 / 采购单表右对齐列 + 可展开行项明细。
 * 页头/卡/徽章/空态/按钮/表格/工具条已交共享原语与 .ld-* 全局类。 */

/* msgOk 双态提示（成功绿·失败红·换皮恒红 bug 的修复保留） */
.msg {
  font-size: 13px;
  color: var(--ld-red);
}
.msg.ok {
  color: var(--ld-green);
}

/* 草稿编辑器：供应商选择 + 逐行明细 + 合计预览 */
.draft-card select,
.draft-card input {
  padding: 8px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  font-family: inherit;
  background: var(--ld-bg);
  color: var(--ld-ink);
  box-sizing: border-box;
}
.sup-sel {
  display: block;
  width: 100%;
  margin-bottom: 12px;
}
.linerow {
  display: grid;
  grid-template-columns: 2fr 84px 120px 88px auto;
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
  margin: 6px 0 14px;
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
.ops {
  display: flex;
  gap: 8px;
}

/* 采购单表：右对齐列 + 单号等宽 + 可展开行项明细 */
.ld-th.r,
.ld-td.r {
  justify-content: flex-end;
}
.ops.ld-td {
  gap: 6px;
  flex-wrap: wrap;
}
.oid {
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
  color: var(--ld-ink);
  word-break: break-all;
}
.total {
  font-weight: 700;
  color: var(--ld-ink);
}
.muted {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.detail-row {
  background: var(--ld-bg-lilac);
}
.detail-cell {
  font-family: var(--ld-font-mono);
  font-size: 12px;
  color: var(--ld-content);
  line-height: 1.5;
}
</style>
