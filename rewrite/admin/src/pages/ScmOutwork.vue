<script setup lang="ts">
// 外协单（设计语言一致性·M3 UI 批17）：发织女大团原团 → 收同色带结团 → 应付=收×计件价·损耗=发−收 → 结算销账。
// 逻辑未动，仅套设计语言（页头/草稿卡/grid 表/状态 chip/收货卡/token）。
import { ref, onMounted, computed } from 'vue'
import { Plus, ClipboardList } from 'lucide-vue-next'
import { listOutworks, saveOutwork, issueOutwork, receiveOutwork, settleOutwork, cancelOutwork, listMaterials, listSuppliers } from '../api/scm'
import { materialHuman, outworkStatusLabel, yuanToFen, fenLabel, scmErrorText } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import { consumeOutworkHandoff } from '../lib/scmHandoff'
import { useLoadStatus } from '../lib/status'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const orders = ref<Array<Record<string, any>>>([])
const rawL = ref<Array<Record<string, any>>>([]) // 大团原团（可发）
const knottedL = ref<Array<Record<string, any>>>([]) // 大团带结（可收）
const workers = ref<Array<Record<string, any>>>([])
const cursor = ref<unknown>(null) // B1（根因#7）：外协单列表翻页游标
const hasMore = ref(false)
// 动作反馈(note)/加载态(load) 收口（病根#14）：reload 成功不再抹掉动作刚设的成功/失败原文。
const { message, ok: msgOk, note, load } = useLoadStatus()
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
  confirmKey.value = '' // 刷新即复位危险态（P1·防旧武装的发料/结算/取消按钮跨刷新残留一击直发·批3 规格）
  const [o, m, s] = await Promise.all([listOutworks(), listMaterials(), listSuppliers()])
  orders.value = o.ok ? (o.list as Record<string, any>[]) : []
  cursor.value = o.ok ? o.nextCursor : null
  hasMore.value = !!(o.ok && o.hasMore)
  const all = m.ok ? (m.list as Record<string, any>[]) : []
  rawL.value = all.filter((x) => /^yarn:[a-z0-9-]+:L:raw$/.test(String(x._id)))
  knottedL.value = all.filter((x) => /^yarn:[a-z0-9-]+:L:knotted$/.test(String(x._id)))
  workers.value = s.ok ? ((s.list as Record<string, any>[]) || []).filter((x) => x.type === 'outworker') : []
  load(o.ok, '加载失败：' + String(o.error || '')) // 只在加载失败时写·成功静默不抹动作反馈
}

// 加载更多（B1·根因#7）：续游标追加·去重防双击重复追加同一页
async function more() {
  if (!hasMore.value || cursor.value == null) return
  const r = await listOutworks(undefined, { cursor: cursor.value })
  if (!r.ok) {
    note(false, '', '加载更多失败：' + scmErrorText(r.error))
    return
  }
  const seen = new Set(orders.value.map((o) => o._id))
  orders.value = [...orders.value, ...(((r.list as Record<string, any>[]) || []).filter((o) => !seen.has(o._id)))]
  cursor.value = r.nextCursor
  hasMore.value = !!r.hasMore
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

const saving = ref(false) // 建单在途锁（P2·防双击建两张重复外协草稿·后端建单无 id 幂等）
async function doSave() {
  const f = form.value
  if (!f || saving.value) return
  const snap = f // 快照本次编辑目标（H1·同批G G3/G4 范式·同文件 doRecv 已有 forId 快照参照）：editDraft 无 saving 门控，
  // await 期间若已切到另一张草稿/新建，回包收尾效果不该打过去
  const fen = yuanToFen(f.rateYuan)
  if (fen === null) {
    note(false, '', '计件单价不合法（元·最多两位小数·可为 0）')
    return
  }
  saving.value = true
  const r = await saveOutwork(f.workerId, fen, f.lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })), f.outworkId || undefined)
  saving.value = false
  if (form.value === snap) {
    note(r.ok, `外协草稿已${f.outworkId ? '更新' : '建'}`, scmErrorText(r.error))
    if (r.ok) form.value = null
  }
  void reload() // 列表刷新与目标是否已切无关·恒执行
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
  const forId = recvFor.value // 快照发起时的收货目标（G3·P2）：await 期间若已切到另一张收货表单，回包的
  // 反馈/清理不该打到新表单上（同 Desk act() 治法）
  const r = await receiveOutwork(recvFor.value, recvLines.value.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })))
  if (recvFor.value === forId) {
    note(r.ok, `已收货入库：应付 ${fenLabel(r.payableFen)} · 损耗 ${Number(r.lossQty) || 0} 团（已定格）`, scmErrorText(r.error))
    if (r.ok) cancelRecv()
  }
  void reload() // 列表刷新无条件执行，不受目标是否过期影响
}

