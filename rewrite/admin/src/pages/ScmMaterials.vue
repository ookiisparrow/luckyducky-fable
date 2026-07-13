<script setup lang="ts">
// 物料与供应商（设计语言一致性·M3 UI 批16）：主档（毛线按 色×档×形态 推导料号·计量建档锁死）+ 供应商/织女
// + 库存调整（必留原因·扣超整单拒）+ 流水查账。逻辑未动，仅套设计语言（页头/表单卡/grid 表/token）。
import { ref, computed, onMounted, watch } from 'vue'
import { listMaterials, saveMaterial, listSuppliers, saveSupplier, adjustStock, listLedger } from '../api/scm'
import { materialHuman, materialCategoryLabel, uomLabel, scmErrorText, mapLedger, type LedgerRow } from '../lib/mapScm'
import { stocktakeDiff, filterSubmittable, genStocktakeNo, stocktakeAdjustId } from '../lib/stocktake'
import { dateTime } from '../lib/format'
import { useLoadStatus } from '../lib/status'
import { useLatest } from '../lib/latest'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { Boxes, Factory, TriangleAlert, ScrollText, ClipboardCheck } from 'lucide-vue-next'

const mats = ref<Array<Record<string, any>>>([])
const sups = ref<Array<Record<string, any>>>([])
const ledger = ref<LedgerRow[]>([])
const ledgerMat = ref('') // 当前流水按哪个料号过滤（空=全部·换皮丢了行内按料查流水）
// B1（根因#7）：供应商列表 + 流水列表两处翻页态（照 Orders.vue/Conversations.vue 模式）。
const supCursor = ref<unknown>(null)
const supHasMore = ref(false)
const ledgerCursor = ref<unknown>(null)
const ledgerHasMore = ref(false)
// 流水加载失败独立记账（P2·深审20260712 失败伪装空账本）：不复用 message——reload 收尾 load(m.ok…)
// 会覆盖它；失败时 ledger=[] 若无此标记，EmptyState「还没有流水」＝把查询失败伪装成空账。
const ledgerError = ref('')
// 动作反馈(note)/加载态(load) 收口（病根#14）：reload 成功不再抹掉动作刚设的成功/失败原文。
const { message, ok: msgOk, note, load } = useLoadStatus()

// 行内按料号查流水（换皮只有全局最近流水·listLedger 支持 materialId 过滤）
const ledgerGen = useLatest() // 流水乱序守卫（P2·item6：照 latest.ts 范式·快速切料号连查·旧回包别盖新查询结果）
async function loadLedger(materialId?: string) {
  const my = ledgerGen.begin()
  const l = await listLedger(materialId)
  if (ledgerGen.isStale(my)) return // 已发起更新的查询·丢弃过期流水（切料号即换新首页游标）
  ledger.value = l.ok ? mapLedger(l.list) : []
  ledgerCursor.value = l.ok ? l.nextCursor : null
  ledgerHasMore.value = !!(l.ok && l.hasMore)
  ledgerError.value = l.ok ? '' : '流水加载失败：' + String(l.error || '') // 独立 ref·不被 reload 的 load() 抹掉
  ledgerMat.value = materialId || ''
  stocktakeExitConfirm.value = false // 刷新即复位危险态（守卫 rw-admin-armed-reset-on-load·防旧武装退出确认跨刷新残留一击直发）
}

// 流水「加载更多」（B1）：复用当前料号筛选·续游标追加·去重防双击重复追加同一页（同 Conversations more() 范式）
async function moreLedger() {
  if (!ledgerHasMore.value || ledgerCursor.value == null) return
  const gen = ledgerGen.peek() // 绑定当前查询代际·不递增（新查询会作废本页·防混排）
  const l = await listLedger(ledgerMat.value || undefined, { cursor: ledgerCursor.value })
  if (ledgerGen.isStale(gen)) return
  if (!l.ok) {
    note(false, '', '加载更多流水失败：' + scmErrorText(l.error))
    return
  }
  const seen = new Set(ledger.value.map((x) => x.id))
  ledger.value = [...ledger.value, ...mapLedger(l.list).filter((x) => !seen.has(x.id))]
  ledgerCursor.value = l.nextCursor
  ledgerHasMore.value = !!l.hasMore
}

