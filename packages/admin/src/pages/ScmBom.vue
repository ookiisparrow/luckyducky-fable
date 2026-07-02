<script setup>
/**
 * 配方模板（进销存车道 C·蓝图 docs/进销存ERP/ §4C）。业务定稿：所有产品构成几乎一致 → **全局一张模板**
 * （共用料行 + 三档毛线槽·带结仅最大团）+ 每产品三个填空（三档颜色 + 专属包装/卡片料号）。
 * 配方语义单源在云端 shared/scmBom resolveBom（门3）；本页只编排存取，校验云端一份说了算。
 */
import { ref, computed } from 'vue'
import { cloudMode, getBomSetup, saveBomTemplate, saveBomProfile, listMaterials, loadProducts } from '@/api/cloud.js'
import { toast } from '@/utils/ui.js'
import { RefreshCw, Plus, Trash2 } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import ScmFlowTabs from '@/components/ScmFlowTabs.vue'

const loading = ref(true)
const loadErr = ref('')
const materials = ref([])
const products = ref([])
const profiles = ref([])

const emptyCommon = () => ({ materialId: '', qtyPerSet: 1 })
const tpl = ref({ commonLines: [emptyCommon()], yarnSlots: [{ tier: 'L', form: 'knotted', qtyPerSet: 1 }, { tier: 'M', form: 'raw', qtyPerSet: 1 }, { tier: 'S', form: 'raw', qtyPerSet: 1 }] })
const hasSavedTpl = ref(false)

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const [setup, ms, ps] = await Promise.all([getBomSetup(), listMaterials(), loadProducts()])
    materials.value = ms
    products.value = ps.list || []
    profiles.value = setup.profiles
    if (setup.template) {
      tpl.value = { commonLines: setup.template.commonLines || [], yarnSlots: setup.template.yarnSlots || [] }
      hasSavedTpl.value = true
    }
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

// 共用料候选：非毛线主档（毛线走三档槽·颜色由各产品差异位定）
const commonCandidates = computed(() => materials.value.filter((m) => m.category !== 'yarn'))
const unitOf = (id) => (materials.value.find((m) => m._id === id)?.uom === 'gram' ? '克' : '件')
const packagingList = computed(() => materials.value.filter((m) => m.category === 'packaging'))
const cardList = computed(() => materials.value.filter((m) => m.category === 'card'))

const savingTpl = ref(false)
async function submitTemplate() {
  const t = tpl.value
  if (!t.commonLines.length || t.commonLines.some((l) => !l.materialId)) return toast('共用料每行都要选料号', 'err')
  if (!t.yarnSlots.length) return toast('至少要有一个毛线槽', 'err')
  savingTpl.value = true
  try {
    await saveBomTemplate({
      commonLines: t.commonLines.map((l) => ({ materialId: l.materialId, qtyPerSet: Number(l.qtyPerSet) })),
      yarnSlots: t.yarnSlots.map((s) => ({ tier: s.tier, form: s.form, qtyPerSet: Number(s.qtyPerSet) })),
    })
    hasSavedTpl.value = true
    toast('模板已保存（已执行过的组装单不受影响·历史快照不追新）')
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    savingTpl.value = false
  }
}

// ── 每产品差异位（三色 + 专属件）──
const profileOf = (pid) => profiles.value.find((p) => p._id === pid) || null
const pForm = ref(null) // { productId, yarnColors:{L,M,S}, packagingMaterialId, cardMaterialId }
function editProfile(p) {
  const cur = profileOf(p.id)
  pForm.value = {
    productId: p.id,
    name: p.name,
    yarnColors: { ...(cur?.yarnColors || { L: '', M: '', S: '' }) },
    // 专属件默认按料号命名契约预选 pkg:/card:<productId>（物料页建档即对上）
    packagingMaterialId: cur?.packagingMaterialId || (packagingList.value.find((m) => m._id === 'pkg:' + p.id) ? 'pkg:' + p.id : ''),
    cardMaterialId: cur?.cardMaterialId || (cardList.value.find((m) => m._id === 'card:' + p.id) ? 'card:' + p.id : ''),
  }
}
const savingProfile = ref(false)
async function submitProfile() {
  const f = pForm.value
  savingProfile.value = true
  try {
    await saveBomProfile({ productId: f.productId, yarnColors: f.yarnColors, packagingMaterialId: f.packagingMaterialId, cardMaterialId: f.cardMaterialId })
    toast('差异位已保存')
    pForm.value = null
    const setup = await getBomSetup()
    profiles.value = setup.profiles
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    savingProfile.value = false
  }
}
</script>

