<script setup lang="ts">
// 外协单（设计语言一致性·M3 UI 批17）：发织女大团原团 → 收同色带结团 → 应付=收×计件价·损耗=发−收 → 结算销账。
// 逻辑未动，仅套设计语言（页头/草稿卡/grid 表/状态 chip/收货卡/token）。
import { ref, onMounted, computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import { listOutworks, saveOutwork, issueOutwork, receiveOutwork, settleOutwork, cancelOutwork, listMaterials, listSuppliers } from '../api/scm'
import { materialHuman, outworkStatusLabel, yuanToFen, fenLabel, scmErrorText } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import { consumeOutworkHandoff } from '../lib/scmHandoff'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'
import UiButton from '../components/ui/Button.vue'

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
const recvOrder = ref<Record<string, any> | null>(null) // 当前收货单（取发料行/计件价·算预览与收≤发防呆）
const recvLines = ref<Array<{ materialId: string; qty: number }>>([])
const confirmKey = ref('')

// 收货引导预览（换皮退成裸表单·得手抄颜色/自己算应付损耗/收超发也不拦）
// 发的每个 raw 色 → 对应 knotted 同色的应收上限
const issuedByKnotted = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {}
  for (const l of recvOrder.value?.issueLines || []) {
    const m = String(l.materialId).match(/^yarn:([a-z0-9-]+):L:raw$/)
    if (m) map[`yarn:${m[1]}:L:knotted`] = (map[`yarn:${m[1]}:L:knotted`] || 0) + (Number(l.qty) || 0)
  }
  return map
})
const issuedTotal = computed(() => (recvOrder.value?.issueLines || []).reduce((s: number, l: Record<string, any>) => s + (Number(l.qty) || 0), 0))
const recvTotal = computed(() => recvLines.value.reduce((s, l) => s + (Number(l.qty) || 0), 0))
const recvRateFen = computed(() => Number(recvOrder.value?.pieceRateFen) || 0)
const previewPayableFen = computed(() => recvTotal.value * recvRateFen.value) // 应付=收×计件价
const previewLoss = computed(() => Math.max(0, issuedTotal.value - recvTotal.value)) // 损耗=发−收
function lineOver(l: { materialId: string; qty: number }): boolean {
  return !!l.materialId && (Number(l.qty) || 0) > (issuedByKnotted.value[l.materialId] ?? 0) // 收>发该色上限
}
const anyOver = computed(() => recvLines.value.some(lineOver)) // 任一色收超发→拦确认（后端也会拒·前端先防呆）

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
  recvOrder.value = o
  // 按发料色预填：发的 raw → 收同色 knotted·默认收满(=发量·收≤发)·省手抄颜色
  recvLines.value = (o.issueLines || [])
    .map((l: Record<string, any>) => {
      const m = String(l.materialId).match(/^yarn:([a-z0-9-]+):L:raw$/)
      return { materialId: m ? `yarn:${m[1]}:L:knotted` : '', qty: Number(l.qty) || 1 }
    })
    .filter((r: { materialId: string }) => r.materialId)
  if (!recvLines.value.length) recvLines.value = [{ materialId: '', qty: 1 }]
}
function cancelRecv() {
  recvFor.value = ''
  recvOrder.value = null
}

async function doRecv() {
  if (anyOver.value) {
    note(false, '', '有颜色收货数超过发出数（收 ≤ 发）——请核对')
    return
  }
  const r = await receiveOutwork(recvFor.value, recvLines.value.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })))
  note(r.ok, `已收货入库：应付 ${fenLabel(r.payableFen)} · 损耗 ${Number(r.lossQty) || 0} 团（已定格）`, scmErrorText(r.error))
  if (r.ok) cancelRecv()
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

