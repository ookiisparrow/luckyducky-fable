<script setup>
/**
 * 采购管理（进销存车道 A·蓝图 docs/进销存ERP/ §4）。厂家采购单：建/改草稿（供应商下拉·行编辑
 * 物料/数量/单价）→ 下单 → 到货入库（云端首次流转绑门1 applyStockMoves·重放幂等）→ 或取消（入库后不可取消）。
 * 金额展示用元、传输/存储全是分（边界收元转分一次·CLAUDE §4）；totalFen 云端算、本页只预览。状态/入库全在云端闸内，本页只编排。
 */
import { ref, computed } from 'vue'
import { cloudMode, listPurchases, savePurchase, markPurchaseOrdered, receivePurchase, cancelPurchase, listMaterials, listSuppliers } from '@/api/cloud.js'
import { confirmDialog, toast } from '@/utils/ui.js'
import { RefreshCw, Plus, Trash2 } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'

const loading = ref(true)
const loadErr = ref('')
const purchases = ref([])
const materials = ref([])
const suppliers = ref([])
const busy = ref('')
const statusFilter = ref('')

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const [ps, ms, ss] = await Promise.all([listPurchases(statusFilter.value || undefined), listMaterials(), listSuppliers()])
    purchases.value = ps
    materials.value = ms
    suppliers.value = ss
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

const STATUS = { draft: '草稿', ordered: '已下单', received: '已入库', cancelled: '已取消' }
const factories = computed(() => suppliers.value.filter((s) => s.type === 'factory'))
const supplierName = (id) => suppliers.value.find((s) => s._id === id)?.name || id || '—'
const materialName = (id) => materials.value.find((m) => m._id === id)?.name || id
const fmtYuan = (fen) => '￥' + (Number(fen || 0) / 100).toFixed(2) // 分→元只在展示层
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—')

// ── 草稿表单（行编辑·单价输入用元·提交时一次转分）──
const emptyLine = () => ({ materialId: '', qty: 1, priceYuan: '' })
const form = ref({ purchaseId: '', supplierId: '', lines: [emptyLine()] })
const saving = ref(false)

function resetForm() {
  form.value = { purchaseId: '', supplierId: '', lines: [emptyLine()] }
}
function addLine() {
  form.value.lines.push(emptyLine())
}
function removeLine(i) {
  form.value.lines.splice(i, 1)
}
function editDraft(p) {
  form.value = {
    purchaseId: p._id,
    supplierId: p.supplierId,
    lines: (p.lines || []).map((l) => ({ materialId: l.materialId, qty: l.qty, priceYuan: (l.unitPriceFen / 100).toFixed(2) })),
  }
}
// 表单总价预览（元）；真 totalFen 云端算、不信这里
const previewYuan = computed(() =>
  form.value.lines.reduce((s, l) => s + (Number(l.qty) || 0) * Math.round(Number(l.priceYuan || 0) * 100), 0) / 100
)

async function submit() {
  const f = form.value
  if (!f.supplierId) return toast('请选供应商（厂家）', 'err')
  if (!f.lines.length || f.lines.some((l) => !l.materialId)) return toast('每行都要选物料', 'err')
  const lines = f.lines.map((l) => ({
    materialId: l.materialId,
    qty: Number(l.qty),
    unitPriceFen: Math.round(Number(l.priceYuan || 0) * 100), // 元→分只此一次（边界收口）
  }))
  saving.value = true
  try {
    await savePurchase({ purchaseId: f.purchaseId || undefined, supplierId: f.supplierId, lines })
    toast(f.purchaseId ? '草稿已修改' : '已建采购草稿')
    resetForm()
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    saving.value = false
  }
}