<template>
  <div>
    <ScmFlowTabs />
    <header class="head">
      <div>
        <h1>配方模板</h1>
        <p class="sub">全局一张模板（共用料 + 三档毛线槽·带结仅最大团）· 每产品只填三处：三档颜色 + 专属包装/卡片 · 打包按「模板×差异位×套数」扣料</p>
      </div>
      <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">配方管理需云端模式（配置 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <Skeleton v-else-if="loading" class="card" :rows="6" />

    <template v-else>
      <!-- 全局模板 -->
      <div class="card form">
        <h2>全局模板 <span v-if="!hasSavedTpl" class="chip warn">还没保存过</span></h2>
        <p class="hint inset-0">共用料＝每套都放的东西（填充棉/钩针/眼睛…·数量按主档计量单位）；毛线槽只定「档位×形态×团数」，颜色在下方按产品填。</p>
        <div class="grid-head"><span class="g-mat">共用料</span><span class="g-qty">每套用量</span><span class="g-op"></span></div>
        <div v-for="(l, i) in tpl.commonLines" :key="i" class="grid-row">
          <select v-model="l.materialId" class="g-mat">
            <option value="">选料号…</option>
            <option v-for="m in commonCandidates" :key="m._id" :value="m._id">{{ m.name }}（{{ m._id }}）</option>
          </select>
          <span class="g-qty"><input v-model.number="l.qtyPerSet" type="number" min="1" /> {{ l.materialId ? unitOf(l.materialId) : '' }}</span>
          <span class="g-op"><button class="btn ghost mini" @click="tpl.commonLines.splice(i, 1)"><Trash2 :size="13" /></button></span>
        </div>
        <button class="btn ghost mini add" @click="tpl.commonLines.push(emptyCommon())"><Plus :size="13" />加一行共用料</button>

        <div class="grid-head yarn"><span class="g-mat">毛线槽</span><span class="g-qty">每套团数</span><span class="g-op"></span></div>
        <div v-for="(s, i) in tpl.yarnSlots" :key="'y' + i" class="grid-row">
          <span class="g-mat slot">
            <select v-model="s.tier"><option value="L">大团</option><option value="M">中团</option><option value="S">小团</option></select>
            <select v-model="s.form"><option value="raw">原团</option><option v-if="s.tier === 'L'" value="knotted">带结（仅大团）</option></select>
          </span>
          <span class="g-qty"><input v-model.number="s.qtyPerSet" type="number" min="1" /> 团</span>
          <span class="g-op"><button class="btn ghost mini" @click="tpl.yarnSlots.splice(i, 1)"><Trash2 :size="13" /></button></span>
        </div>
        <button class="btn ghost mini add" @click="tpl.yarnSlots.push({ tier: 'M', form: 'raw', qtyPerSet: 1 })"><Plus :size="13" />加一个毛线槽</button>

        <div class="actions"><button class="btn" :disabled="savingTpl" @click="submitTemplate">保存模板</button></div>
        <p class="hint inset-0">改模板只影响之后的打包；已执行的组装单存的是当时快照、不追新。</p>
      </div>

      <!-- 每产品差异位 -->
      <div class="card">
        <div class="row hrow"><span class="c-name">产品</span><span class="c-colors">三档颜色（大/中/小）</span><span class="c-mat">专属包装</span><span class="c-mat">专属卡片</span><span class="c-op">操作</span></div>
        <p v-if="!products.length" class="hint inset">还没有产品——先在「商品」建品，再回来填差异位。</p>
        <div v-for="p in products" :key="p.id" class="row">
          <span class="c-name"><b>{{ p.name || p.id }}</b></span>
          <template v-if="profileOf(p.id)">
            <span class="c-colors mono">{{ profileOf(p.id).yarnColors.L }} / {{ profileOf(p.id).yarnColors.M }} / {{ profileOf(p.id).yarnColors.S }}</span>
            <span class="c-mat mono">{{ profileOf(p.id).packagingMaterialId }}</span>
            <span class="c-mat mono">{{ profileOf(p.id).cardMaterialId }}</span>
          </template>
          <template v-else>
            <span class="c-colors dim">未填（打包前必填）</span><span class="c-mat dim">—</span><span class="c-mat dim">—</span>
          </template>
          <span class="c-op"><button class="btn ghost mini" @click="editProfile(p)">{{ profileOf(p.id) ? '改' : '填' }}</button></span>
        </div>
      </div>

      <div v-if="pForm" class="card form">
        <h2>差异位 · {{ pForm.name || pForm.productId }}</h2>
        <div class="frow">
          <label>大团颜色 <input v-model="pForm.yarnColors.L" placeholder="小写英文，如 yellow" /></label>
          <label>中团颜色 <input v-model="pForm.yarnColors.M" placeholder="如 white" /></label>
          <label>小团颜色 <input v-model="pForm.yarnColors.S" placeholder="如 orange" /></label>
          <label>专属包装
            <select v-model="pForm.packagingMaterialId"><option value="">选包装料号…</option><option v-for="m in packagingList" :key="m._id" :value="m._id">{{ m.name }}（{{ m._id }}）</option></select>
          </label>
          <label>专属卡片
            <select v-model="pForm.cardMaterialId"><option value="">选卡片料号…</option><option v-for="m in cardList" :key="m._id" :value="m._id">{{ m.name }}（{{ m._id }}）</option></select>
          </label>
          <button class="btn" :disabled="savingProfile" @click="submitProfile">保存差异位</button>
          <button class="btn ghost" @click="pForm = null">取消</button>
        </div>
        <p class="hint inset-0">颜色写小写英文（与毛线建档一致）；对应的毛线料号（如 yarn:yellow:L:knotted）要先在物料页建档，打包时才有账可扣。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
