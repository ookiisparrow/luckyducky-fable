<script setup lang="ts">
// 物料与供应商（设计语言一致性·M3 UI 批16）：主档（毛线按 色×档×形态 推导料号·计量建档锁死）+ 供应商/织女
// + 库存调整（必留原因·扣超整单拒）+ 流水查账。逻辑未动，仅套设计语言（页头/表单卡/grid 表/token）。
import { ref, computed, onMounted, watch } from 'vue'
import { listMaterials, saveMaterial, listSuppliers, saveSupplier, adjustStock, listLedger } from '../api/scm'
import { materialHuman, materialCategoryLabel, uomLabel, scmErrorText, mapLedger, type LedgerRow } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'
import UiButton from '../components/ui/Button.vue'

const mats = ref<Array<Record<string, any>>>([])
const sups = ref<Array<Record<string, any>>>([])
const ledger = ref<LedgerRow[]>([])
const ledgerMat = ref('') // 当前流水按哪个料号过滤（空=全部·换皮丢了行内按料查流水）
const message = ref('')
const msgOk = ref(false) // 换皮 .status 恒红→成功信息显红 bug·区分成功(绿)/失败(红)
function note(ok: boolean, okText: string, errText: string) {
  message.value = ok ? okText : errText
  msgOk.value = ok
}

// 行内按料号查流水（换皮只有全局最近流水·listLedger 支持 materialId 过滤）
async function loadLedger(materialId?: string) {
  const l = await listLedger(materialId)
  ledger.value = l.ok ? mapLedger(l.list) : []
  ledgerMat.value = materialId || ''
}

const matForm = ref({ category: 'yarn', name: '', uom: 'count', color: '', tier: 'L', form: 'raw', productId: '', slug: '', supplierId: '', threshold: 0 })
const supForm = ref({ supplierId: '', name: '', type: 'factory', contact: '', note: '' })
const adj = ref({ materialId: '', delta: 0, reason: '' })
const adjustId = ref('') // 本次调整意图的幂等键（生成一次·重试复用·成功才换新·根因#4·同 runAssembly B1）
const adjustBusy = ref(false)

// 主档按 类别→料号 排序（换皮丢了排序·长表乱序不好扫）
const sortedMats = computed(() =>
  [...mats.value].sort((a, b) => (a.category === b.category ? String(a._id).localeCompare(String(b._id)) : String(a.category || '').localeCompare(String(b.category || ''))))
)

// 改调整表单即换新幂等键（不同意图·不复用旧 id 被后端当重复拒）；毛线越档带结在模板 v-if 前置拦
watch(adj, () => (adjustId.value = ''), { deep: true })

// 毛线按团/件计（换皮 uom 选择对毛线仍开放·毛线只能 count·按克会污染三档槽语义）：category=yarn 强制 count
watch(() => matForm.value.category, (c) => {
  if (c === 'yarn') matForm.value.uom = 'count'
})
// 编辑既有供应商（换皮丢·填完只能新建·后端 saveSupplier 收 supplierId 支持改+note）：点列表回填
function editSupplier(s: Record<string, any>) {
  supForm.value = { supplierId: String(s._id || ''), name: String(s.name || ''), type: String(s.type || 'factory'), contact: String(s.contact || ''), note: String(s.note || '') }
}
function resetSupForm() {
  supForm.value = { supplierId: '', name: '', type: 'factory', contact: '', note: '' }
}

async function reload() {
  const [m, s] = await Promise.all([listMaterials(), listSuppliers()])
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  sups.value = s.ok ? (s.list as Record<string, any>[]) : []
  await loadLedger(ledgerMat.value || undefined) // 保持当前料号筛选
  note(m.ok, '', '加载失败：' + String(m.error || ''))
}

async function doSaveMaterial() {
  const r = await saveMaterial({ ...matForm.value })
  note(r.ok, `已建档：${String(r.materialId)}`, scmErrorText(r.error))
  void reload()
}

async function doSaveSupplier() {
  const r = await saveSupplier({ ...supForm.value })
  note(r.ok, supForm.value.supplierId ? '供应商已更新' : '供应商已保存', scmErrorText(r.error))
  if (r.ok) resetSupForm()
  void reload()
}

