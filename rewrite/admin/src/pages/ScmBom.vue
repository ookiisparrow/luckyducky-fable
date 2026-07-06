<script setup lang="ts">
// 配方与组装（设计语言一致性·M3 UI 批17）：全局模板（共用料+毛线槽）+ 每产品差异位（三色+专属件）→
// 预演（只读看短缺）→ 执行组装（快照冻结·同单不双扣）。逻辑未动，仅套设计语言。
import { ref, onMounted, watch, computed, nextTick } from 'vue'
import { Plus, X, ClipboardList } from 'lucide-vue-next'
import { getBomSetup, saveBomTemplate, saveBomProfile, previewAssembly, runAssembly, listAssemblies, listMaterials } from '../api/scm'
import { listDrafts } from '../api/products'
import { materialHuman, scmErrorText, unprofiledProducts, productNameOf } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import { useLoadStatus } from '../lib/status'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const template = ref<{ commonLines: Array<{ materialId: string; qtyPerSet: number }>; yarnSlots: Array<{ tier: string; form: string; qtyPerSet: number }> }>({ commonLines: [], yarnSlots: [] })
// 未保存的模板编辑保护（审核补漏·P2 数据丢失）：用户改模板即标脏；reload 有脏则不覆盖模板（防
// doSaveProfile 的 void reload() 用服务端旧值回灌、静默吞掉未存编辑）。程序化载入经 tplGuard 抑制误标。
const tplDirty = ref(false)
let tplGuard = false
watch(template, () => { if (!tplGuard) tplDirty.value = true }, { deep: true })
const profiles = ref<Array<Record<string, any>>>([])
const mats = ref<Array<Record<string, any>>>([])
const assemblies = ref<Array<Record<string, any>>>([])
const products = ref<Array<Record<string, any>>>([]) // 全产品目录（换皮 SCM 域整体没接·致只显 id/无 SKU 下拉/看不到未填差异位）
// 产品名解析 + 未填差异位总览 + 组装规格 SKU 下拉（接回 listDrafts 一并复原）
const productName = (id: unknown) => productNameOf(products.value, id)
const unprofiled = computed(() => unprofiledProducts(products.value, profiles.value))
const runSkus = computed(() => {
  const p = products.value.find((x) => String(x.id || x._id) === String(run.value.productId))
  return Array.isArray(p?.skus) ? (p!.skus as Record<string, any>[]).map((s) => String(s.name || '')).filter(Boolean) : []
})
const shortCount = computed(() => preview.value.filter((l) => (l as any).short > 0 || (l as any).missing).length) // 执行前缺料预警
// 动作反馈(note)/加载态(load) 收口（病根#14）：reload 成功不再抹掉动作刚设的成功/失败原文。
const { message, ok: msgOk, note, load } = useLoadStatus()

const prof = ref({ productId: '', L: '', M: '', S: '', packagingMaterialId: '', cardMaterialId: '' })
const run = ref({ productId: '', spec: '', sets: 1 })
const preview = ref<Array<Record<string, any>>>([])
const runConfirm = ref(false)
const expanded = ref('') // 组装记录用料展开（换皮丢·点单号看扣了哪些料）

// 下拉候选（换皮退成裸文本框·易打错料号）：共用料限非毛线非成品（毛线走三档槽·颜色由差异位定）；专属件按类过滤
const commonCandidates = computed(() => mats.value.filter((m) => m.category !== 'yarn' && !String(m._id).startsWith('fg:')))
const packagingList = computed(() => mats.value.filter((m) => m.category === 'packaging'))
const cardList = computed(() => mats.value.filter((m) => m.category === 'card'))
const profileIds = computed(() => profiles.value.map((p) => String(p._id))) // 差异位建议 + 执行可选（有差异位才可组装）
const allProductIds = computed(() => products.value.map((p) => String(p.id || p._id)).filter(Boolean)) // 全产品（差异位可选未建过的）