h1 { font-size: 22px; color: var(--ink); margin: 0 0 5px; }
h2 { font-size: 14px; color: var(--ink); margin: 0 0 12px; display: flex; gap: 8px; align-items: center; }
.sub { margin: 0; font-size: 12.5px; color: var(--content-2); }
.card { background: var(--white); border: 1px solid var(--line); border-radius: 13px; overflow: hidden; margin-bottom: 18px; }
.card.form { padding: 16px 18px; }
.row { display: flex; align-items: center; gap: 14px; padding: 12px 18px; font-size: 12.5px; }
.row + .row { border-top: 1px solid var(--line); }
.hrow { background: var(--bg-lilac); font-size: 11.5px; font-weight: 600; color: var(--content-2); }
.c-name { flex: 1; min-width: 0; color: var(--content); }
.c-name b { color: var(--ink); }
.c-colors { width: 200px; color: var(--content); }
.c-mat { width: 160px; color: var(--content-2); }
.c-op { width: 60px; }
.dim { color: var(--content-2); }
.mono { font-family: ui-monospace, monospace; font-size: 11.5px; }
.chip { padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.chip.warn { background: #fdf6ec; color: #8a6420; }
.grid-head { display: flex; gap: 10px; font-size: 11.5px; font-weight: 600; color: var(--content-2); margin: 12px 0 6px; }
.grid-head.yarn { margin-top: 18px; }
.grid-row { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
.g-mat { flex: 1; display: flex; gap: 8px; }
.g-qty { width: 150px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--content-2); }
.g-qty input { width: 76px; }
.g-op { width: 40px; }
select, input { border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; color: var(--ink); background: var(--white); }
.g-mat select { flex: 1; min-width: 0; }
.btn.mini { padding: 5px 12px; font-size: 11.5px; }
.btn.add { margin-top: 2px; }
.actions { margin-top: 14px; }
.frow { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.frow label { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: var(--content-2); }
.frow input, .frow select { min-width: 150px; }
.hint { padding: 10px 14px; border-radius: 10px; background: var(--bg-lilac); border: 1px solid var(--purple-line); font-size: 11.5px; }
.hint.inset { margin: 12px 18px; }
.hint.inset-0 { margin: 0 0 12px; }
.hint.warn { border-color: #f0c8c5; background: #fdf0ef; color: var(--red); }
</style>
