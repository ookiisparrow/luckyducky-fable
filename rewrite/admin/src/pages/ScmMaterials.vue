<script setup lang="ts">
// 物料与供应商（设计语言一致性·M3 UI 批16）：主档（毛线按 色×档×形态 推导料号·计量建档锁死）+ 供应商/织女
// + 库存调整（必留原因·扣超整单拒）+ 流水查账。逻辑未动，仅套设计语言（页头/表单卡/grid 表/token）。
import { ref, computed, onMounted, watch } from 'vue'
import { listMaterials, saveMaterial, listSuppliers, saveSupplier, adjustStock, listLedger } from '../api/scm'
import { materialHuman, materialCategoryLabel, uomLabel, scmErrorText, mapLedger, type LedgerRow } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import { useLoadStatus } from '../lib/status'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { Boxes, Factory, TriangleAlert, ScrollText } from 'lucide-vue-next'

const mats = ref<Array<Record<string, any>>>([])
const sups = ref<Array<Record<string, any>>>([])
const ledger = ref<LedgerRow[]>([])
const ledgerMat = ref('') // 当前流水按哪个料号过滤（空=全部·换皮丢了行内按料查流水）
// 动作反馈(note)/加载态(load) 收口（病根#14）：reload 成功不再抹掉动作刚设的成功/失败原文。
const { message, ok: msgOk, note, load } = useLoadStatus()

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
const supBusy = ref(false) // 供应商建档在途锁（P2·防双击建重复供应商）

// 主档按 类别→料号 排序（换皮丢了排序·长表乱序不好扫）
const sortedMats = computed(() =>
  [...mats.value].sort((a, b) => (a.category === b.category ? String(a._id).localeCompare(String(b._id)) : String(a.category || '').localeCompare(String(b.category || ''))))
)

// 低库存料数（纯展示派生·把已有 threshold 报警逻辑汇到 KPI·不新增数据源、不编指标）
const lowStockCount = computed(() => mats.value.filter((m) => m.threshold && m.stock <= m.threshold).length)

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
  load(m.ok, '加载失败：' + String(m.error || '')) // 只在加载失败时写·成功静默不抹动作反馈
}

async function doSaveMaterial() {
  const r = await saveMaterial({ ...matForm.value })
  note(r.ok, `已建档：${String(r.materialId)}`, scmErrorText(r.error))
  void reload()
}