// 供应商「加载更多」（B1）：现行上限 200 内首屏零变化，翻页可续查曾被永久挤出的超上限旧档
async function moreSuppliers() {
  if (!supHasMore.value || supCursor.value == null) return
  const s = await listSuppliers({ cursor: supCursor.value })
  if (!s.ok) {
    note(false, '', '加载更多供应商失败：' + scmErrorText(s.error))
    return
  }
  const seen = new Set(sups.value.map((x) => x._id))
  sups.value = [...sups.value, ...(((s.list as Record<string, any>[]) || []).filter((x) => !seen.has(x._id)))]
  supCursor.value = s.nextCursor
  supHasMore.value = !!s.hasMore
}

const matForm = ref({ category: 'yarn', name: '', uom: 'count', color: '', tier: 'L', form: 'raw', productId: '', slug: '', supplierId: '', threshold: 0 })
const supForm = ref({ supplierId: '', name: '', type: 'factory', contact: '', note: '' })
const adj = ref({ materialId: '', delta: 0, reason: '' })
const adjustId = ref('') // 本次调整意图的幂等键（生成一次·重试复用·成功才换新·根因#4·同 runAssembly B1）
const adjustBusy = ref(false)
const supBusy = ref(false) // 供应商建档在途锁（P2·防双击建重复供应商）

// ── 批量盘点模式（批 B3）：一屏批量录实盘→差异预览→复用既有 adjustStock 幂等键一次提交
// （SCM-Z 靠人项「期初盘点录入·不录=账实必偏」工具化：逐行开调整单弹窗太慢，本模式一次拉全量对完）──
interface StocktakeUiRow {
  materialId: string
  uom: string
  stock: number // 进入盘点时刻的账面快照（提交成功也不回读，行状态靠 status 而非重取 stock 判断）
  actual: number | '' // v-model.number：未填时是空串，isValidActual/stocktakeDiff 会把它当未盘处理
  status: 'idle' | 'submitting' | 'success' | 'failed'
  error: string
}
const stocktakeMode = ref(false)
const stocktakeRows = ref<StocktakeUiRow[]>([])
const stocktakeNo = ref('') // 盘点单号（进入模式时生成一次·ST-yyyymmdd-4位随机）
const stocktakeReason = ref('期初盘点') // 全局盘点原因·必填
const stocktakeBusy = ref(false) // 提交中全局闸：禁改输入/禁二次提交（同 adjustBusy/supBusy 范式）
const stocktakeExitConfirm = ref(false) // 退出二次确认（未提交差异时·同 Products.vue 上下架两步确认范式）

const stocktakeReasonValid = computed(() => stocktakeReason.value.trim().length > 0)
// 待提交范围须先排除已锁定行（成功=已生效不重发；提交中=避免同行并发重复调用同一 adjustId）——
// 评审 P2：只按 stock/actual 算差异会把已成功/在途行也算进「待提交」计数、并在批量提交时对其重发
// adjustStock（服务端幂等挡下不致双记账，但计数会话人、且是冗余请求）。计数/批量提交/单行重试三处
// 共此口径，不重复写排除逻辑。
function pendingStocktakeRows(): StocktakeUiRow[] {
  return stocktakeRows.value.filter((r) => r.status !== 'success' && r.status !== 'submitting')
}
const stocktakeSubmittableCount = computed(
  () => filterSubmittable(pendingStocktakeRows().map((r) => ({ materialId: r.materialId, stock: r.stock, actual: r.actual }))).length
)
const stocktakeSummary = computed(() => ({
  success: stocktakeRows.value.filter((r) => r.status === 'success').length,
  failed: stocktakeRows.value.filter((r) => r.status === 'failed').length,
}))

// 进入盘点：拉一份全量快照（listMaterials 本就 limit 500 整取无分页·B1 刻意不收口留给本模式）+ 生成本次盘点单号
async function enterStocktake() {
  const m = await listMaterials()
  const list = m.ok ? (m.list as Record<string, any>[]) : []
  stocktakeRows.value = list.map((mat) => ({
    materialId: String(mat._id),
    uom: String(mat.uom || ''),
    stock: Number(mat.stock) || 0,
    actual: '',
    status: 'idle',
    error: '',
  }))
  stocktakeNo.value = genStocktakeNo()
  stocktakeReason.value = '期初盘点'
  stocktakeExitConfirm.value = false
  stocktakeMode.value = true
  // 评审 P2：拉取失败不写错误会与「确实没有物料」撞成同一假空态（病根14）——沿用 reload() 同款 load() 接线。
  load(m.ok, '加载失败：' + String(m.error || ''))
}