// 编辑既有差异位（换皮丢·填完只能新建覆盖）：点列表项回填表单
function editProfile(p: Record<string, any>) {
  prof.value = {
    productId: String(p._id || ''),
    L: String(p.yarnColors?.L || ''),
    M: String(p.yarnColors?.M || ''),
    S: String(p.yarnColors?.S || ''),
    packagingMaterialId: String(p.packagingMaterialId || ''),
    cardMaterialId: String(p.cardMaterialId || ''),
  }
}
// 专属件按料号命名契约（pkg:/card:<productId>）自动预选——若该料已建档且当前未填
watch(() => prof.value.productId, (id) => {
  const pid = String(id || '').trim()
  if (!pid) return
  if (!prof.value.packagingMaterialId && packagingList.value.some((m) => m._id === 'pkg:' + pid)) prof.value.packagingMaterialId = 'pkg:' + pid
  if (!prof.value.cardMaterialId && cardList.value.some((m) => m._id === 'card:' + pid)) prof.value.cardMaterialId = 'card:' + pid
})
// B1 幂等键：每次组装意图生成一次·重试复用·成功才换新（换皮在 api 内每次现生成→双击/慢网双扣料双入库）
const pendingAsmId = ref('')

async function reload() {
  const [b, m, a, d] = await Promise.all([getBomSetup(), listMaterials(), listAssemblies(), listDrafts()])
  if (b.ok) {
    const t = (b.template as Record<string, any>) || {}
    if (!tplDirty.value) {
      // 无未保存编辑才回灌模板（有脏则保住用户编辑·不被 reload 吞）；tplGuard 抑制程序化写误标脏
      tplGuard = true
      template.value = { commonLines: t.commonLines || [], yarnSlots: t.yarnSlots || [] }
      void nextTick(() => (tplGuard = false))
    }
    profiles.value = (b.profiles as Record<string, any>[]) || []
  }
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  assemblies.value = a.ok ? (a.list as Record<string, any>[]) : []
  products.value = d.ok ? ((d as any).list as Record<string, any>[]) : []
  load(b.ok, '加载失败：' + String(b.error || '')) // 只在加载失败时写·成功静默不抹动作反馈
}

async function doSaveTemplate() {
  const r = await saveBomTemplate(template.value)
  note(r.ok, '模板已保存（历史组装单的快照不受影响）', scmErrorText(r.error))
  if (r.ok) tplDirty.value = false // 已落库·允许后续 reload 回灌最新
}

async function doSaveProfile() {
  const p = prof.value
  const r = await saveBomProfile({ productId: p.productId, yarnColors: { L: p.L, M: p.M, S: p.S }, packagingMaterialId: p.packagingMaterialId, cardMaterialId: p.cardMaterialId })
  note(r.ok, '差异位已保存', scmErrorText(r.error))
  void reload()
}

async function doPreview() {
  // 新预演＝新组装意图·换新幂等键（防拿旧 id 组装改过的产品/套数）
  pendingAsmId.value = ''
  runConfirm.value = false
  const r = await previewAssembly(run.value.productId, Number(run.value.sets))
  preview.value = r.ok ? (r.lines as Record<string, any>[]) : []
  note(r.ok, '', scmErrorText(r.error))
}

async function doRun() {
  if (!runConfirm.value) {
    if (!pendingAsmId.value) pendingAsmId.value = 'asm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) // 确认时生成一次
    runConfirm.value = true // 两步确认：执行即扣原料入成品
    return
  }
  runConfirm.value = false
  const r = await runAssembly(run.value.productId, run.value.spec, Number(run.value.sets), pendingAsmId.value)
  if (r.ok) {
    note(true, `组装完成：扣料 ${(r.consumed as unknown[]).length} 行·入成品 ${Number(r.sets)} 套`, '')
    pendingAsmId.value = '' // 成功才换新 id·下次组装全新幂等键
    preview.value = []
    void reload()
  } else {
    // 失败保留 pendingAsmId：重试复用同一幂等键·撞 id 幂等闸挡双扣（B1 修·后端 _id=assemblyId 确定性 claim）
    note(false, '', scmErrorText(r.error))
  }
}

// 改组装表单（产品/规格/套数）＝新意图·重置幂等键与确认态（防拿旧 id 组装改过的入参）
watch(run, () => {
  pendingAsmId.value = ''
  runConfirm.value = false
}, { deep: true })

