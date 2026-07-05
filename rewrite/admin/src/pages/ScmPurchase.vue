<script setup lang="ts">
// 采购单（M3 批7）：草稿→已下单→已收货（收货首次流转入库·重复收货不双入）；总价服务端算。
import { ref, onMounted } from 'vue'
import { listPurchases, savePurchase, markOrdered, receivePurchase, cancelPurchase, listMaterials, listSuppliers } from '../api/scm'
import { materialHuman, purchaseStatusLabel, yuanToFen, fenLabel, scmErrorText } from '../lib/mapScm'
import { dateTime } from '../lib/format'

const orders = ref<Array<Record<string, any>>>([])
const mats = ref<Array<Record<string, any>>>([])
const sups = ref<Array<Record<string, any>>>([])
const message = ref('')
const form = ref<{ supplierId: string; lines: Array<{ materialId: string; qty: number; priceYuan: string }> } | null>(null)
const confirmKey = ref('')

async function reload() {
  const [p, m, s] = await Promise.all([listPurchases(), listMaterials(), listSuppliers()])
  orders.value = p.ok ? (p.list as Record<string, any>[]) : []
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  sups.value = s.ok ? ((s.list as Record<string, any>[]) || []).filter((x) => x.type === 'factory') : []
  message.value = p.ok ? '' : '加载失败：' + String(p.error || '')
}

function newOrder() {
  form.value = { supplierId: '', lines: [{ materialId: '', qty: 1, priceYuan: '' }] }
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
  const r = await savePurchase(f.supplierId, lines)
  message.value = r.ok ? `草稿已建（总价 ${fenLabel(r.totalFen)}·服务端核算）` : scmErrorText(r.error)
  if (r.ok) form.value = null
  void reload()
}

async function step(fn: (id: string) => Promise<Record<string, unknown>>, id: string, key: string) {
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
  <div>
    <h2>采购单（向厂家）</h2>
    <div class="topbar">
      <button class="act" @click="newOrder">+ 新建采购单</button>
      <span v-if="message" class="status">{{ message }}</span>
    </div>

    <div v-if="form" class="panel">
      <select v-model="form.supplierId">
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
        <button class="act ghost" @click="form.lines.push({ materialId: '', qty: 1, priceYuan: '' })">+ 加行</button>
        <button class="act" @click="doSave">保存草稿</button>
        <button class="act ghost" @click="form = null">取消</button>
      </div>
    </div>

    <table v-if="orders.length">
      <thead><tr><th>单号</th><th>供应商</th><th>行数</th><th>总价</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="o in orders" :key="o._id">
          <td class="mono">{{ o._id }}</td>
          <td>{{ (sups.find((s) => s._id === o.supplierId) || {}).name || o.supplierId }}</td>
          <td>{{ (o.lines || []).length }}</td>
          <td>{{ fenLabel(o.totalFen) }}</td>
          <td>{{ purchaseStatusLabel(o.status) }}</td>
          <td>{{ dateTime(o.createdAt) }}</td>
          <td>
            <button v-if="o.status === 'draft'" class="act" @click="step(markOrdered, o._id, 'ord:' + o._id)">标记已下单</button>
            <button v-if="o.status === 'ordered'" class="act" @click="step(receivePurchase, o._id, 'recv:' + o._id)">
              {{ confirmKey === 'recv:' + o._id ? '确认到货入库？' : '收货入库' }}
            </button>
            <button v-if="o.status === 'draft' || o.status === 'ordered'" class="act warn" @click="step(cancelPurchase, o._id, 'cancel:' + o._id)">
              {{ confirmKey === 'cancel:' + o._id ? '确认取消？' : '取消' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hint">还没有采购单</p>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
.topbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.hint {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.panel {
  padding: 14px 16px;
  margin-bottom: 12px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 720px;
}
select,
input {
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 8px;
}
.linerow {
  display: grid;
  grid-template-columns: 2fr 90px 110px auto;
  gap: 8px;
}
.ops {
  display: flex;
  gap: 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  overflow: hidden;
}
th,
td {
  padding: 9px 11px;
  font-size: 13px;
  text-align: left;
  border-bottom: 1px solid var(--ld-bg-faint);
}
th {
  background: var(--ld-bg-lilac);
  color: var(--ld-purple-meta);
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.act {
  padding: 5px 13px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  margin-right: 4px;
}
.act.ghost {
  background: transparent;
  color: var(--ld-purple-meta);
  border: 1px solid var(--ld-purple-line);
}
.act.warn {
  background: var(--ld-red);
}
</style>