// 有未提交差异（已填合法且差异≠0、尚未成功）——退出前拦一道，防手滑丢盘点结果
function stocktakeDirty(): boolean {
  return stocktakeRows.value.some((r) => {
    if (r.status === 'success') return false
    const d = stocktakeDiff(r.stock, r.actual)
    return d !== null && d !== 0
  })
}

function exitStocktake() {
  if (stocktakeBusy.value) return // 提交中不给退（避免撤到提交流一半）
  if (stocktakeDirty() && !stocktakeExitConfirm.value) {
    stocktakeExitConfirm.value = true // 第一下只亮「确认退出？」（两步确认·同 Products.vue 上下架范式）
    return
  }
  stocktakeMode.value = false
  stocktakeExitConfirm.value = false
  void reload()
}

// 单行提交（批量提交与单行重试共用同一实现）：失败重试复用同一 adjustId（stocktakeAdjustId 纯函数·
// 单号+料号恒同键）——一旦提交过一次（成败均算），模板 :disabled 即锁死该行 actual 输入（离开待盘
// 初态就锁，不只锁提交中/成功两态），不会再对同键送出不同 delta。
// 评审 P1：锁定范围须覆盖失败态，否则「网络报错但服务端其实已成功」时，管理员会把 actual 改成别的
// 数再重试——同一 adjustId 撞服务端幂等键静默 no-op（r.ok=true, applied=0），前端却据 r.ok 判成功，
// 账实悄悄不符。锁死后重试恒复用同一 delta，幂等跳过＝已生效的同一结果，杜绝这层错配。
async function submitOneStocktakeRow(row: StocktakeUiRow) {
  const delta = stocktakeDiff(row.stock, row.actual)
  if (delta === null || delta === 0 || !stocktakeReasonValid.value) return
  row.status = 'submitting'
  row.error = ''
  const reason = `${stocktakeReason.value.trim()}（${stocktakeNo.value}）`
  const r = await adjustStock(row.materialId, delta, reason, stocktakeAdjustId(stocktakeNo.value, row.materialId))
  if (r.ok) {
    row.status = 'success'
  } else {
    row.status = 'failed'
    row.error = scmErrorText(r.error)
  }
}

async function submitStocktake() {
  if (stocktakeBusy.value || !stocktakeReasonValid.value) return // 在途禁再发·原因必填
  const pending = pendingStocktakeRows() // 排除已成功/在途行——不重发已锁定行的 adjustStock
  const submittable = filterSubmittable(pending.map((r) => ({ materialId: r.materialId, stock: r.stock, actual: r.actual })))
  if (!submittable.length) return
  const ids = new Set(submittable.map((s) => s.materialId))
  stocktakeBusy.value = true
  await Promise.all(pending.filter((r) => ids.has(r.materialId)).map((r) => submitOneStocktakeRow(r)))
  stocktakeBusy.value = false
  void reload() // 刷新主档库存/流水（不退出盘点模式·失败行仍留在面板可单独重试）
}

async function retryStocktakeRow(materialId: string) {
  if (stocktakeBusy.value) return
  const row = stocktakeRows.value.find((r) => r.materialId === materialId)
  if (!row || row.status !== 'failed') return
  stocktakeBusy.value = true // 评审 P2：单行重试也占用全局闸，防与「提交盘点」按钮并发触碰同一批行
  await submitOneStocktakeRow(row)
  stocktakeBusy.value = false
  void reload()
}