async function doAdjust() {
  if (adjustBusy.value) return // 在途禁再发（防快速双击·换皮无此闸）
  if (!adjustId.value) adjustId.value = 'adm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) // 本意图生成一次
  adjustBusy.value = true
  const r = await adjustStock(adj.value.materialId, Number(adj.value.delta), adj.value.reason.trim(), adjustId.value)
  adjustBusy.value = false
  note(r.ok, '已调整并留流水', scmErrorText(r.error))
  if (r.ok) {
    adjustId.value = '' // 成功才换新（下次全新意图·重试期间复用同 id→后端 docId 幂等挡双调）
    adj.value = { materialId: '', delta: 0, reason: '' }
  }
  void reload()
}

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>物料与供应商</h1>
      <p class="sub">物料主档（毛线料号按 色×档×形态 推导·计量建档后锁死）+ 供应商/织女 + 库存调整（必留原因）。</p>
    </header>

    <ScmFlowTabs />
    <p v-if="message" class="status" :class="{ ok: msgOk }">{{ message }}</p>

    <div class="cols">
      <section class="card">
        <h2>建物料档</h2>
        <select v-model="matForm.category">
          <option value="yarn">毛线</option>
          <option value="packaging">包装（挂产品）</option>
          <option value="card">卡片（挂产品）</option>
          <option value="accessory">辅料</option>
        </select>
        <input v-model="matForm.name" placeholder="名称" maxlength="60" />
        <select v-model="matForm.uom" :disabled="matForm.category === 'yarn'" :title="matForm.category === 'yarn' ? '毛线按团/件计·锁定' : ''"><option value="count">按件</option><option value="gram">按克</option></select>
        <template v-if="matForm.category === 'yarn'">
          <input v-model="matForm.color" placeholder="颜色（小写英文如 pink）" />
          <select v-model="matForm.tier"><option value="L">大团</option><option value="M">中团</option><option value="S">小团</option></select>
          <select v-model="matForm.form"><option value="raw">原团</option><option v-if="matForm.tier === 'L'" value="knotted">带结（仅大团）</option></select>
        </template>
        <input v-else-if="matForm.category !== 'accessory'" v-model="matForm.productId" placeholder="所属产品 id" />
        <input v-else v-model="matForm.slug" placeholder="辅料名（小写英文）" />
        <select v-model="matForm.supplierId">
          <option value="">（不挂供应商）</option>
          <option v-for="s in sups" :key="s._id" :value="s._id">{{ s.name }}</option>
        </select>
        <input v-model.number="matForm.threshold" type="number" min="0" placeholder="安全库存阈值（低于报警·0=不报警）" />
        <UiButton @click="doSaveMaterial">建档 / 更新</UiButton>
        <p class="hint">计量方式建档后锁死；毛线料号按 颜色×档位×形态 自动生成。安全库存阈值＝低于此值列表标红报警（B4：换皮漏了这个输入·恒 0 致低库存告警失效）。</p>
      </section>

      <section class="card">
        <h2>供应商 / 织女 <span v-if="supForm.supplierId" class="edit-tag">编辑中</span></h2>
        <input v-model="supForm.name" placeholder="名称" maxlength="60" />
        <select v-model="supForm.type"><option value="factory">厂家（可下采购单）</option><option value="outworker">织女（走外协单）</option></select>
        <input v-model="supForm.contact" placeholder="联系方式" maxlength="120" />
        <input v-model="supForm.note" placeholder="备注（如结算周期/擅长款·可空）" maxlength="200" />
        <div class="ops">
          <UiButton @click="doSaveSupplier">{{ supForm.supplierId ? '更新' : '保存' }}</UiButton>
          <button v-if="supForm.supplierId" class="btn-ghost" @click="resetSupForm">取消编辑</button>
        </div>
        <div class="sup-list">
          <div v-for="s in sups" :key="s._id" class="sup-line" :class="{ on: supForm.supplierId === s._id }" title="点击编辑" @click="editSupplier(s)">
            <span class="sup-name">{{ s.name }}<span v-if="s.note" class="sup-note">· {{ s.note }}</span></span>
            <span class="tag">{{ s.type === 'factory' ? '厂家' : '织女' }}</span>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>库存调整（必留原因）</h2>
        <select v-model="adj.materialId">
          <option value="">选料号…</option>
          <option v-for="m in mats" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}（现 {{ m.stock }}）</option>
        </select>
        <input v-model.number="adj.delta" type="number" placeholder="±整数（克/件）" />
        <input v-model="adj.reason" placeholder="原因（如 期初盘点）" maxlength="200" />
        <UiButton :disabled="adjustBusy" @click="doAdjust">{{ adjustBusy ? '调整中…' : '调整' }}</UiButton>
      </section>
    </div>

    <section class="table-card">
      <h2>物料主档（{{ mats.length }}）</h2>
      <div class="table">
        <div class="thead thead-mat"><span>料号</span><span>名称</span><span>类别</span><span>计量</span><span class="r">库存</span><span>供应商</span></div>
        <div v-for="m in sortedMats" :key="m._id" class="trow trow-mat">
          <div><div class="human">{{ materialHuman(m._id) }}</div><div class="mono">{{ m._id }}</div></div>
          <span>{{ m.name }}</span>
          <span class="muted">{{ materialCategoryLabel(m.category) }}</span>
          <span class="muted">{{ uomLabel(m.uom) }}</span>
          <span class="r" :class="{ low: m.threshold && m.stock <= m.threshold }">{{ m.stock }}<em v-if="m.threshold && m.stock <= m.threshold" class="low-tag"> · 低于 {{ m.threshold }}</em></span>
          <span class="muted sup-cell">
            {{ (sups.find((s) => s._id === m.supplierId) || {}).name || '—' }}
            <button class="led-btn" title="看这个料的流水" @click="loadLedger(m._id)">流水</button>
          </span>
        </div>
      </div>
    </section>

    <section class="table-card">
      <h2>
        {{ ledgerMat ? '流水 · ' + materialHuman(ledgerMat) : '最近流水（全部料）' }}
        <button v-if="ledgerMat" class="led-reset" @click="loadLedger()">← 看全部</button>
      </h2>
      <div class="table">
        <div class="thead thead-led"><span>时间</span><span>类型</span><span>料</span><span class="r">±</span><span>操作者</span><span>原因</span></div>
        <div v-for="l in ledger" :key="l.id" class="trow trow-led">
          <span class="muted mono">{{ dateTime(l.at) }}</span>
          <span>{{ l.docType }}</span>
          <span>{{ l.material }}</span>
          <span class="r" :class="l.delta > 0 ? 'pos' : 'neg'">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</span>
          <span class="muted">{{ l.operator }}</span>
          <span class="muted">{{ l.reason || '—' }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 1160px;
}
.page-head {
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
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
  margin-bottom: 16px;
}
@media (max-width: 900px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
.card,
.table-card {
  padding: 16px 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.table-card {
  margin-bottom: 14px;
}
h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
.led-reset {
  margin-left: 10px;
  padding: 3px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 11px;
  font-weight: 400;
  cursor: pointer;
}
.sup-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.led-btn {
  flex: none;
  padding: 2px 9px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-brand-active);
  font-size: 10.5px;
  cursor: pointer;
}
.card input,
.card select {
  display: block;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
  background: var(--ld-bg);
}
.ops {
  display: flex;
  gap: 8px;
}
.btn-ghost {
  padding: 8px 16px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.edit-tag {
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
  font-size: 10.5px;
  font-weight: 600;
}
.hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--ld-content-2);
}
.sup-list {
  margin-top: 10px;
}
.sup-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
  color: var(--ld-content);
  cursor: pointer;
  border-radius: 6px;
}
.sup-line:hover {
  background: var(--ld-bg-lilac);
}
.sup-line.on {
  background: var(--ld-bg-lilac);
}
.sup-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sup-note {
  color: var(--ld-content-2);
  font-size: 11.5px;
}
.tag {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
  font-size: 11px;
}
.table {
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}
.thead-mat,
.trow-mat {
  grid-template-columns: 1.5fr 1.2fr 0.8fr 0.7fr 0.9fr 1.2fr;
}
.low-tag {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 400;
}
.thead-led,
.trow-led {
  grid-template-columns: 1.4fr 0.9fr 1.2fr 0.7fr 1fr 1.4fr;
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
.human {
  color: var(--ld-ink);
  font-weight: 600;
}
.mono {
  font-family: var(--ld-font-mono);
  font-size: 11px;
  color: var(--ld-content-2);
}
.muted {
  color: var(--ld-content-2);
}
.low {
  color: var(--ld-red);
  font-weight: 700;
}
.pos {
  color: var(--ld-green);
  font-weight: 600;
}
.neg {
  color: var(--ld-red);
  font-weight: 600;
}
</style>
