<script setup>
/**
 * 外协加工（进销存车道 B·蓝图 docs/进销存ERP/ §4B）。业务定稿：织女把起手结做在最大团毛线上——
 * 发最大团原团（按色）→ 收同色带结团入库 → 损耗=发−收可见 → 计件工钱应付（收回数×单价）→ 结算销账。
 * 出入库/状态全在云端收口（门1 applyStockMoves + 门2 transition·scm.spec 声明流转）；本页只编排。
 * 金额纪律：单价按「元」填、提交边界一次转整数「分」；应付展示再分转元（元只在展示层·根因#4）。
 */
import { ref, computed } from 'vue'
import { cloudMode, listOutworks, saveOutwork, issueOutwork, receiveOutwork, settleOutwork, cancelOutwork, listSuppliers, listMaterials } from '@/api/cloud.js'
import { confirmDialog, toast } from '@/utils/ui.js'
import { consumeOutworkHandoff } from '@/store/scmHandoff.js'
import { RefreshCw, Plus, X } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import ScmFlowTabs from '@/components/ScmFlowTabs.vue'

const loading = ref(true)
const loadErr = ref('')
const orders = ref([])
const suppliers = ref([])
const materials = ref([])
const busy = ref('')

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const [os, ss, ms] = await Promise.all([listOutworks(), listSuppliers(), listMaterials()])
    orders.value = os
    suppliers.value = ss
    materials.value = ms
    applyHandoff()
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

const STATUS = {
  draft: { label: '草稿', chip: 'gray' },
  issued: { label: '已发料', chip: 'warn' },
  delivered: { label: '已收货', chip: 'blue' },
  settled: { label: '已结算', chip: 'green' },
  cancelled: { label: '已取消', chip: 'gray' },
}
const outworkers = computed(() => suppliers.value.filter((s) => s.type === 'outworker'))
// 发料只可选最大团原团（业务定稿·后端同样校验）
const L_RAW = /^yarn:([a-z][a-z0-9-]*):L:raw$/
const lRawMaterials = computed(() => materials.value.filter((m) => L_RAW.test(m._id)))
const workerName = (id) => suppliers.value.find((s) => s._id === id)?.name || id || '—'
const colorOf = (materialId) => String(materialId).split(':')[1] || materialId
const yuan = (fen) => (Number.isInteger(fen) ? (fen / 100).toFixed(2) : '—')
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—')
const linesBrief = (lines) => (lines || []).map((l) => `${colorOf(l.materialId)} ×${l.qty}`).join('、')

// ── 建/改草稿（织女下拉 + 发料行编辑 + 计件单价元→分边界一次）──
const blankForm = () => ({ outworkId: '', workerId: '', rateYuan: '', lines: [{ materialId: '', qty: 1 }] })
const form = ref(blankForm())
const saving = ref(false)
const addLine = () => form.value.lines.push({ materialId: '', qty: 1 })
const removeLine = (i) => form.value.lines.splice(i, 1)
function editDraft(o) {
  form.value = {
    outworkId: o._id,
    workerId: o.workerId,
    rateYuan: (o.pieceRateFen / 100).toFixed(2),
    lines: (o.issueLines || []).map((l) => ({ ...l })),
  }
}
// 备货计算器带过来的缺口（去开单按钮）：预填发料行，织女/计件单价缺口算不出来、留空待人工补
function applyHandoff() {
  const h = consumeOutworkHandoff()
  if (!h) return
  form.value = { outworkId: '', workerId: '', rateYuan: '', lines: h.lines.map((l) => ({ ...l })) }
  toast('已带入备货缺口，请选织女、填计件单价后建草稿')
}
async function submitForm() {
  const f = form.value
  if (!f.workerId) return toast('请选择织女', 'err')
  const rate = Math.round(Number(f.rateYuan) * 100) // 元→分（边界一次·后端只收整数分）
  if (!Number.isFinite(rate) || rate < 0) return toast('计件单价请填非负金额（元）', 'err')
  const lines = f.lines.filter((l) => l.materialId)
  if (!lines.length) return toast('请至少加一行发料（最大团原团）', 'err')
  for (const l of lines) {
    if (!Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0) return toast('团数必须是正整数', 'err')
  }
  saving.value = true
  try {
    await saveOutwork({
      outworkId: f.outworkId,
      workerId: f.workerId,
      pieceRateFen: rate,
      issueLines: lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })),
    })
    toast(f.outworkId ? '草稿已更新' : '外协草稿已建')
    form.value = blankForm()
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    saving.value = false
  }
}