// 差异展示（模板专用小函数·避免模板里裸写 TS 非空断言）：负红/正绿/0 或未盘/非法灰。
function stocktakeDiffClass(stock: number, actual: unknown): string {
  const d = stocktakeDiff(stock, actual)
  if (d === null || d === 0) return 'muted'
  return d > 0 ? 'pos' : 'neg'
}
function stocktakeDiffText(stock: number, actual: unknown): string {
  const d = stocktakeDiff(stock, actual)
  if (d === null) return '—'
  return d > 0 ? `+${d}` : `${d}`
}

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
// 档位从大团切走后重置残留 'knotted'（D2·bug 清除批D）：模板 v-if（139-150 行）只隐藏「带结」option 不重置
// v-model，tier 切非 L 后 form 仍持 'knotted'，select 显示空白且提交被云端 KNOT_ONLY_L 拒绝、报错与界面所见对不上。
// 同仓先例：ScmBom.vue「切主键清残留下级字段」纪律。
watch(() => matForm.value.tier, (t) => {
  if (t !== 'L' && matForm.value.form === 'knotted') matForm.value.form = 'raw'
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
  supCursor.value = s.ok ? s.nextCursor : null
  supHasMore.value = !!(s.ok && s.hasMore)
  await loadLedger(ledgerMat.value || undefined) // 保持当前料号筛选（内部已复位 stocktakeExitConfirm）
  load(m.ok, '加载失败：' + String(m.error || '')) // 只在加载失败时写·成功静默不抹动作反馈
  stocktakeExitConfirm.value = false // 刷新即复位危险态（守卫 rw-admin-armed-reset-on-load）
}

async function doSaveMaterial() {
  const r = await saveMaterial({ ...matForm.value })
  note(r.ok, `已建档：${String(r.materialId)}`, scmErrorText(r.error))
  void reload()
}

async function doSaveSupplier() {
  if (supBusy.value) return // 在途禁再发·防双击建两个重复供应商（后端建档无 id 幂等）
  const snap = supForm.value // 快照本次编辑目标（H1·同批G G3/G4 范式）：editSupplier 无 supBusy 门控，await 期间若已切到
  // 另一供应商/新建（resetSupForm 也会换新对象），回包收尾效果（note 会按新表单误报）不该打过去
  supBusy.value = true
  const r = await saveSupplier({ ...supForm.value })
  supBusy.value = false
  if (supForm.value === snap) {
    note(r.ok, snap.supplierId ? '供应商已更新' : '供应商已保存', scmErrorText(r.error))
    if (r.ok) resetSupForm()
  }
  void reload() // 列表刷新与目标是否已切无关·恒执行
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

    <!-- 批量盘点入口（批 B3）：一屏批量录实盘→差异预览→一次提交，工具化 SCM-Z 靠人项「期初盘点录入」 -->
    <div v-if="!stocktakeMode" class="stocktake-entry">
      <UiButton variant="ghost" @click="enterStocktake"><ClipboardCheck :size="16" />批量盘点</UiButton>
    </div>

    <p v-if="!stocktakeMode && message" class="ld-status" :class="msgOk ? 'msg-ok' : 'msg-err'">{{ message }}</p>

    <template v-if="!stocktakeMode">
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
            <div v-if="supHasMore" class="tbl-foot">
              <span>已加载 {{ sups.length }}</span>
              <UiButton variant="ghost" size="sm" @click="moreSuppliers">加载更多</UiButton>
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
        <!-- 失败提示优先于表格/空态：查询挂掉别显「还没有流水」假空账（P2·深审20260712） -->
        <p v-if="ledgerError" class="ledger-err">{{ ledgerError }}</p>
        <template v-else-if="ledger.length">
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
          <div v-if="ledgerHasMore" class="tbl-foot">
            <span>已加载 {{ ledger.length }} 条</span>
            <UiButton variant="ghost" size="sm" @click="moreLedger">加载更多</UiButton>
          </div>
        </template>
        <EmptyState v-else :icon="ScrollText" :text="ledgerMat ? '这个料还没有流水记录' : '还没有库存流水'" />
      </Card>
    </template>

    <!-- 批量盘点面板（批 B3）：全屏内整页表格·退出模式回落正常物料页 -->
    <template v-else>
      <p v-if="message" class="ld-status" :class="msgOk ? 'msg-ok' : 'msg-err'">{{ message }}</p>
      <Card flush title="批量盘点">
        <template #head>
          <UiButton variant="ghost" size="sm" :disabled="stocktakeBusy" @click="exitStocktake">
            {{ stocktakeExitConfirm ? '确认退出？（未提交差异会丢失）' : '退出盘点' }}
          </UiButton>
        </template>
        <div class="stocktake-bar">
          <span class="stocktake-no">盘点单号 <b class="mono">{{ stocktakeNo }}</b></span>
          <input v-model="stocktakeReason" placeholder="盘点原因（必填）" maxlength="200" :disabled="stocktakeBusy" />
          <UiButton :disabled="stocktakeBusy || stocktakeSubmittableCount === 0 || !stocktakeReasonValid" @click="submitStocktake">
            {{ stocktakeBusy ? '提交中…' : `提交盘点（${stocktakeSubmittableCount}）` }}
          </UiButton>
        </div>
        <p v-if="stocktakeSummary.success || stocktakeSummary.failed" class="stocktake-summary">
          已提交 {{ stocktakeSummary.success }} 成功 / {{ stocktakeSummary.failed }} 失败<span v-if="stocktakeSummary.failed">（失败行下方可单独重试）</span>
        </p>
        <template v-if="stocktakeRows.length">
          <div class="ld-thead">
            <div class="ld-th grow">物料</div>
            <div class="ld-th" :style="{ width: '70px' }">计量</div>
            <div class="ld-th r" :style="{ width: '90px' }">账面数</div>
            <div class="ld-th r" :style="{ width: '130px' }">实盘数</div>
            <div class="ld-th r" :style="{ width: '90px' }">差异</div>
            <div class="ld-th" :style="{ width: '170px' }">行状态</div>
          </div>
          <div class="ld-tbody">
            <div v-for="row in stocktakeRows" :key="row.materialId" class="ld-tr">
              <div class="ld-td grow mat-id">
                <span class="human">{{ materialHuman(row.materialId) }}</span>
                <span class="mono">{{ row.materialId }}</span>
              </div>
              <div class="ld-td muted" :style="{ width: '70px' }">{{ uomLabel(row.uom) }}</div>
              <div class="ld-td r" :style="{ width: '90px' }">{{ row.stock }}</div>
              <div class="ld-td r" :style="{ width: '130px' }">
                <input
                  v-model.number="row.actual"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="未盘"
                  class="stocktake-actual"
                  :disabled="stocktakeBusy || row.status !== 'idle'"
                />
              </div>
              <div class="ld-td r" :style="{ width: '90px' }">
                <span :class="stocktakeDiffClass(row.stock, row.actual)">{{ stocktakeDiffText(row.stock, row.actual) }}</span>
              </div>
              <div class="ld-td" :style="{ width: '170px' }">
                <span v-if="row.status === 'idle'" class="muted">待提交</span>
                <span v-else-if="row.status === 'submitting'" class="muted">提交中…</span>
                <span v-else-if="row.status === 'success'" class="pos">成功</span>
                <span v-else class="stocktake-fail">
                  <span class="neg" :title="row.error">失败</span>
                  <UiButton variant="ghost" size="sm" :disabled="stocktakeBusy" @click="retryStocktakeRow(row.materialId)">重试</UiButton>
                </span>
              </div>
            </div>
          </div>
        </template>
        <EmptyState v-else :icon="Boxes" text="没有物料档可盘点" />
      </Card>
    </template>
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

/* 翻页页脚（B1·根因#7·供应商列表 + 流水列表两处·同 Orders.vue 范式） */
.tbl-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--ld-line);
  font-size: 12px;
  color: var(--ld-content-2);
}

/* 批量盘点模式（批 B3）：入口按钮 + 顶部工具条 + 汇总行 + 失败行重试（本页独有·不进全局样式） */
.stocktake-entry {
  display: flex;
  justify-content: flex-end;
  margin: -4px 0 8px;
}
.stocktake-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  flex-wrap: wrap;
}
.stocktake-no {
  font-size: 12.5px;
  color: var(--ld-content-2);
  white-space: nowrap;
}
.stocktake-bar input {
  flex: 1;
  min-width: 160px;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font: inherit;
  font-size: 13px;
  color: var(--ld-content);
  background: var(--ld-bg);
}
.stocktake-summary {
  margin: 0 16px 8px;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.stocktake-fail {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stocktake-actual {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font: inherit;
  font-size: 13px;
  text-align: right;
  color: var(--ld-content);
  background: var(--ld-bg);
}
.stocktake-actual:disabled {
  background: var(--ld-bg-grey);
  color: var(--ld-content-2);
}
.ledger-err {
  margin: 0;
  padding: 14px 16px;
  font-size: 12.5px;
  color: var(--ld-red);
}
</style>
