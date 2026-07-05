<script setup lang="ts">
// 外协单（设计语言一致性·M3 UI 批17）：发织女大团原团 → 收同色带结团 → 应付=收×计件价·损耗=发−收 → 结算销账。
// 逻辑未动，仅套设计语言（页头/草稿卡/grid 表/状态 chip/收货卡/token）。
import { ref, onMounted } from 'vue'
import { Plus } from 'lucide-vue-next'
import { listOutworks, saveOutwork, issueOutwork, receiveOutwork, settleOutwork, cancelOutwork, listMaterials, listSuppliers } from '../api/scm'
import { materialHuman, outworkStatusLabel, yuanToFen, fenLabel, scmErrorText } from '../lib/mapScm'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'

const orders = ref<Array<Record<string, any>>>([])
const rawL = ref<Array<Record<string, any>>>([]) // 大团原团（可发）
const knottedL = ref<Array<Record<string, any>>>([]) // 大团带结（可收）
const workers = ref<Array<Record<string, any>>>([])
const message = ref('')
const msgOk = ref(false) // 换皮 .status 恒红→成功信息显红 bug·区分成功(绿)/失败(红)
function note(ok: boolean, okText: string, errText: string) {
  message.value = ok ? okText : errText
  msgOk.value = ok
}
const form = ref<{ outworkId?: string; workerId: string; rateYuan: string; lines: Array<{ materialId: string; qty: number }> } | null>(null)
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
  note(o.ok, '', '加载失败：' + String(o.error || ''))
}

function newOrder() {
  form.value = { outworkId: '', workerId: '', rateYuan: '', lines: [{ materialId: '', qty: 1 }] }
}
// 草稿编辑（换皮丢·外协草稿建完只能取消重建·后端 saveOutwork 收 outworkId 支持改）：预填
function editDraft(o: Record<string, any>) {
  form.value = {
    outworkId: String(o._id || ''),
    workerId: String(o.workerId || ''),
    rateYuan: o.pieceRateFen != null ? (Number(o.pieceRateFen) / 100).toFixed(2) : '',
    lines: ((o.issueLines as Record<string, any>[]) || []).map((l) => ({ materialId: String(l.materialId || ''), qty: Number(l.qty) || 1 })),
  }
  if (!form.value.lines.length) form.value.lines.push({ materialId: '', qty: 1 })
}

async function doSave() {
  const f = form.value
  if (!f) return
  const fen = yuanToFen(f.rateYuan)
  if (fen === null) {
    note(false, '', '计件单价不合法（元·最多两位小数·可为 0）')
    return
  }
  const r = await saveOutwork(f.workerId, fen, f.lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })), f.outworkId || undefined)
  note(r.ok, `外协草稿已${f.outworkId ? '更新' : '建'}`, scmErrorText(r.error))
  if (r.ok) form.value = null
  void reload()
}

function startRecv(o: Record<string, any>) {
  recvFor.value = String(o._id)
  recvLines.value = [{ materialId: '', qty: 1 }]
}

async function doRecv() {
  const r = await receiveOutwork(recvFor.value, recvLines.value.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })))
  note(r.ok, `已收货入库：应付 ${fenLabel(r.payableFen)} · 损耗 ${Number(r.lossQty) || 0} 团（已定格）`, scmErrorText(r.error))
  if (r.ok) recvFor.value = ''
  void reload()
}