// ── 行内操作：发料 / 结算 / 取消 ──
async function doIssue(o) {
  const ok = await confirmDialog({
    title: '发料出库',
    message: `发给 ${workerName(o.workerId)}：${linesBrief(o.issueLines)}（原团出库·库存立即扣账）？`,
    confirmText: '发料',
  })
  if (!ok) return
  busy.value = o._id
  try {
    await issueOutwork(o._id)
    toast('已发料出库')
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    busy.value = ''
  }
}
async function doSettle(o) {
  const ok = await confirmDialog({
    title: '结算销账',
    message: `确认已付清 ${workerName(o.workerId)} 工钱 ¥${yuan(o.payableFen)}？`,
    confirmText: '已付清',
  })
  if (!ok) return
  busy.value = o._id
  try {
    await settleOutwork(o._id)
    toast('已结算销账')
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    busy.value = ''
  }
}
async function doCancel(o) {
  const ok = await confirmDialog({ title: '取消外协单', message: '仅草稿可取消（已发料的异常走物料页调整单）。确认取消？', danger: true })
  if (!ok) return
  busy.value = o._id
  try {
    await cancelOutwork(o._id)
    toast('已取消')
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    busy.value = ''
  }
}

// ── 收货弹层（按色填收回数·预览应付/损耗）──
const recv = ref(null) // { order, rows: [{ color, issuedQty, qty }] }
function openReceive(o) {
  recv.value = {
    order: o,
    rows: (o.issueLines || []).map((l) => ({ color: colorOf(l.materialId), issuedQty: l.qty, qty: l.qty })),
  }
}
const recvReceived = computed(() => (recv.value ? recv.value.rows.reduce((s, r) => s + (Number(r.qty) || 0), 0) : 0))
const recvIssued = computed(() => (recv.value ? recv.value.rows.reduce((s, r) => s + r.issuedQty, 0) : 0))
const recvPayableFen = computed(() => (recv.value ? recvReceived.value * recv.value.order.pieceRateFen : 0))
const recvSaving = ref(false)
async function submitReceive() {
  const r = recv.value
  for (const row of r.rows) {
    const q = Number(row.qty)
    if (!Number.isInteger(q) || q < 0) return toast('收回团数必须是非负整数', 'err')
    if (q > row.issuedQty) return toast(`「${row.color}」收回数不能超过发出数 ${row.issuedQty}`, 'err')
  }
  // 0 收回的颜色不入行（后端只收正整数行）；全 0＝没货可收，走物料页调整单对账
  const receiveLines = r.rows.filter((row) => Number(row.qty) > 0).map((row) => ({ materialId: `yarn:${row.color}:L:knotted`, qty: Number(row.qty) }))
  if (!receiveLines.length) return toast('至少收回 1 团；织女整单丢失请取消收货、走物料页调整单', 'err')
  recvSaving.value = true
  try {
    const res = await receiveOutwork(r.order._id, receiveLines)
    toast(`已入带结账 · 应付 ¥${yuan(res.payableFen)} · 损耗 ${res.lossQty} 团`)
    recv.value = null
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    recvSaving.value = false
  }
}
</script>