// ── 行内操作（下单/入库/取消·云端状态机把关·本页只发动作）──
async function doAction(p, kind) {
  const acts = {
    order: { fn: () => markPurchaseOrdered(p._id), confirm: `向「${supplierName(p.supplierId)}」下单 ${fmtYuan(p.totalFen)}？`, done: '已标记下单' },
    receive: { fn: () => receivePurchase(p._id), confirm: `确认到货？各行数量将入原料账（流水留痕）`, done: '已入库' },
    cancel: { fn: () => cancelPurchase(p._id), confirm: '取消这张采购单？', done: '已取消', danger: true },
  }
  const a = acts[kind]
  if (!(await confirmDialog({ title: '采购单 ' + p._id, message: a.confirm, danger: !!a.danger }))) return
  busy.value = p._id
  try {
    await a.fn()
    toast(a.done)
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>采购管理</h1>
        <p class="sub">厂家采购单 · 草稿→下单→到货入库（原料账+流水留痕·重复点入库不双记账）· 入库后不可取消 · 金额全链整数分</p>
      </div>
      <div class="head-ops">
        <select v-model="statusFilter" @change="init">
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="ordered">已下单</option>
          <option value="received">已入库</option>
          <option value="cancelled">已取消</option>
        </select>
        <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
      </div>
    </header>

    <p v-if="!cloudMode" class="hint warn">采购管理需云端模式（配置 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <Skeleton v-else-if="loading" class="card" :rows="6" />

    <template v-else>
      <!-- 采购单列表 -->
      <div class="card">
        <div class="row hrow">
          <span class="c-id">单号</span><span class="c-sup">供应商</span><span class="c-lines">行</span><span class="c-total">总额</span><span class="c-status">状态</span><span class="c-time">时间</span><span class="c-op">操作</span>
        </div>
        <p v-if="!purchases.length" class="hint inset">还没有采购单——在下方建草稿，确认后「下单」，到货点「入库」进原料账。</p>
        <div v-for="p in purchases" :key="p._id" class="row">
          <span class="c-id mono">{{ p._id }}</span>
          <span class="c-sup"><b>{{ supplierName(p.supplierId) }}</b></span>
          <span class="c-lines">
            <span v-for="l in p.lines" :key="l.materialId" class="line-tag">{{ materialName(l.materialId) }} ×{{ l.qty }}</span>
          </span>
          <span class="c-total"><b>{{ fmtYuan(p.totalFen) }}</b></span>
          <span class="c-status"><span class="chip" :class="p.status">{{ STATUS[p.status] || p.status }}</span></span>
          <span class="c-time">{{ fmtTime(p.updatedAt || p.createdAt) }}</span>
          <span class="c-op">
            <template v-if="p.status === 'draft'">
              <button class="btn ghost mini" @click="editDraft(p)">编辑</button>
              <button class="btn ghost mini" :disabled="busy === p._id" @click="doAction(p, 'order')">下单</button>
              <button class="btn ghost mini danger" :disabled="busy === p._id" @click="doAction(p, 'cancel')">取消</button>
            </template>
            <template v-else-if="p.status === 'ordered'">
              <button class="btn mini" :disabled="busy === p._id" @click="doAction(p, 'receive')">入库</button>
              <button class="btn ghost mini danger" :disabled="busy === p._id" @click="doAction(p, 'cancel')">取消</button>
            </template>
            <span v-else class="op-none">—</span>
          </span>
        </div>
      </div>

      <!-- 建/改草稿 -->
      <div class="card form">
        <h2>{{ form.purchaseId ? '编辑草稿 ' + form.purchaseId : '建采购草稿' }}</h2>
        <div class="frow">
          <label>供应商（厂家）
            <select v-model="form.supplierId">
              <option value="">请选择</option>
              <option v-for="s in factories" :key="s._id" :value="s._id">{{ s.name }}</option>
            </select>
          </label>
        </div>
        <div v-for="(l, i) in form.lines" :key="i" class="frow line-row">
          <label>物料
            <select v-model="l.materialId">
              <option value="">请选择</option>
              <option v-for="m in materials" :key="m._id" :value="m._id">{{ m.name }}（{{ m._id }}）</option>
            </select>
          </label>
          <label>数量（{{ materials.find((m) => m._id === l.materialId)?.uom === 'gram' ? '克' : '件' }}·正整数）
            <input v-model.number="l.qty" type="number" min="1" step="1" />
          </label>
          <label>单价（元）
            <input v-model="l.priceYuan" type="number" min="0" step="0.01" placeholder="如 3.50" />
          </label>
          <button class="btn ghost mini danger" :disabled="form.lines.length <= 1" title="删行" @click="removeLine(i)"><Trash2 :size="13" /></button>
        </div>
        <div class="frow">
          <button class="btn ghost mini" @click="addLine"><Plus :size="13" />加一行</button>
          <span class="total-preview">合计约 ￥{{ previewYuan.toFixed(2) }}（以云端核算为准）</span>
          <button class="btn" :disabled="saving" @click="submit">{{ form.purchaseId ? '保存修改' : '建草稿' }}</button>
          <button v-if="form.purchaseId" class="btn ghost" @click="resetForm">取消编辑</button>
        </div>
        <p class="hint inset">只有草稿可改；总价云端按行重算（不信页面）。同一物料请合并成一行（入库流水按「单据×物料」幂等）。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
.head-ops { display: flex; gap: 10px; align-items: center; }
.head-ops select { border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; color: var(--ink); background: var(--white); }
h1 { font-size: 22px; color: var(--ink); margin: 0 0 5px; }
h2 { font-size: 14px; color: var(--ink); margin: 0 0 12px; }
.sub { margin: 0; font-size: 12.5px; color: var(--content-2); }
.card { background: var(--white); border: 1px solid var(--line); border-radius: 13px; overflow: hidden; margin-bottom: 18px; }
.card.form { padding: 16px 18px; }
.row { display: flex; align-items: center; gap: 14px; padding: 12px 18px; font-size: 12.5px; }
.row + .row { border-top: 1px solid var(--line); }
.hrow { background: var(--bg-lilac); font-size: 11.5px; font-weight: 600; color: var(--content-2); }
.c-id { width: 150px; color: var(--content-2); overflow: hidden; text-overflow: ellipsis; }
.c-sup { width: 120px; color: var(--content); }
.c-sup b { color: var(--ink); }
.c-lines { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 5px; }
.line-tag { background: var(--bg-lilac); border: 1px solid var(--purple-line); border-radius: 6px; padding: 2px 7px; font-size: 11px; color: var(--content); }
.c-total { width: 92px; }
.c-total b { color: var(--ink); }
.c-status { width: 78px; }
.c-time { width: 128px; color: var(--content-2); font-size: 11.5px; }
.c-op { width: 172px; display: flex; gap: 6px; }
.op-none { color: var(--content-2); }
.mono { font-family: ui-monospace, monospace; font-size: 11.5px; }
.chip { padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.chip.draft { background: var(--bg-lilac); color: var(--purple-ink); }
.chip.ordered { background: #fdf6ec; color: #8a6420; }
.chip.received { background: #e8f3ec; color: #3f8c5e; }
.chip.cancelled { background: var(--bg); color: var(--content-2); }
.btn.mini { padding: 5px 12px; font-size: 11.5px; }
.btn.danger { color: var(--red); }
.frow { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 10px; }
.frow label { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: var(--content-2); }
.frow input, .frow select { border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; color: var(--ink); background: var(--white); min-width: 130px; }
.line-row { border-left: 2px solid var(--purple-line); padding-left: 10px; }
.total-preview { font-size: 12px; color: var(--content-2); flex: 1; }
.hint { padding: 10px 14px; border-radius: 10px; background: var(--bg-lilac); border: 1px solid var(--purple-line); font-size: 11.5px; }
.hint.inset { margin: 12px 18px; }
.hint.warn { border-color: #f0c8c5; background: #fdf0ef; color: var(--red); }
</style>
