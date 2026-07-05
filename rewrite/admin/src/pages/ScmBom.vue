<script setup lang="ts">
// 配方与组装（设计语言一致性·M3 UI 批17）：全局模板（共用料+毛线槽）+ 每产品差异位（三色+专属件）→
// 预演（只读看短缺）→ 执行组装（快照冻结·同单不双扣）。逻辑未动，仅套设计语言。
import { ref, onMounted, watch, computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import { getBomSetup, saveBomTemplate, saveBomProfile, previewAssembly, runAssembly, listAssemblies, listMaterials } from '../api/scm'
import { listDrafts } from '../api/products'
import { materialHuman, scmErrorText, unprofiledProducts, productNameOf } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'

const template = ref<{ commonLines: Array<{ materialId: string; qtyPerSet: number }>; yarnSlots: Array<{ tier: string; form: string; qtyPerSet: number }> }>({ commonLines: [], yarnSlots: [] })
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
const message = ref('')
const msgOk = ref(false) // 换皮 .status 恒红→成功信息显红 bug·区分成功(绿)/失败(红)
function note(ok: boolean, okText: string, errText: string) {
  message.value = ok ? okText : errText
  msgOk.value = ok
}

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
    template.value = { commonLines: t.commonLines || [], yarnSlots: t.yarnSlots || [] }
    profiles.value = (b.profiles as Record<string, any>[]) || []
  }
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  assemblies.value = a.ok ? (a.list as Record<string, any>[]) : []
  products.value = d.ok ? ((d as any).list as Record<string, any>[]) : []
  note(b.ok, '', '加载失败：' + String(b.error || ''))
}