onMounted(reload)
</script>

<template>
  <div class="ld-page">
    <PageHeader
      title="配方与组装"
      sub="全局模板（共用料 + 毛线槽）+ 产品差异位（三色 + 专属件）→ 预演看短缺 → 执行组装（快照冻结·同单不双扣）。"
    />

    <ScmFlowTabs />
    <p v-if="message" class="ld-status msg" :class="{ ok: msgOk }">{{ message }}</p>

    <div class="bom-cols">
      <Card title="全局模板" sub="所有产品共用">
        <h3 class="grp-title">共用料（每套用量）</h3>
        <div v-for="(l, i) in template.commonLines" :key="i" class="linerow">
          <select v-model="l.materialId">
            <option value="">选料号…</option>
            <option v-for="m in commonCandidates" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}</option>
          </select>
          <input v-model.number="l.qtyPerSet" type="number" min="1" />
          <button class="icon-btn" title="移除" @click="template.commonLines.splice(i, 1)"><X :size="14" :stroke-width="1.8" /></button>
        </div>
        <UiButton variant="ghost" size="sm" class="add-row" @click="template.commonLines.push({ materialId: '', qtyPerSet: 1 })">
          <Plus :size="14" :stroke-width="2" /><span>加料</span>
        </UiButton>

        <h3 class="grp-title mt">毛线槽（颜色按产品填）</h3>
        <div v-for="(s, i) in template.yarnSlots" :key="i" class="linerow yarn">
          <select v-model="s.tier"><option value="L">大团</option><option value="M">中团</option><option value="S">小团</option></select>
          <select v-model="s.form"><option value="raw">原团</option><option value="knotted">带结（仅大团）</option></select>
          <input v-model.number="s.qtyPerSet" type="number" min="1" />
          <button class="icon-btn" title="移除" @click="template.yarnSlots.splice(i, 1)"><X :size="14" :stroke-width="1.8" /></button>
        </div>
        <UiButton variant="ghost" size="sm" class="add-row" @click="template.yarnSlots.push({ tier: 'L', form: 'knotted', qtyPerSet: 1 })">
          <Plus :size="14" :stroke-width="2" /><span>加槽</span>
        </UiButton>

        <div class="card-foot"><UiButton @click="doSaveTemplate">保存模板</UiButton></div>
      </Card>

      <Card title="产品差异位" sub="三色 + 专属件">
        <div class="prof-form">
          <input v-model="prof.productId" list="bom-prof-ids" placeholder="产品 id（选既有或输新）" />
          <datalist id="bom-prof-ids"><option v-for="pid in allProductIds" :key="pid" :value="pid">{{ productName(pid) }}</option></datalist>
          <input v-model="prof.L" placeholder="大团颜色（如 pink）" />
          <input v-model="prof.M" placeholder="中团颜色" />
          <input v-model="prof.S" placeholder="小团颜色" />
          <select v-model="prof.packagingMaterialId">
            <option value="">选包装料号（pkg:产品id）…</option>
            <option v-for="m in packagingList" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}（{{ m._id }}）</option>
          </select>
          <select v-model="prof.cardMaterialId">
            <option value="">选卡片料号（card:产品id）…</option>
            <option v-for="m in cardList" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}（{{ m._id }}）</option>
          </select>
          <UiButton block @click="doSaveProfile">{{ profileIds.includes(prof.productId.trim()) ? '更新差异位' : '保存差异位' }}</UiButton>
        </div>

        <div class="prof-list">
          <div v-for="p in profiles" :key="p._id" class="prof-line" :class="{ on: prof.productId === p._id }" title="点击编辑" @click="editProfile(p)">
            <span class="prof-txt">{{ productName(p._id) }}：L={{ p.yarnColors?.L || '—' }} M={{ p.yarnColors?.M || '—' }} S={{ p.yarnColors?.S || '—' }}</span>
            <Badge v-if="!p.packagingMaterialId || !p.cardMaterialId" tone="red">缺专属件</Badge>
          </div>
          <p v-if="!profiles.length" class="hint">还没有差异位——填上面表单保存</p>
        </div>

        <!-- 未填差异位总览（换皮丢·没建过差异位的在售产品完全不出现·组装前会被拒却发现不了·接回 listDrafts 全目录） -->
        <div v-if="unprofiled.length" class="unprof">
          <h3 class="grp-title warn">未填差异位（打包前必填·{{ unprofiled.length }}）</h3>
          <div class="chip-wrap">
            <button v-for="u in unprofiled" :key="u.id" class="unprof-chip" :title="'去建 ' + u.id + ' 的差异位'" @click="prof.productId = u.id">{{ productName(u.id) }} +</button>
          </div>
        </div>
      </Card>

      <Card title="组装执行" sub="扣原料 · 入成品">
        <div class="run-form">
          <select v-model="run.productId">
            <option value="">选产品（须有差异位）…</option>
            <option v-for="pid in profileIds" :key="pid" :value="pid">{{ productName(pid) }}</option>
          </select>
          <!-- 组装规格：有 SKU 走下拉（换皮退成裸文本框·易与商品实际 SKU 不一致·拼错成品入错 spec）·无 SKU 退文本 -->
          <select v-if="runSkus.length" v-model="run.spec"><option value="">规格（可空）…</option><option v-for="s in runSkus" :key="s" :value="s">{{ s }}</option></select>
          <input v-else v-model="run.spec" placeholder="规格（可空）" />
          <input v-model.number="run.sets" type="number" min="1" placeholder="套数" />
          <div class="run-ops">
            <UiButton variant="ghost" @click="doPreview">预演（只看不扣）</UiButton>
            <UiButton variant="danger" @click="doRun">{{ runConfirm ? (shortCount ? `有 ${shortCount} 项缺料·仍执行？` : '确认扣料入成品？') : '执行组装' }}</UiButton>
          </div>
        </div>

        <div v-if="preview.length" class="preview">
          <div class="pv-head"><span>料</span><span class="r">需</span><span class="r">存</span><span class="r">缺</span></div>
          <div v-for="l in preview" :key="l.materialId" class="pv-row" :class="{ short: l.short > 0 || l.missing }">
            <span>{{ materialHuman(l.materialId) }}{{ l.missing ? '（未建档）' : '' }}</span>
            <span class="r">{{ l.need }}</span><span class="r">{{ l.stock }}</span><span class="r">{{ l.short }}</span>
          </div>
        </div>
      </Card>
    </div>

    <Card title="组装记录" flush>
      <template v-if="assemblies.length">
        <div class="ld-thead">
          <div class="ld-th grow">单号</div>
          <div class="ld-th" :style="{ width: '180px' }">产品</div>
          <div class="ld-th r" :style="{ width: '80px' }">套数</div>
          <div class="ld-th" :style="{ width: '120px' }">操作者</div>
          <div class="ld-th" :style="{ width: '160px' }">时间</div>
          <div class="ld-th r" :style="{ width: '100px' }">用料</div>
        </div>
        <div class="ld-tbody">
          <template v-for="a in assemblies" :key="a._id">
            <div class="ld-tr">
              <div class="ld-td grow mono">{{ a._id }}</div>
              <div class="ld-td" :style="{ width: '180px' }">{{ productName(a.productId) }}{{ a.spec ? '（' + a.spec + '）' : '' }}</div>
              <div class="ld-td r" :style="{ width: '80px' }">{{ a.sets }}</div>
              <div class="ld-td muted" :style="{ width: '120px' }">{{ a.operator }}</div>
              <div class="ld-td muted mono" :style="{ width: '160px' }">{{ dateTime(a.at) }}</div>
              <div class="ld-td r" :style="{ width: '100px' }">
                <UiButton variant="ghost" size="sm" @click="expanded = expanded === a._id ? '' : a._id">{{ expanded === a._id ? '收起' : '展开' }}</UiButton>
              </div>
            </div>
            <div v-if="expanded === a._id" class="ld-tr sub-row">
              <div class="consumed">扣料快照：{{ (a.consumedLines || []).map((l) => materialHuman(l.materialId) + '×' + l.qty).join(' · ') || '（无快照）' }}</div>
            </div>
          </template>
        </div>
      </template>
      <EmptyState v-else :icon="ClipboardList" text="还没有组装记录" />
    </Card>
  </div>
