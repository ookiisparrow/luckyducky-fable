<script setup lang="ts">
// 采购单（设计语言一致性·M3 UI 批16）：草稿→已下单→已收货（收货首次流转入库·重复收货不双入）；总价服务端算。
// 逻辑未动，仅套设计语言（页头/草稿表单卡/grid 表/token）。
import { ref, onMounted } from 'vue'
import { Plus } from 'lucide-vue-next'
import { listPurchases, savePurchase, markOrdered, receivePurchase, cancelPurchase, listMaterials, listSuppliers } from '../api/scm'
import { materialHuman, purchaseStatusLabel, yuanToFen, fenLabel, scmErrorText } from '../lib/mapScm'
import { dateTime } from '../lib/format'

const orders = ref<Array<Record<string, any>>>([])
const mats = ref<Array<Record<string, any>>>([])
const sups = ref<Array<Record<string, any>>>([])
const message = ref('')
const form = ref<{ purchaseId?: string; supplierId: string; lines: Array<{ materialId: string; qty: number; priceYuan: string }> } | null>(null)
const confirmKey = ref('')

async function reload() {
  const [p, m, s] = await Promise.all([listPurchases(), listMaterials(), listSuppliers()])
  orders.value = p.ok ? (p.list as Record<string, any>[]) : []
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  sups.value = s.ok ? ((s.list as Record<string, any>[]) || []).filter((x) => x.type === 'factory') : []
  message.value = p.ok ? '' : '加载失败：' + String(p.error || '')
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
      message.value = '单价不合法（元·最多两位小数）'
      return
    }
    lines.push({ materialId: l.materialId, qty: Number(l.qty), unitPriceFen: fen })
  }
  const r = await savePurchase(f.supplierId, lines, f.purchaseId || undefined) // 传 purchaseId＝改草稿·空＝新建
  message.value = r.ok ? `草稿已${f.purchaseId ? '更新' : '建'}（总价 ${fenLabel(r.totalFen)}·服务端核算）` : scmErrorText(r.error)
  if (r.ok) form.value = null
  void reload()
}

async function step(fn: (_id: string) => Promise<Record<string, unknown>>, id: string, key: string) {
  if (key.startsWith('recv') || key.startsWith('cancel')) {
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

onMounted(reload)
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

    <p v-if="message" class="status">{{ message }}</p>

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
        <button class="act ghost" @click="form.lines.splice(i, 1)">删行</button>
      </div>
      <div class="ops">
        <button class="act ghost" @click="form.lines.push({ materialId: '', qty: 1, priceYuan: '' })"><Plus :size="13" :stroke-width="2" /><span>加行</span></button>
        <button class="act primary" @click="doSave">保存草稿</button>
        <button class="act ghost" @click="form = null">取消</button>
      </div>
    </section>

    <div v-if="orders.length" class="table">
      <div class="thead"><span>单号</span><span>供应商</span><span class="r">行数</span><span class="r">总价</span><span>状态</span><span>时间</span><span class="r">操作</span></div>
      <div v-for="o in orders" :key="o._id" class="trow">
        <span class="mono">{{ o._id }}</span>
        <span>{{ (sups.find((s) => s._id === o.supplierId) || {}).name || o.supplierId }}</span>
        <span class="r">{{ (o.lines || []).length }}</span>
        <span class="r strong">{{ fenLabel(o.totalFen) }}</span>
        <span><span class="state" :class="o.status">{{ purchaseStatusLabel(o.status) }}</span></span>
        <span class="muted">{{ dateTime(o.createdAt) }}</span>
        <div class="c-ops r">
          <button v-if="o.status === 'draft'" class="act ghost" @click="editDraft(o)">编辑</button>
          <button v-if="o.status === 'draft'" class="act primary" @click="step(markOrdered, o._id, 'ord:' + o._id)">标记已下单</button>
          <button v-if="o.status === 'ordered'" class="act primary" @click="step(receivePurchase, o._id, 'recv:' + o._id)">
            {{ confirmKey === 'recv:' + o._id ? '确认到货入库？' : '收货入库' }}
          </button>
          <button v-if="o.status === 'draft' || o.status === 'ordered'" class="act warn" @click="step(cancelPurchase, o._id, 'cancel:' + o._id)">
            {{ confirmKey === 'cancel:' + o._id ? '确认取消？' : '取消' }}
          </button>
        </div>
      </div>
    </div>
    <p v-else-if="!form" class="status-soft">还没有采购单</p>
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
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
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
  grid-template-columns: 2fr 90px 120px auto;
  gap: 8px;
  margin-bottom: 8px;
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