async function doSaveTemplate() {
  const r = await saveBomTemplate(template.value)
  note(r.ok, '模板已保存（历史组装单的快照不受影响）', scmErrorText(r.error))
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
  <div class="page">
    <header class="page-head">
      <h1>配方与组装</h1>
      <p class="sub">全局模板（共用料 + 毛线槽）+ 产品差异位（三色 + 专属件）→ 预演看短缺 → 执行组装（快照冻结·同单不双扣）。</p>
    </header>

    <ScmFlowTabs />
    <p v-if="message" class="status" :class="{ ok: msgOk }">{{ message }}</p>

    <div class="cols">
      <section class="card">
        <h2>全局模板（所有产品共用）</h2>
        <h3>共用料（每套用量）</h3>
        <div v-for="(l, i) in template.commonLines" :key="i" class="linerow">
          <select v-model="l.materialId">
            <option value="">选料号…</option>
            <option v-for="m in commonCandidates" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}</option>
          </select>
          <input v-model.number="l.qtyPerSet" type="number" min="1" />
          <button class="icon-x" @click="template.commonLines.splice(i, 1)">×</button>
        </div>
        <button class="add-btn" @click="template.commonLines.push({ materialId: '', qtyPerSet: 1 })"><Plus :size="12" :stroke-width="2" /><span>加料</span></button>
        <h3>毛线槽（颜色按产品填）</h3>
        <div v-for="(s, i) in template.yarnSlots" :key="i" class="linerow">
          <select v-model="s.tier"><option value="L">大团</option><option value="M">中团</option><option value="S">小团</option></select>
          <select v-model="s.form"><option value="raw">原团</option><option value="knotted">带结（仅大团）</option></select>
          <input v-model.number="s.qtyPerSet" type="number" min="1" />
          <button class="icon-x" @click="template.yarnSlots.splice(i, 1)">×</button>
        </div>
        <button class="add-btn" @click="template.yarnSlots.push({ tier: 'L', form: 'knotted', qtyPerSet: 1 })"><Plus :size="12" :stroke-width="2" /><span>加槽</span></button>
        <div class="ops"><button class="btn-primary" @click="doSaveTemplate">保存模板</button></div>
      </section>

      <section class="card">
        <h2>产品差异位（三色 + 专属件）</h2>
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
        <button class="btn-primary" @click="doSaveProfile">{{ profileIds.includes(prof.productId.trim()) ? '更新差异位' : '保存差异位' }}</button>
        <div class="prof-list">
          <div v-for="p in profiles" :key="p._id" class="prof-line" :class="{ on: prof.productId === p._id }" title="点击编辑" @click="editProfile(p)">
            <span>{{ productName(p._id) }}：L={{ p.yarnColors?.L || '—' }} M={{ p.yarnColors?.M || '—' }} S={{ p.yarnColors?.S || '—' }}</span>
            <span v-if="!p.packagingMaterialId || !p.cardMaterialId" class="prof-warn">缺专属件</span>
          </div>
          <p v-if="!profiles.length" class="prof-empty">还没有差异位——填上面表单保存</p>
        </div>
        <!-- 未填差异位总览（换皮丢·没建过差异位的在售产品完全不出现·组装前会被拒却发现不了·接回 listDrafts 全目录） -->
        <div v-if="unprofiled.length" class="unprof">
          <h3>未填差异位（打包前必填·{{ unprofiled.length }}）</h3>
          <button v-for="u in unprofiled" :key="u.id" class="unprof-chip" :title="'去建 ' + u.id + ' 的差异位'" @click="prof.productId = u.id">{{ productName(u.id) }} +</button>
        </div>
      </section>

      <section class="card">
        <h2>组装执行（扣原料·入成品）</h2>
        <select v-model="run.productId">
          <option value="">选产品（须有差异位）…</option>
          <option v-for="pid in profileIds" :key="pid" :value="pid">{{ productName(pid) }}</option>
        </select>
        <!-- 组装规格：有 SKU 走下拉（换皮退成裸文本框·易与商品实际 SKU 不一致·拼错成品入错 spec）·无 SKU 退文本 -->
        <select v-if="runSkus.length" v-model="run.spec"><option value="">规格（可空）…</option><option v-for="s in runSkus" :key="s" :value="s">{{ s }}</option></select>
        <input v-else v-model="run.spec" placeholder="规格（可空）" />
        <input v-model.number="run.sets" type="number" min="1" placeholder="套数" />
        <div class="ops">
          <button class="btn-ghost" @click="doPreview">预演（只看不扣）</button>
          <button class="btn-warn" @click="doRun">{{ runConfirm ? (shortCount ? `有 ${shortCount} 项缺料·仍执行？` : '确认扣料入成品？') : '执行组装' }}</button>
        </div>
        <div v-if="preview.length" class="preview">
          <div class="pv-head"><span>料</span><span class="r">需</span><span class="r">存</span><span class="r">缺</span></div>
          <div v-for="l in preview" :key="l.materialId" class="pv-row" :class="{ short: l.short > 0 || l.missing }">
            <span>{{ materialHuman(l.materialId) }}{{ l.missing ? '（未建档）' : '' }}</span>
            <span class="r">{{ l.need }}</span><span class="r">{{ l.stock }}</span><span class="r">{{ l.short }}</span>
          </div>
        </div>
      </section>
    </div>

    <section class="table-card">
      <h2>组装记录</h2>
      <div class="table">
        <div class="thead"><span>单号</span><span>产品</span><span class="r">套数</span><span>操作者</span><span>时间</span><span>用料</span></div>
        <template v-for="a in assemblies" :key="a._id">
          <div class="trow">
            <span class="mono">{{ a._id }}</span>
            <span>{{ productName(a.productId) }}{{ a.spec ? '（' + a.spec + '）' : '' }}</span>
            <span class="r">{{ a.sets }}</span>
            <span class="muted">{{ a.operator }}</span>
            <span class="muted mono">{{ dateTime(a.at) }}</span>
            <span><button class="expand-btn" @click="expanded = expanded === a._id ? '' : a._id">{{ expanded === a._id ? '收起' : '展开' }}</button></span>
          </div>
          <div v-if="expanded === a._id" class="trow sub-row">
            <span class="consumed" :style="{ gridColumn: '1 / -1' }">扣料快照：{{ (a.consumedLines || []).map((l) => materialHuman(l.materialId) + '×' + l.qty).join(' · ') || '（无快照）' }}</span>
          </div>
        </template>
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
@media (max-width: 940px) {
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
h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
h3 {
  margin: 12px 0 7px;
  font-size: 12px;
  color: var(--ld-purple-meta);
}
.card input,
.card select {
  padding: 8px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 7px;
  background: var(--ld-bg);
}
.linerow {
  display: grid;
  grid-template-columns: 2fr 68px auto;
  gap: 6px;
  align-items: center;
}
.linerow input,
.linerow select {
  margin-bottom: 0;
}
.icon-x {
  width: 28px;
  height: 30px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 15px;
  cursor: pointer;
}
.icon-x:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 6px 0 2px;
  padding: 5px 12px;
  border: 1px dashed var(--ld-purple-line);
  border-radius: 999px;
  background: transparent;
  color: var(--ld-brand-active);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.ops {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.btn-primary {
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.btn-ghost {
  padding: 8px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.btn-warn {
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  background: var(--ld-red);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.prof-list {
  margin-top: 10px;
}
.prof-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-top: 1px solid var(--ld-line);
  font-size: 11.5px;
  font-family: var(--ld-font-mono);
  color: var(--ld-content-2);
  cursor: pointer;
  border-radius: 6px;
}
.prof-line:hover {
  background: var(--ld-bg-lilac);
}
.prof-line.on {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.prof-warn {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
  font-size: 10.5px;
  font-family: var(--ld-font);
}
.prof-empty {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--ld-content-2);
}
.unprof {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--ld-line);
}
.unprof h3 {
  margin: 0 0 7px;
  color: var(--ld-red);
}
.unprof-chip {
  display: inline-block;
  margin: 0 6px 6px 0;
  padding: 4px 11px;
  border: 1px solid var(--ld-red-line);
  border-radius: 999px;
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
  font-size: 11.5px;
  cursor: pointer;
}
.preview {
  margin-top: 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  overflow: hidden;
}
.pv-head,
.pv-row {
  display: grid;
  grid-template-columns: 2fr 0.7fr 0.7fr 0.7fr;
  gap: 8px;
  padding: 7px 12px;
}
.pv-head {
  background: var(--ld-bg-lilac);
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
.table {
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 1.6fr 1.6fr 0.7fr 1.1fr 1.4fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}
.trow.sub-row {
  display: block;
  padding: 8px 14px 10px;
  background: var(--ld-bg-lilac);
}
.consumed {
  font-size: 12px;
  color: var(--ld-content);
  font-family: var(--ld-font-mono);
  line-height: 1.5;
}
.expand-btn {
  padding: 3px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 11.5px;
  cursor: pointer;
}
.expand-btn:hover {
  border-color: var(--ld-purple-line);
  color: var(--ld-brand-active);
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
}
.muted {
  color: var(--ld-content-2);
}
</style>