async function doSaveSupplier() {
  if (supBusy.value) return // 在途禁再发·防双击建两个重复供应商（后端建档无 id 幂等）
  supBusy.value = true
  const r = await saveSupplier({ ...supForm.value })
  supBusy.value = false
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
  <div class="ld-page">
    <PageHeader
      title="物料与供应商"
      sub="物料主档（毛线料号按 色×档×形态 推导·计量建档后锁死）+ 供应商/织女 + 库存调整（必留原因）"
    />

    <ScmFlowTabs />

    <div class="ld-kpi-grid">
      <KpiCard label="物料数" :value="mats.length" :icon="Boxes" />
      <KpiCard label="供应商 / 织女" :value="sups.length" :icon="Factory" />
      <KpiCard label="低库存预警" :value="lowStockCount" :icon="TriangleAlert" :tone="lowStockCount > 0 ? 'red' : 'neutral'" />
    </div>

    <p v-if="message" class="ld-status" :class="msgOk ? 'msg-ok' : 'msg-err'">{{ message }}</p>

    <div class="scm-cols">
      <!-- 建物料档 -->
      <Card title="建物料档">
        <div class="scm-form">
          <select v-model="matForm.category">
            <option value="yarn">毛线</option>
            <option value="packaging">包装（挂产品）</option>
            <option value="card">卡片（挂产品）</option>
            <option value="accessory">辅料</option>
          </select>
          <input v-model="matForm.name" placeholder="名称" maxlength="60" />
          <select v-model="matForm.uom" :disabled="matForm.category === 'yarn'" :title="matForm.category === 'yarn' ? '毛线按团/件计·锁定' : ''">
            <option value="count">按件</option>
            <option value="gram">按克</option>
          </select>
          <template v-if="matForm.category === 'yarn'">
            <input v-model="matForm.color" placeholder="颜色（小写英文如 pink）" />
            <select v-model="matForm.tier">
              <option value="L">大团</option>
              <option value="M">中团</option>
              <option value="S">小团</option>
            </select>
            <select v-model="matForm.form">
              <option value="raw">原团</option>
              <option v-if="matForm.tier === 'L'" value="knotted">带结（仅大团）</option>
            </select>
          </template>
          <input v-else-if="matForm.category !== 'accessory'" v-model="matForm.productId" placeholder="所属产品 id" />
          <input v-else v-model="matForm.slug" placeholder="辅料名（小写英文）" />
          <select v-model="matForm.supplierId">
            <option value="">（不挂供应商）</option>
            <option v-for="s in sups" :key="s._id" :value="s._id">{{ s.name }}</option>
          </select>
          <input v-model.number="matForm.threshold" type="number" min="0" placeholder="安全库存阈值（低于报警·0=不报警）" />
          <UiButton block @click="doSaveMaterial">建档 / 更新</UiButton>
        </div>
        <p class="hint">计量方式建档后锁死；毛线料号按 颜色×档位×形态 自动生成。安全库存阈值＝低于此值列表标红报警（B4：换皮漏了这个输入·恒 0 致低库存告警失效）。</p>
      </Card>

      <!-- 供应商 / 织女 -->
      <Card title="供应商 / 织女">
        <template v-if="supForm.supplierId" #head>
          <Badge tone="brand">编辑中</Badge>
        </template>
        <div class="scm-form">
          <input v-model="supForm.name" placeholder="名称" maxlength="60" />
          <select v-model="supForm.type">
            <option value="factory">厂家（可下采购单）</option>
            <option value="outworker">织女（走外协单）</option>
          </select>
          <input v-model="supForm.contact" placeholder="联系方式" maxlength="120" />
          <input v-model="supForm.note" placeholder="备注（如结算周期/擅长款·可空）" maxlength="200" />
          <div class="scm-ops">
            <UiButton @click="doSaveSupplier">{{ supForm.supplierId ? '更新' : '保存' }}</UiButton>
            <UiButton v-if="supForm.supplierId" variant="ghost" @click="resetSupForm">取消编辑</UiButton>
          </div>
        </div>
        <div v-if="sups.length" class="sup-list">
          <div v-for="s in sups" :key="s._id" class="sup-line" :class="{ on: supForm.supplierId === s._id }" title="点击编辑" @click="editSupplier(s)">
            <span class="sup-name">{{ s.name }}<span v-if="s.note" class="sup-note"> · {{ s.note }}</span></span>
            <Badge tone="brand">{{ s.type === 'factory' ? '厂家' : '织女' }}</Badge>
          </div>
        </div>
      </Card>

      <!-- 库存调整（必留原因） -->
      <Card title="库存调整（必留原因）">
        <div class="scm-form">
          <select v-model="adj.materialId">
            <option value="">选料号…</option>
            <option v-for="m in mats" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}（现 {{ m.stock }}）</option>
          </select>
          <input v-model.number="adj.delta" type="number" placeholder="±整数（克/件）" />
          <input v-model="adj.reason" placeholder="原因（如 期初盘点）" maxlength="200" />
          <UiButton block :disabled="adjustBusy" @click="doAdjust">{{ adjustBusy ? '调整中…' : '调整' }}</UiButton>
        </div>
      </Card>
    </div>

    <!-- 物料主档表 -->
    <Card flush :title="'物料主档（' + mats.length + '）'">
      <template v-if="sortedMats.length">
        <div class="ld-thead">
          <div class="ld-th grow">料号</div>
          <div class="ld-th" :style="{ width: '160px' }">名称</div>
          <div class="ld-th" :style="{ width: '90px' }">类别</div>
          <div class="ld-th" :style="{ width: '80px' }">计量</div>
          <div class="ld-th r" :style="{ width: '150px' }">库存</div>
          <div class="ld-th" :style="{ width: '210px' }">供应商</div>
        </div>
        <div class="ld-tbody">
          <div v-for="m in sortedMats" :key="m._id" class="ld-tr">
            <div class="ld-td grow mat-id">
              <span class="human">{{ materialHuman(m._id) }}</span>
              <span class="mono">{{ m._id }}</span>
            </div>
            <div class="ld-td" :style="{ width: '160px' }">{{ m.name }}</div>
            <div class="ld-td muted" :style="{ width: '90px' }">{{ materialCategoryLabel(m.category) }}</div>
            <div class="ld-td muted" :style="{ width: '80px' }">{{ uomLabel(m.uom) }}</div>
            <div class="ld-td r stock-td" :style="{ width: '150px' }">
              <span :class="{ low: m.threshold && m.stock <= m.threshold }">{{ m.stock }}</span>
              <span v-if="m.threshold && m.stock <= m.threshold" class="low-tag">低于 {{ m.threshold }}</span>
            </div>
            <div class="ld-td sup-cell" :style="{ width: '210px' }">
              <span class="muted sup-name">{{ (sups.find((s) => s._id === m.supplierId) || {}).name || '—' }}</span>
              <UiButton variant="ghost" size="sm" title="看这个料的流水" @click="loadLedger(m._id)">流水</UiButton>
            </div>
          </div>
        </div>
      </template>
      <EmptyState v-else :icon="Boxes" text="还没有物料档，先在上方「建物料档」建档" />
    </Card>

    <!-- 库存流水表（按料号筛选/全部） -->
    <Card flush :title="ledgerMat ? '流水 · ' + materialHuman(ledgerMat) : '最近流水（全部料）'">
      <template v-if="ledgerMat" #head>
        <UiButton variant="ghost" size="sm" @click="loadLedger()">← 看全部</UiButton>
      </template>
      <template v-if="ledger.length">
        <div class="ld-thead">
          <div class="ld-th grow">时间</div>
          <div class="ld-th" :style="{ width: '90px' }">类型</div>
          <div class="ld-th" :style="{ width: '160px' }">料</div>
          <div class="ld-th r" :style="{ width: '90px' }">±</div>
          <div class="ld-th" :style="{ width: '120px' }">操作者</div>
          <div class="ld-th" :style="{ width: '200px' }">原因</div>
        </div>
        <div class="ld-tbody">
          <div v-for="l in ledger" :key="l.id" class="ld-tr">
            <div class="ld-td grow mono muted">{{ dateTime(l.at) }}</div>
            <div class="ld-td" :style="{ width: '90px' }">{{ l.docType }}</div>
            <div class="ld-td" :style="{ width: '160px' }">{{ l.material }}</div>
            <div class="ld-td r" :style="{ width: '90px' }">
              <span :class="l.delta > 0 ? 'pos' : 'neg'">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</span>
            </div>
            <div class="ld-td muted" :style="{ width: '120px' }">{{ l.operator }}</div>
            <div class="ld-td muted" :style="{ width: '200px' }">{{ l.reason || '—' }}</div>
          </div>
        </div>
      </template>
      <EmptyState v-else :icon="ScrollText" :text="ledgerMat ? '这个料还没有流水记录' : '还没有库存流水'" />
    </Card>
  </div>