<template>
  <div>
    <ScmFlowTabs />
    <header class="head">
      <div>
        <h1>外协加工</h1>
        <p class="sub">发最大团原团 → 织女做起手结 → 收带结团入库 · 损耗=发−收 · 计件工钱（收回数×单价）· 结算销账</p>
      </div>
      <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">外协管理需云端模式（配置 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <Skeleton v-else-if="loading" class="card" :rows="6" />

    <template v-else>
      <!-- 外协单列表 -->
      <div class="card">
        <div class="row hrow">
          <span class="c-worker">织女</span><span class="c-status">状态</span><span class="c-lines">发料（原团）</span><span class="c-rate">计件单价</span><span class="c-pay">应付 / 损耗</span><span class="c-time">时间</span><span class="c-op">操作</span>
        </div>
        <p v-if="!orders.length" class="hint inset">还没有外协单——先在下方建草稿（选织女、按颜色填发出的最大团数、填计件单价）。</p>
        <div v-for="o in orders" :key="o._id" class="row">
          <span class="c-worker"><b>{{ workerName(o.workerId) }}</b></span>
          <span class="c-status"><span class="chip" :class="STATUS[o.status]?.chip">{{ STATUS[o.status]?.label || o.status }}</span></span>
          <span class="c-lines">{{ linesBrief(o.issueLines) }}</span>
          <span class="c-rate">¥{{ yuan(o.pieceRateFen) }}/团</span>
          <span class="c-pay">
            <template v-if="o.status === 'delivered' || o.status === 'settled'">
              <b>¥{{ yuan(o.payableFen) }}</b> · 损耗 {{ o.lossQty }} 团
            </template>
            <template v-else>—</template>
          </span>
          <span class="c-time">{{ fmtTime(o.createdAt) }}</span>
          <span class="c-op">
            <template v-if="o.status === 'draft'">
              <button class="btn mini" :disabled="busy === o._id" @click="doIssue(o)">发料</button>
              <button class="btn ghost mini" @click="editDraft(o)">编辑</button>
              <button class="btn ghost mini" :disabled="busy === o._id" @click="doCancel(o)">取消</button>
            </template>
            <button v-else-if="o.status === 'issued'" class="btn mini" @click="openReceive(o)">收货</button>
            <button v-else-if="o.status === 'delivered'" class="btn mini" :disabled="busy === o._id" @click="doSettle(o)">结算</button>
            <template v-else>—</template>
          </span>
        </div>
      </div>

      <!-- 建/改草稿 -->
      <div class="card form">
        <h2>{{ form.outworkId ? '编辑外协草稿' : '建外协草稿' }}</h2>
        <div class="frow">
          <label>织女
            <select v-model="form.workerId">
              <option value="">（选织女）</option>
              <option v-for="w in outworkers" :key="w._id" :value="w._id">{{ w.name }}</option>
            </select>
          </label>
          <label>计件单价（元/团） <input v-model="form.rateYuan" type="number" min="0" step="0.01" placeholder="如 7.00" /></label>
        </div>
        <div v-for="(l, i) in form.lines" :key="i" class="frow line">
          <label>最大团原团（按色）
            <select v-model="l.materialId">
              <option value="">（选料号）</option>
              <option v-for="m in lRawMaterials" :key="m._id" :value="m._id">{{ m.name }}（{{ m._id }} · 存 {{ m.stock ?? 0 }}）</option>
            </select>
          </label>
          <label>发出团数 <input v-model.number="l.qty" type="number" min="1" step="1" /></label>
          <button v-if="form.lines.length > 1" class="btn ghost mini" title="删行" @click="removeLine(i)"><X :size="13" /></button>
        </div>
        <div class="frow">
          <button class="btn ghost mini" @click="addLine"><Plus :size="13" />加一色</button>
          <button class="btn" :disabled="saving" @click="submitForm">{{ form.outworkId ? '保存修改' : '建草稿' }}</button>
          <button v-if="form.outworkId" class="btn ghost" @click="form = blankForm()">取消编辑</button>
        </div>
        <p class="hint inset">没有织女可选？先到「物料与供应商」建织女档（类型选织女）、建各色最大团原团/带结团料号。发料时原团出库扣账；收货时带结团入库并定格应付与损耗。</p>
      </div>
    </template>

    <!-- 收货弹层：按色填收回数 -->
    <div v-if="recv" class="drawer-mask" @click="recvSaving ? null : (recv = null)">
      <aside class="drawer" @click.stop>
        <div class="d-head">
          <span class="d-title">收货 · {{ workerName(recv.order.workerId) }}</span>
          <button class="x" :disabled="recvSaving" @click="recv = null">×</button>
        </div>
        <p class="hint">收回的是<b>带结团</b>（同色入带结账）；收回数不能超过发出数，差额记损耗。</p>
        <div v-for="row in recv.rows" :key="row.color" class="rrow">
          <span class="r-color">{{ row.color }}</span>
          <span class="r-issued">发 {{ row.issuedQty }} 团</span>
          <label class="r-input">收回 <input v-model.number="row.qty" type="number" min="0" step="1" :max="row.issuedQty" /> 团</label>
        </div>
        <div class="r-sum">
          <span>应付：<b>¥{{ yuan(recvPayableFen) }}</b>（{{ recvReceived }} 团 × ¥{{ yuan(recv.order.pieceRateFen) }}）</span>
          <span>损耗：<b>{{ recvIssued - recvReceived }}</b> 团</span>
        </div>
        <div class="frow">
          <button class="btn" :disabled="recvSaving" @click="submitReceive">确认收货入账</button>
          <button class="btn ghost" :disabled="recvSaving" @click="recv = null">取消</button>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