async function step(fn: (_id: string) => Promise<Record<string, unknown>>, id: string, key: string) {
  if (confirmKey.value !== key) {
    confirmKey.value = key
    return
  }
  confirmKey.value = ''
  const r = (await fn(id)) as Record<string, any>
  note(r.ok, '', scmErrorText(r.error)) // 失败走 note 设 msgOk=false（红）·换皮只写 message 致失败显成功绿
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
  <div class="ld-page">
    <PageHeader title="外协单" sub="发大团原团 → 收同色带结团 → 应付=收×计件价、损耗=发−收（收货一刻定格）→ 结算销账。">
      <UiButton @click="newOrder"><Plus :size="15" :stroke-width="2" /><span>新建外协单</span></UiButton>
    </PageHeader>

    <ScmFlowTabs />
    <p v-if="message" class="ld-status" :class="msgOk ? 'is-ok' : 'is-err'">{{ message }}</p>

    <Card v-if="form" :title="form.outworkId ? '编辑外协草稿' : '新建外协草稿'">
      <select v-model="form.workerId" class="field">
        <option value="">选织女…</option>
        <option v-for="w in workers" :key="w._id" :value="w._id">{{ w.name }}</option>
      </select>
      <input v-model="form.rateYuan" placeholder="计件单价（元/团·可 0）" class="field" />
      <div v-for="(l, i) in form.lines" :key="i" class="linerow">
        <select v-model="l.materialId">
          <option value="">选大团原团…</option>
          <option v-for="m in rawL" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}（存 {{ m.stock }}）</option>
        </select>
        <input v-model.number="l.qty" type="number" min="1" placeholder="团数" />
        <UiButton variant="ghost" size="sm" @click="form.lines.splice(i, 1)">删行</UiButton>
      </div>
      <div class="ops">
        <UiButton variant="ghost" size="sm" @click="form.lines.push({ materialId: '', qty: 1 })"><Plus :size="13" :stroke-width="2" /><span>加色</span></UiButton>
        <UiButton size="sm" @click="doSave">保存草稿</UiButton>
        <UiButton variant="ghost" size="sm" @click="form = null">取消</UiButton>
      </div>
    </Card>

    <div v-if="orders.length" class="ld-table">
      <div class="ld-thead">
        <div class="ld-th grow">单号</div>
        <div class="ld-th" :style="{ width: '120px' }">织女</div>
        <div class="ld-th" :style="{ width: '190px' }">发料</div>
        <div class="ld-th cell-r" :style="{ width: '92px' }">计件价</div>
        <div class="ld-th" :style="{ width: '150px' }">应付/损耗</div>
        <div class="ld-th" :style="{ width: '92px' }">状态</div>
        <div class="ld-th" :style="{ width: '150px' }">建单时间</div>
        <div class="ld-th ops-cell" :style="{ width: '220px' }">操作</div>
      </div>
      <div class="ld-tbody">
        <div v-for="o in orders" :key="o._id" class="ld-tr">
          <div class="ld-td grow"><span class="mono">{{ o._id }}</span></div>
          <div class="ld-td" :style="{ width: '120px' }">{{ (workers.find((w) => w._id === o.workerId) || {}).name || o.workerId }}</div>
          <div class="ld-td" :style="{ width: '190px' }">
            <div class="issue"><span v-for="l in o.issueLines || []" :key="l.materialId">{{ materialHuman(l.materialId) }} ×{{ l.qty }}</span></div>
          </div>
          <div class="ld-td cell-r" :style="{ width: '92px' }">{{ fenLabel(o.pieceRateFen) }}/团</div>
          <div class="ld-td muted" :style="{ width: '150px' }">{{ o.payableFen != null ? fenLabel(o.payableFen) + ' / 损 ' + (o.lossQty || 0) : '—' }}</div>
          <div class="ld-td" :style="{ width: '92px' }">
            <Badge :tone="o.status === 'settled' ? 'green' : o.status === 'issued' ? 'amber' : 'brand'">{{ outworkStatusLabel(o.status) }}</Badge>
          </div>
          <div class="ld-td muted mono" :style="{ width: '150px' }">{{ dateTime(o.createdAt) }}</div>
          <div class="ld-td ops-cell" :style="{ width: '220px' }">
            <UiButton v-if="o.status === 'draft'" variant="ghost" size="sm" @click="editDraft(o)">编辑</UiButton>
            <UiButton v-if="o.status === 'draft'" size="sm" @click="step(issueOutwork, o._id, 'iss:' + o._id)">
              {{ confirmKey === 'iss:' + o._id ? '确认发料出库？' : '发料' }}
            </UiButton>
            <UiButton v-if="o.status === 'issued'" size="sm" @click="startRecv(o)">收货</UiButton>
            <UiButton v-if="o.status === 'delivered'" size="sm" @click="step(settleOutwork, o._id, 'set:' + o._id)">
              {{ confirmKey === 'set:' + o._id ? '确认工钱已付？' : '结算销账' }}
            </UiButton>
            <UiButton v-if="o.status === 'draft'" variant="danger" size="sm" @click="step(cancelOutwork, o._id, 'can:' + o._id)">
              {{ confirmKey === 'can:' + o._id ? '确认取消？' : '取消' }}
            </UiButton>
          </div>
        </div>
      </div>
      <div v-if="hasMore" class="tbl-foot">
        <span>已加载 {{ orders.length }} 单</span>
        <UiButton variant="ghost" size="sm" @click="more">加载更多</UiButton>
      </div>
    </div>
    <EmptyState v-else-if="!form" :icon="ClipboardList" text="还没有外协单" />

    <Card v-if="recvFor" title="收货登记" :sub="recvFor + ' · 已按发料色预填 · 收 ≤ 发'">
      <div v-for="(l, i) in recvLines" :key="i" class="recv-row" :class="{ over: lineOver(l) }">
        <select v-model="l.materialId">
          <option value="">选带结团…</option>
          <option v-for="m in knottedL" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}</option>
        </select>
        <input v-model.number="l.qty" type="number" min="1" placeholder="团数" />
        <span class="cap">上限 {{ issuedByKnotted[l.materialId] ?? 0 }}{{ lineOver(l) ? ' · 超发！' : '' }}</span>
        <UiButton variant="ghost" size="sm" @click="recvLines.splice(i, 1)">删行</UiButton>
      </div>
      <div class="recv-preview">
        <span>发出 <strong>{{ issuedTotal }}</strong> 团</span>
        <span>收 <strong>{{ recvTotal }}</strong> 团</span>
        <span>应付预览 <strong class="pay">{{ fenLabel(previewPayableFen) }}</strong></span>
        <span>损耗 <strong :class="{ loss: previewLoss > 0 }">{{ previewLoss }}</strong> 团</span>
      </div>
      <div class="ops">
        <UiButton variant="ghost" size="sm" @click="recvLines.push({ materialId: '', qty: 1 })"><Plus :size="13" :stroke-width="2" /><span>加色</span></UiButton>
        <UiButton size="sm" :disabled="anyOver" @click="doRecv">确认收货（定格应付与损耗）</UiButton>
        <UiButton variant="ghost" size="sm" @click="cancelRecv">取消</UiButton>
      </div>
      <p class="recv-hint">带结团要先在物料页建档；应付/损耗按实际收货数一刻定格，结算不重算（上方为预览）。</p>
    </Card>
  </div>