</template>

<style scoped>
/* 提示行成功绿/失败红（复用全局 .ld-status·本页 msgOk 切换语义色·换皮期恒红 bug 已在管道修） */
.msg-ok {
  color: var(--ld-green);
}
.msg-err {
  color: var(--ld-red);
}

/* 三列建档区（本页独有多列表单·窄屏堆叠·无全局 3 列配方故本页自管） */
.scm-cols {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}
@media (max-width: 1000px) {
  .scm-cols {
    grid-template-columns: 1fr;
  }
}

/* 纵向堆叠表单（页面独有·pages 允许标签选择器统一输入外观） */
.scm-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.scm-form input,
.scm-form select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font: inherit;
  font-size: 13px;
  color: var(--ld-content);
  background: var(--ld-bg);
}
.scm-form input:focus,
.scm-form select:focus {
  outline: none;
  border-color: var(--ld-purple-line);
}
.scm-form input:disabled,
.scm-form select:disabled {
  background: var(--ld-bg-grey);
  color: var(--ld-content-2);
}
.scm-ops {
  display: flex;
  gap: 8px;
}
.hint {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--ld-content-2);
  line-height: 1.5;
}

/* 供应商列表（点选回填编辑·本页独有交互块） */
.sup-list {
  display: flex;
  flex-direction: column;
  margin-top: 12px;
}
.sup-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
  color: var(--ld-content);
  cursor: pointer;
  border-radius: var(--ld-radius-sm);
}
.sup-line:hover,
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

/* 表格单元（配合全局 .ld-table 系统·本页列内容样式） */
.r {
  justify-content: flex-end;
  text-align: right;
}
.muted {
  color: var(--ld-content-2);
}
.mat-id {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
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
.stock-td {
  gap: 4px;
  flex-wrap: wrap;
}
.low {
  color: var(--ld-red);
  font-weight: 700;
}
.low-tag {
  font-size: 10.5px;
  color: var(--ld-red);
}
.sup-cell {
  justify-content: space-between;
  gap: 6px;
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
