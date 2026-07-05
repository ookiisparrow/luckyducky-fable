<script setup lang="ts">
// 外协单（M3 批7）：发织女大团原团 → 收同色带结团 → 应付=收×计件价·损耗=发−收 → 结算销账。
import { ref, onMounted } from 'vue'
import { listOutworks, saveOutwork, issueOutwork, receiveOutwork, settleOutwork, cancelOutwork, listMaterials, listSuppliers } from '../api/scm'
import { materialHuman, outworkStatusLabel, yuanToFen, fenLabel, scmErrorText } from '../lib/mapScm'
import { dateTime } from '../lib/format'

const orders = ref<Array<Record<string, any>>>([])
const rawL = ref<Array<Record<string, any>>>([]) // 大团原团（可发）
const knottedL = ref<Array<Record<string, any>>>([]) // 大团带结（可收）
const workers = ref<Array<Record<string, any>>>([])
const message = ref('')
const form = ref<{ workerId: string; rateYuan: string; lines: Array<{ materialId: string; qty: number }> } | null>(null)
const recvFor = ref('')
const recvLines = ref<Array<{ materialId: string; qty: number }>>([])
const confirmKey = ref('')

async function reload() {
  const [o, m, s] = await Promise.all([listOutworks(), listMaterials(), listSuppliers()])
  orders.value = o.ok ? (o.list as Record<string, any>[]) : []
  const all = m.ok ? (m.list as Record<string, any>[]) : []
  rawL.value = all.filter((x) => /^yarn:[a-z0-9-]+:L:raw$/.test(String(x._id)))
  knottedL.value = all.filter((x) => /^yarn:[a-z0-9-]+:L:knotted$/.test(String(x._id)))
  workers.value = s.ok ? ((s.list as Record<string, any>[]) || []).filter((x) => x.type === 'outworker') : []
  message.value = o.ok ? '' : '加载失败：' + String(o.error || '')
}

function newOrder() {
  form.value = { workerId: '', rateYuan: '', lines: [{ materialId: '', qty: 1 }] }
}

async function doSave() {
  const f = form.value
  if (!f) return
  const fen = yuanToFen(f.rateYuan)
  if (fen === null) {
    message.value = '计件单价不合法（元·最多两位小数·可为 0）'
    return
  }
  const r = await saveOutwork(f.workerId, fen, f.lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })))
  message.value = r.ok ? '外协草稿已建' : scmErrorText(r.error)
  if (r.ok) form.value = null
  void reload()
}

function startRecv(o: Record<string, any>) {
  recvFor.value = String(o._id)
  recvLines.value = [{ materialId: '', qty: 1 }]
}

async function doRecv() {
  const r = await receiveOutwork(recvFor.value, recvLines.value.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })))
  message.value = r.ok ? `已收货入库：应付 ${fenLabel(r.payableFen)} · 损耗 ${Number(r.lossQty) || 0} 团（已定格）` : scmErrorText(r.error)
  if (r.ok) recvFor.value = ''
  void reload()
}

async function step(fn: (id: string) => Promise<Record<string, unknown>>, id: string, key: string) {
  if (confirmKey.value !== key) {
    confirmKey.value = key
    return
  }
  confirmKey.value = ''
  const r = (await fn(id)) as Record<string, any>
  message.value = r.ok ? '' : scmErrorText(r.error)
  void reload()
}

onMounted(reload)
</script>

<template>
  <div>
    <h2>外协单（发织女织带结）</h2>
    <div class="topbar">
      <button class="act" @click="newOrder">+ 新建外协单</button>
      <span v-if="message" class="status">{{ message }}</span>
    </div>

    <div v-if="form" class="panel">
      <select v-model="form.workerId">
        <option value="">选织女…</option>
        <option v-for="w in workers" :key="w._id" :value="w._id">{{ w.name }}</option>
      </select>
      <input v-model="form.rateYuan" placeholder="计件单价（元/团·可 0）" />
      <div v-for="(l, i) in form.lines" :key="i" class="linerow">
        <select v-model="l.materialId">
          <option value="">选大团原团…</option>
          <option v-for="m in rawL" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}（存 {{ m.stock }}）</option>
        </select>
        <input v-model.number="l.qty" type="number" min="1" placeholder="团数" />
        <button class="act ghost" @click="form.lines.splice(i, 1)">删行</button>
      </div>
      <div class="ops">
        <button class="act ghost" @click="form.lines.push({ materialId: '', qty: 1 })">+ 加色</button>
        <button class="act" @click="doSave">保存草稿</button>
        <button class="act ghost" @click="form = null">取消</button>
      </div>
    </div>

    <table v-if="orders.length">
      <thead><tr><th>单号</th><th>织女</th><th>发料</th><th>计件价</th><th>应付/损耗</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="o in orders" :key="o._id">
          <td class="mono">{{ o._id }}</td>
          <td>{{ (workers.find((w) => w._id === o.workerId) || {}).name || o.workerId }}</td>
          <td><div v-for="l in o.issueLines || []" :key="l.materialId">{{ materialHuman(l.materialId) }} ×{{ l.qty }}</div></td>
          <td>{{ fenLabel(o.pieceRateFen) }}/团</td>
          <td>{{ o.payableFen != null ? fenLabel(o.payableFen) + ' / 损 ' + (o.lossQty || 0) : '—' }}</td>
          <td>{{ outworkStatusLabel(o.status) }}</td>
          <td>{{ dateTime(o.createdAt) }}</td>
          <td>
            <button v-if="o.status === 'draft'" class="act" @click="step(issueOutwork, o._id, 'iss:' + o._id)">
              {{ confirmKey === 'iss:' + o._id ? '确认发料出库？' : '发料' }}
            </button>
            <button v-if="o.status === 'issued'" class="act" @click="startRecv(o)">收货</button>
            <button v-if="o.status === 'delivered'" class="act" @click="step(settleOutwork, o._id, 'set:' + o._id)">
              {{ confirmKey === 'set:' + o._id ? '确认工钱已付？' : '结算销账' }}
            </button>
            <button v-if="o.status === 'draft'" class="act warn" @click="step(cancelOutwork, o._id, 'can:' + o._id)">
              {{ confirmKey === 'can:' + o._id ? '确认取消？' : '取消' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hint">还没有外协单</p>

    <div v-if="recvFor" class="panel">
      <h3>收货 · {{ recvFor }}（只能收发过颜色的大团带结·收≤发）</h3>
      <div v-for="(l, i) in recvLines" :key="i" class="linerow">
        <select v-model="l.materialId">
          <option value="">选带结团…</option>
          <option v-for="m in knottedL" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}</option>
        </select>
        <input v-model.number="l.qty" type="number" min="1" placeholder="团数" />
        <button class="act ghost" @click="recvLines.splice(i, 1)">删行</button>
      </div>
      <div class="ops">
        <button class="act ghost" @click="recvLines.push({ materialId: '', qty: 1 })">+ 加色</button>
        <button class="act" @click="doRecv">确认收货（定格应付与损耗）</button>
        <button class="act ghost" @click="recvFor = ''">取消</button>
      </div>
      <p class="hint">带结团要先在物料页建档；收货那一刻应付与损耗一次定格，结算不重算。</p>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
h3 {
  margin: 0 0 10px;
  font-size: 13px;
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
  font-size: 12px;
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
  grid-template-columns: 2fr 90px auto;
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
  margin-bottom: 4px;
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