</template>

<style scoped>
/* 状态提示行（成功绿/失败红·覆盖 .ld-status 的灰） */
.is-ok {
  color: var(--ld-green);
}
.is-err {
  color: var(--ld-red);
}

/* 草稿/收货表单：整宽字段 + 多列料行（本页独有的表单语言·kit 无表单原语） */
.field {
  display: block;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-family: inherit;
  font-size: 13px;
  color: var(--ld-content);
  background: var(--ld-bg);
  box-sizing: border-box;
}
.linerow {
  display: grid;
  grid-template-columns: 2fr 100px auto;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}
.linerow select,
.linerow input,
.recv-row select,
.recv-row input {
  padding: 8px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-family: inherit;
  font-size: 13px;
  color: var(--ld-content);
  background: var(--ld-bg);
}
.ops {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
}

/* 收货逐色行 + 超发防护（收 > 该色发出上限即红框/红字·anyOver 拦确认） */
.recv-row {
  display: grid;
  grid-template-columns: 2fr 100px auto auto;
  gap: 8px;
  margin-bottom: 8px;
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
  margin: 10px 0;
  padding: 10px 12px;
  background: var(--ld-bg-lilac);
  border-radius: var(--ld-radius-sm);
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
.recv-hint {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--ld-content-2);
}

/* 表格单元辅助（发料多色竖排 / 单号等宽字 / 右对齐列 / 操作区靠右换行） */
.issue {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--ld-content);
}
.mono {
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
  color: var(--ld-ink);
}
.muted {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.cell-r {
  justify-content: flex-end;
  text-align: right;
}
.ops-cell {
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

/* 翻页页脚（B1·根因#7·同 Orders.vue 范式） */
.tbl-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--ld-line);
  font-size: 12px;
  color: var(--ld-content-2);
}
</style>