</template>

<style scoped>
/* 本页独有：三列配方卡的行内表单（共用料/毛线槽多列行·差异位表单·组装预演缺口块）+ 组装记录展开子行。
 * 页头/卡/徽章/空态/按钮/表格已交共享原语与 .ld-* 全局类。 */

/* 提示行：本页 message 双态（成功绿 / 失败红）·覆盖 .ld-status 灰底 */
.msg {
  color: var(--ld-red);
}
.msg.ok {
  color: var(--ld-green);
}

/* 三列配方卡（窄屏堆叠·顶对齐不等高拉伸） */
.bom-cols {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  align-items: start;
}
@media (max-width: 1100px) {
  .bom-cols {
    grid-template-columns: 1fr;
  }
}

/* 卡内表单控件（页面级·非组件·descendant tag 选择器合法） */
.bom-cols input,
.bom-cols select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  font-family: inherit;
  color: var(--ld-content);
  background: var(--ld-bg);
  box-sizing: border-box;
}

/* 分组小标题 */
.grp-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ld-purple-meta);
}
.grp-title.mt {
  margin-top: 16px;
}
.grp-title.warn {
  color: var(--ld-red);
}

/* 料/槽多列行 + 移除按钮 */
.linerow {
  display: grid;
  grid-template-columns: 1fr 64px 30px;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.linerow.yarn {
  grid-template-columns: 1fr 1fr 56px 30px;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  color: var(--ld-content-2);
  cursor: pointer;
}
.icon-btn:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.add-row {
  margin-top: 2px;
}
.card-foot {
  margin-top: 16px;
}

/* 差异位表单（纵向堆叠） */
.prof-form,
.run-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 已建差异位列表（点击回填编辑） */
.prof-list {
  margin-top: 14px;
}
.prof-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  border-top: 1px solid var(--ld-line);
  cursor: pointer;
  border-radius: var(--ld-radius-sm);
}
.prof-line:hover {
  background: var(--ld-bg-lilac);
}
.prof-line.on {
  background: var(--ld-bg-lilac);
}
.prof-txt {
  min-width: 0;
  font-size: 11.5px;
  font-family: var(--ld-font-mono);
  color: var(--ld-content-2);
}
.prof-line.on .prof-txt {
  color: var(--ld-brand-active);
}
.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--ld-content-2);
}