onMounted(async () => {
  await reload()
  // 从备货计算器「去外协开单」带来的应发原团预填（一次性 consume）：新草稿 + 发料行（织女/计件价待填）
  const h = consumeOutworkHandoff()
  if (h && h.lines.length) {
    form.value = { outworkId: '', workerId: '', rateYuan: '', lines: h.lines.map((l) => ({ materialId: l.materialId, qty: l.qty })) }
    note(true, '已按备货缺口预填发料，选织女 + 填计件价后保存', '')
  }
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>外协单（发织女织带结）</h1>
        <p class="sub">发大团原团 → 收同色带结团 → 应付=收×计件价、损耗=发−收（收货一刻定格）→ 结算销账。</p>
      </div>
      <UiButton @click="newOrder"><Plus :size="15" :stroke-width="2" /><span>新建外协单</span></UiButton>
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
      <div class="thead"><span>单号</span><span>织女</span><span>发料</span><span class="r">计件价</span><span>应付/损耗</span><span>状态</span><span>建单时间</span><span class="r">操作</span></div>
      <div v-for="o in orders" :key="o._id" class="trow">
        <span class="mono">{{ o._id }}</span>
        <span>{{ (workers.find((w) => w._id === o.workerId) || {}).name || o.workerId }}</span>
        <div class="issue"><div v-for="l in o.issueLines || []" :key="l.materialId">{{ materialHuman(l.materialId) }} ×{{ l.qty }}</div></div>
        <span class="r">{{ fenLabel(o.pieceRateFen) }}/团</span>
        <span class="muted">{{ o.payableFen != null ? fenLabel(o.payableFen) + ' / 损 ' + (o.lossQty || 0) : '—' }}</span>
        <span><span class="state" :class="o.status">{{ outworkStatusLabel(o.status) }}</span></span>
        <span class="muted mono">{{ dateTime(o.createdAt) }}</span>
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
      <h2>收货 · <span class="mono">{{ recvFor }}</span>（已按发料色预填·收 ≤ 发）</h2>
      <div v-for="(l, i) in recvLines" :key="i" class="linerow recv-row" :class="{ over: lineOver(l) }">
        <select v-model="l.materialId">
          <option value="">选带结团…</option>
          <option v-for="m in knottedL" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}</option>
        </select>
        <input v-model.number="l.qty" type="number" min="1" placeholder="团数" />
        <span class="cap">上限 {{ issuedByKnotted[l.materialId] ?? 0 }}{{ lineOver(l) ? ' · 超发！' : '' }}</span>
        <button class="act ghost" @click="recvLines.splice(i, 1)">删行</button>
      </div>
      <div class="recv-preview">
        <span>发出 <strong>{{ issuedTotal }}</strong> 团</span>
        <span>收 <strong>{{ recvTotal }}</strong> 团</span>
        <span>应付预览 <strong class="pay">{{ fenLabel(previewPayableFen) }}</strong></span>
        <span>损耗 <strong :class="{ loss: previewLoss > 0 }">{{ previewLoss }}</strong> 团</span>
      </div>
      <div class="ops">
        <button class="act ghost" @click="recvLines.push({ materialId: '', qty: 1 })"><Plus :size="13" :stroke-width="2" /><span>加色</span></button>
        <button class="act primary" :disabled="anyOver" @click="doRecv">确认收货（定格应付与损耗）</button>
        <button class="act ghost" @click="cancelRecv">取消</button>
      </div>
      <p class="hint">带结团要先在物料页建档；应付/损耗按实际收货数一刻定格，结算不重算（上方为预览）。</p>
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
.recv-row {
  grid-template-columns: 2fr 90px auto auto;
  align-items: center;
}
.cap {
  font-size: 11.5px;
  color: var(--ld-content-2);
  white-space: nowrap;
}
.recv-row.over .cap {
  color: var(--ld-red);
  font-weight: 600;
}
.recv-row.over input {
  border-color: var(--ld-red-line);
  background: var(--ld-bg-red-soft);
}
.recv-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 6px 0 10px;
  padding: 10px 12px;
  background: var(--ld-bg-lilac);
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.recv-preview strong {
  color: var(--ld-ink);
  font-size: 14px;
}
.recv-preview .pay {
  color: var(--ld-brand-active);
}
.recv-preview .loss {
  color: var(--ld-amber);
}
.ops {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.act:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  grid-template-columns: 1.2fr 1fr 1.3fr 0.8fr 1.1fr 0.8fr 1fr 1.3fr;
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