h1 { font-size: 22px; color: var(--ink); margin: 0 0 5px; }
h2 { font-size: 14px; color: var(--ink); margin: 0 0 12px; }
.sub { margin: 0; font-size: 12.5px; color: var(--content-2); }
.card { background: var(--white); border: 1px solid var(--line); border-radius: 13px; overflow: hidden; margin-bottom: 18px; }
.card.form { padding: 16px 18px; }
.row { display: flex; align-items: center; gap: 14px; padding: 12px 18px; font-size: 12.5px; }
.row + .row { border-top: 1px solid var(--line); }
.hrow { background: var(--bg-lilac); font-size: 11.5px; font-weight: 600; color: var(--content-2); }
.c-worker { width: 110px; color: var(--ink); }
.c-status { width: 76px; }
.c-lines { flex: 1; min-width: 0; color: var(--content); }
.c-rate { width: 92px; color: var(--content-2); }
.c-pay { width: 170px; color: var(--content-2); }
.c-pay b { color: var(--ink); }
.c-time { width: 130px; color: var(--content-2); font-size: 11.5px; }
.c-op { width: 168px; display: flex; gap: 6px; }
.chip { padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.chip.green { background: #e8f3ec; color: #3f8c5e; }
.chip.warn { background: #fdf6ec; color: #8a6420; }
.chip.blue { background: #e9f0fb; color: #3763a8; }
.chip.gray { background: var(--bg-lilac); color: var(--content-2); }
.btn.mini { padding: 5px 12px; font-size: 11.5px; }
.frow { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 10px; }
.frow.line { margin-bottom: 6px; }
.frow label { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: var(--content-2); }
.frow input, .frow select { border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; color: var(--ink); background: var(--white); min-width: 130px; }
.hint { padding: 10px 14px; border-radius: 10px; background: var(--bg-lilac); border: 1px solid var(--purple-line); font-size: 11.5px; }
.hint.inset { margin: 12px 0 0; }
.hint.warn { border-color: #f0c8c5; background: #fdf0ef; color: var(--red); }
.card > .hint.inset { margin: 12px 18px; }
/* 收货弹层（沿用 Orders.vue drawer 形状） */
.drawer-mask { position: fixed; inset: 0; background: rgba(30, 22, 54, 0.32); display: flex; justify-content: flex-end; z-index: 50; }
.drawer { width: 420px; max-width: 92vw; background: var(--white); height: 100%; padding: 20px 22px; overflow-y: auto; box-shadow: -8px 0 28px rgba(30, 22, 54, 0.12); }
.d-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.d-title { font-size: 15px; font-weight: 700; color: var(--ink); }
.x { border: none; background: none; font-size: 20px; color: var(--content-2); cursor: pointer; }
.rrow { display: flex; align-items: center; gap: 14px; padding: 10px 2px; border-bottom: 1px solid var(--line); font-size: 12.5px; }
.r-color { width: 90px; font-weight: 600; color: var(--ink); }
.r-issued { width: 80px; color: var(--content-2); }
.r-input { display: flex; align-items: center; gap: 6px; color: var(--content-2); }
.r-input input { width: 76px; border: 1px solid var(--line-strong); border-radius: 8px; padding: 6px 9px; font-size: 12.5px; }
.r-sum { display: flex; gap: 18px; padding: 12px 2px; font-size: 12.5px; color: var(--content-2); }
.r-sum b { color: var(--ink); }
</style>