async function step(fn: (_id: string) => Promise<Record<string, unknown>>, id: string, key: string) {
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
  <div class="page">
    <header class="page-head">
      <div>
        <h1>外协单（发织女织带结）</h1>
        <p class="sub">发大团原团 → 收同色带结团 → 应付=收×计件价、损耗=发−收（收货一刻定格）→ 结算销账。</p>
      </div>
      <button class="btn-primary" @click="newOrder"><Plus :size="15" :stroke-width="2" /><span>新建外协单</span></button>
    </header>

    <ScmFlowTabs />
    <p v-if="message" class="status" :class="{ ok: msgOk }">{{ message }}</p>

    <section v-if="form" class="draft">
      <select v-model="form.workerId" class="full">
        <option value="">选织女…</option>
        <option v-for="w in workers" :key="w._id" :value="w._id">{{ w.name }}</option>
      </select>
      <input v-model="form.rateYuan" placeholder="计件单价（元/团·可 0）" class="full" />
      <div v-for="(l, i) in form.lines" :key="i" class="linerow">
        <select v-model="l.materialId">
          <option value="">选大团原团…</option>
          <option v-for="m in rawL" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}（存 {{ m.stock }}）</option>
        </select>
        <input v-model.number="l.qty" type="number" min="1" placeholder="团数" />
        <button class="act ghost" @click="form.lines.splice(i, 1)">删行</button>
      </div>
      <div class="ops">
        <button class="act ghost" @click="form.lines.push({ materialId: '', qty: 1 })"><Plus :size="13" :stroke-width="2" /><span>加色</span></button>
        <button class="act primary" @click="doSave">保存草稿</button>
        <button class="act ghost" @click="form = null">取消</button>
      </div>
    </section>

    <div v-if="orders.length" class="table">
      <div class="thead"><span>单号</span><span>织女</span><span>发料</span><span class="r">计件价</span><span>应付/损耗</span><span>状态</span><span class="r">操作</span></div>
      <div v-for="o in orders" :key="o._id" class="trow">
        <span class="mono">{{ o._id }}</span>
        <span>{{ (workers.find((w) => w._id === o.workerId) || {}).name || o.workerId }}</span>
        <div class="issue"><div v-for="l in o.issueLines || []" :key="l.materialId">{{ materialHuman(l.materialId) }} ×{{ l.qty }}</div></div>
        <span class="r">{{ fenLabel(o.pieceRateFen) }}/团</span>
        <span class="muted">{{ o.payableFen != null ? fenLabel(o.payableFen) + ' / 损 ' + (o.lossQty || 0) : '—' }}</span>
        <span><span class="state" :class="o.status">{{ outworkStatusLabel(o.status) }}</span></span>
        <div class="c-ops r">
          <button v-if="o.status === 'draft'" class="act ghost" @click="editDraft(o)">编辑</button>
          <button v-if="o.status === 'draft'" class="act primary" @click="step(issueOutwork, o._id, 'iss:' + o._id)">
            {{ confirmKey === 'iss:' + o._id ? '确认发料出库？' : '发料' }}
          </button>
          <button v-if="o.status === 'issued'" class="act primary" @click="startRecv(o)">收货</button>
          <button v-if="o.status === 'delivered'" class="act primary" @click="step(settleOutwork, o._id, 'set:' + o._id)">
            {{ confirmKey === 'set:' + o._id ? '确认工钱已付？' : '结算销账' }}
          </button>
          <button v-if="o.status === 'draft'" class="act warn" @click="step(cancelOutwork, o._id, 'can:' + o._id)">
            {{ confirmKey === 'can:' + o._id ? '确认取消？' : '取消' }}
          </button>
        </div>
      </div>
    </div>
    <p v-else-if="!form" class="status-soft">还没有外协单</p>

    <section v-if="recvFor" class="draft recv">
      <h2>收货 · <span class="mono">{{ recvFor }}</span>（只能收发过颜色的大团带结·收 ≤ 发）</h2>
      <div v-for="(l, i) in recvLines" :key="i" class="linerow">
        <select v-model="l.materialId">
          <option value="">选带结团…</option>
          <option v-for="m in knottedL" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}</option>
        </select>
        <input v-model.number="l.qty" type="number" min="1" placeholder="团数" />
        <button class="act ghost" @click="recvLines.splice(i, 1)">删行</button>
      </div>
      <div class="ops">
        <button class="act ghost" @click="recvLines.push({ materialId: '', qty: 1 })"><Plus :size="13" :stroke-width="2" /><span>加色</span></button>
        <button class="act primary" @click="doRecv">确认收货（定格应付与损耗）</button>
        <button class="act ghost" @click="recvFor = ''">取消</button>
      </div>
      <p class="hint">带结团要先在物料页建档；收货那一刻应付与损耗一次定格，结算不重算。</p>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 1140px;
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
.draft {
  padding: 16px 18px;
  margin-bottom: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  max-width: 760px;
}
.recv h2 {
  margin: 0 0 12px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ld-ink);
}
.full {
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
  grid-template-columns: 2fr 90px auto;
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
.hint {
  margin: 10px 0 0;
  font-size: 11.5px;
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
  grid-template-columns: 1.3fr 1.1fr 1.4fr 0.9fr 1.2fr 0.9fr 1.4fr;
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
.issue {
  font-size: 12px;
  color: var(--ld-content);
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
.state.issued {
  background: var(--ld-bg-lilac);
  color: var(--ld-amber);
}
.state.delivered {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.state.settled {
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