/* 缺口块：未填差异位快速建档 chip 群 */
.unprof {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--ld-line);
}
.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.unprof-chip {
  padding: 5px 11px;
  border: 1px solid var(--ld-red-line);
  border-radius: 999px;
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
}
.unprof-chip:hover {
  background: var(--ld-bg);
}

/* 组装执行操作 + 预演缺口块 */
.run-ops {
  display: flex;
  gap: 8px;
}
.preview {
  margin-top: 14px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  overflow: hidden;
}
.pv-head,
.pv-row {
  display: grid;
  grid-template-columns: 1fr 0.7fr 0.7fr 0.7fr;
  gap: 8px;
  padding: 7px 12px;
}
.pv-head {
  background: var(--ld-bg-grey);
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.pv-row {
  border-top: 1px solid var(--ld-line);
  font-size: 12.5px;
  color: var(--ld-content);
}
.pv-row.short {
  color: var(--ld-red);
}

/* 组装记录表：展开子行 + 单元语气 */
.ld-td.r,
.ld-th.r {
  justify-content: flex-end;
}
.ld-tbody .ld-tr.sub-row {
  display: block;
  padding: 8px 16px 10px;
  background: var(--ld-bg-lilac);
}
.consumed {
  font-size: 12px;
  color: var(--ld-content);
  font-family: var(--ld-font-mono);
  line-height: 1.5;
}
.mono {
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
}
.muted {
  color: var(--ld-content-2);
}
.r {
  text-align: right;
}
</style>
