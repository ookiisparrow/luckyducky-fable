<script setup>
/**
 * 物料与供应商（进销存 SCM-0 地基·蓝图 docs/进销存ERP/）。原料账主档：建档（毛线=颜色×量级×形态·
 * 带结仅最大团；专属件挂产品；辅料 slug）、期初盘点/调整（必留因·流水留痕）、供应商/织女档案、流水查账。
 * 库存/主档写全部收口云端 kit/scmStock（门1·守卫 material-stock-single-seam）；本页只编排。
 */
import { ref, computed } from 'vue'
import { cloudMode, listMaterials, saveMaterial, listSuppliers, saveSupplier, adjustMaterialStock, listLedger } from '@/api/cloud.js'
import { promptDialog, toast } from '@/utils/ui.js'
import { RefreshCw } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import ScmFlowTabs from '@/components/ScmFlowTabs.vue'

const loading = ref(true)
const loadErr = ref('')
const materials = ref([])
const suppliers = ref([])
const busy = ref('')

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const [ms, ss] = await Promise.all([listMaterials(), listSuppliers()])
    materials.value = ms
    suppliers.value = ss
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

const CAT = { yarn: '毛线', packaging: '外包装', card: '激活卡片', accessory: '辅料' }
const UOM = { count: '按件', gram: '按克' }
const TIER = { L: '大团', M: '中团', S: '小团' }
const FORM = { raw: '原团', knotted: '带结' }
const supplierName = (id) => suppliers.value.find((s) => s._id === id)?.name || '—'

// ── 建档表单（category 决定料号成分）──
const mForm = ref({ category: 'yarn', name: '', uom: 'count', color: '', tier: 'L', form: 'raw', productId: '', slug: '', supplierId: '', threshold: 0 })
const savingMat = ref(false)
async function submitMaterial() {
  if (!mForm.value.name.trim()) return toast('请填物料名称', 'err')
  savingMat.value = true
  try {
    const f = mForm.value
    await saveMaterial({
      name: f.name.trim(),
      category: f.category,
      uom: f.category === 'yarn' ? 'count' : f.uom, // 毛线按团数记账（用户拍板）
      color: f.color.trim(),
      tier: f.tier,
      form: f.form,
      productId: f.productId.trim(),
      slug: f.slug.trim(),
      supplierId: f.supplierId,
      threshold: Number(f.threshold) || 0,
    })
    toast('已保存物料档案')
    mForm.value = { ...mForm.value, name: '', color: '', productId: '', slug: '' }
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    savingMat.value = false
  }
}

// ── 期初盘点/调整（两步 prompt：数量 → 原因；adjustId 一次生成·重试复用＝幂等）──
async function adjust(m) {
  const unit = m.uom === 'gram' ? '克' : '件'
  const v = await promptDialog({
    title: '期初盘点 / 调整',
    message: `${m.name}（${m._id}）\n当前 ${m.stock ?? 0} ${unit}。输入增减数量（如 200 或 -5）：`,
    placeholder: `± 整数（${unit}）`,
  })
  if (v === null) return
  const delta = parseInt(v.trim(), 10)
  if (!Number.isInteger(delta) || delta === 0 || String(delta) !== v.trim()) return toast('请输入非零整数', 'err')
  const reason = await promptDialog({ title: '调整原因', message: '必填·写进流水留痕（如「期初盘点」「运输破损」）：', placeholder: '原因' })
  if (reason === null) return
  busy.value = m._id
  try {
    await adjustMaterialStock(m._id, delta, reason.trim(), (crypto.randomUUID && crypto.randomUUID()) || 'adj-' + Date.now())
    toast('已入账')
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    busy.value = ''
  }
}

// ── 流水查账（点行「流水」按料号过滤）──
const ledgerRows = ref([])
const ledgerFor = ref('')
async function showLedger(m) {
  ledgerFor.value = m ? `${m.name}（${m._id}）` : '全部'
  try {
    ledgerRows.value = await listLedger(m ? m._id : undefined, 50)
  } catch (e) {
    toast(e.message, 'err')
  }
}
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—')

// ── 供应商/织女 ──
const sForm = ref({ supplierId: '', name: '', type: 'factory', contact: '', note: '' })
const savingSup = ref(false)
function editSupplier(s) {
  sForm.value = { supplierId: s._id, name: s.name, type: s.type, contact: s.contact || '', note: s.note || '' }
}
async function submitSupplier() {
  if (!sForm.value.name.trim()) return toast('请填名称', 'err')
  savingSup.value = true
  try {
    await saveSupplier({ ...sForm.value, name: sForm.value.name.trim() })
    toast('已保存')
    sForm.value = { supplierId: '', name: '', type: 'factory', contact: '', note: '' }
    await init()
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    savingSup.value = false
  }
}

const matRows = computed(() =>
  [...materials.value].sort((a, b) => (a.category === b.category ? String(a._id).localeCompare(String(b._id)) : String(a.category).localeCompare(String(b.category))))
)
</script>

<template>
  <div>
    <ScmFlowTabs />
    <header class="head">
      <div>
        <h1>物料与供应商</h1>
        <p class="sub">原料账主档 · 期初盘点/调整必留因（流水可查）· 毛线＝颜色×量级×形态（带结仅最大团）· 每笔出入都有流水</p>
      </div>
      <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">物料管理需云端模式（配置 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <Skeleton v-else-if="loading" class="card" :rows="6" />

    <template v-else>
      <!-- 物料主档 -->
      <div class="card">
        <div class="row hrow">
          <span class="c-id">料号</span><span class="c-name">名称</span><span class="c-cat">类别</span><span class="c-uom">计量</span><span class="c-stock">库存</span><span class="c-sup">供应商</span><span class="c-op">操作</span>
        </div>
        <p v-if="!matRows.length" class="hint inset">还没有物料档案——先在下方建档，再做「期初盘点」把现有实物入账。</p>
        <div v-for="m in matRows" :key="m._id" class="row">
          <span class="c-id mono">{{ m._id }}</span>
          <span class="c-name"><b>{{ m.name }}</b></span>
          <span class="c-cat">{{ CAT[m.category] || m.category }}</span>
          <span class="c-uom">{{ UOM[m.uom] || m.uom }}</span>
          <span class="c-stock">
            <b :class="{ low: m.threshold && m.stock <= m.threshold }">{{ m.stock ?? 0 }}</b> {{ m.uom === 'gram' ? '克' : '件' }}
            <em v-if="m.threshold && m.stock <= m.threshold"> · 低于 {{ m.threshold }}</em>
          </span>
          <span class="c-sup">{{ supplierName(m.supplierId) }}</span>
          <span class="c-op">
            <button class="btn ghost mini" :disabled="busy === m._id" @click="adjust(m)">调整</button>
            <button class="btn ghost mini" @click="showLedger(m)">流水</button>
          </span>
        </div>
      </div>

      <!-- 建档 -->
      <div class="card form">
        <h2>建物料档案</h2>
        <div class="frow">
          <label>类别
            <select v-model="mForm.category">
              <option value="yarn">毛线</option><option value="packaging">外包装</option><option value="card">激活卡片</option><option value="accessory">辅料</option>
            </select>
          </label>
          <label>名称 <input v-model="mForm.name" placeholder="如：红色大团（带结）" /></label>
          <label v-if="mForm.category !== 'yarn'">计量
            <select v-model="mForm.uom"><option value="count">按件</option><option value="gram">按克</option></select>
          </label>
          <template v-if="mForm.category === 'yarn'">
            <label>颜色 <input v-model="mForm.color" placeholder="小写英文，如 red" /></label>
            <label>量级
              <select v-model="mForm.tier"><option value="L">大团</option><option value="M">中团</option><option value="S">小团</option></select>
            </label>
            <label>形态
              <select v-model="mForm.form"><option value="raw">原团</option><option v-if="mForm.tier === 'L'" value="knotted">带结（仅大团）</option></select>
            </label>
          </template>
          <label v-else-if="mForm.category === 'packaging' || mForm.category === 'card'">所属产品 ID <input v-model="mForm.productId" placeholder="产品 id" /></label>
          <label v-else>料号名 <input v-model="mForm.slug" placeholder="小写英文，如 marker" /></label>
          <label>供应商
            <select v-model="mForm.supplierId"><option value="">（暂不挂）</option><option v-for="s in suppliers" :key="s._id" :value="s._id">{{ s.name }}</option></select>
          </label>
          <label>安全库存 <input v-model.number="mForm.threshold" type="number" min="0" /></label>
          <button class="btn" :disabled="savingMat" @click="submitMaterial">保存档案</button>
        </div>
        <p class="hint inset">计量方式建档后锁死（防两种单位混账）；毛线固定按团数计。库存不在这里改——用行内「调整」入账留痕。</p>
      </div>

      <!-- 流水 -->
      <div v-if="ledgerFor" class="card">
        <div class="row hrow"><span class="c-name">流水 · {{ ledgerFor }}</span><span class="c-op"><button class="btn ghost mini" @click="ledgerFor = ''">收起</button></span></div>
        <p v-if="!ledgerRows.length" class="hint inset">暂无流水</p>
        <div v-for="l in ledgerRows" :key="l._id" class="row">
          <span class="c-id mono">{{ l._id }}</span>
          <span class="c-cat" :class="l.delta > 0 ? 'in' : 'out'">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</span>
          <span class="c-sup">{{ l.reason || l.docType }}</span>
          <span class="c-name">{{ l.operator || '—' }} · {{ fmtTime(l.at) }}</span>
        </div>
      </div>

      <!-- 供应商/织女 -->
      <div class="card">
        <div class="row hrow">
          <span class="c-name">供应商 / 织女</span><span class="c-cat">类型</span><span class="c-sup">联系</span><span class="c-name">备注</span><span class="c-op">操作</span>
        </div>
        <p v-if="!suppliers.length" class="hint inset">还没有往来单位——纺织厂/包装厂/印刷厂/钩针厂/辅料商建「厂家」，织女每人一档建「织女」。</p>
        <div v-for="s in suppliers" :key="s._id" class="row">
          <span class="c-name"><b>{{ s.name }}</b></span>
          <span class="c-cat"><span class="chip" :class="s.type === 'outworker' ? 'warn' : 'green'">{{ s.type === 'outworker' ? '织女' : '厂家' }}</span></span>
          <span class="c-sup">{{ s.contact || '—' }}</span>
          <span class="c-name">{{ s.note || '—' }}</span>
          <span class="c-op"><button class="btn ghost mini" @click="editSupplier(s)">编辑</button></span>
        </div>
      </div>
      <div class="card form">
        <h2>{{ sForm.supplierId ? '编辑往来单位' : '建往来单位' }}</h2>
        <div class="frow">
          <label>名称 <input v-model="sForm.name" placeholder="如：XX 纺织厂 / 张织女" /></label>
          <label>类型
            <select v-model="sForm.type"><option value="factory">厂家</option><option value="outworker">织女（外协）</option></select>
          </label>
          <label>联系 <input v-model="sForm.contact" placeholder="电话/微信" /></label>
          <label>备注 <input v-model="sForm.note" /></label>
          <button class="btn" :disabled="savingSup" @click="submitSupplier">{{ sForm.supplierId ? '保存修改' : '新建' }}</button>
          <button v-if="sForm.supplierId" class="btn ghost" @click="sForm = { supplierId: '', name: '', type: 'factory', contact: '', note: '' }">取消编辑</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
h1 { font-size: 22px; color: var(--ink); margin: 0 0 5px; }
h2 { font-size: 14px; color: var(--ink); margin: 0 0 12px; }
.sub { margin: 0; font-size: 12.5px; color: var(--content-2); }
.card { background: var(--white); border: 1px solid var(--line); border-radius: 13px; overflow: hidden; margin-bottom: 18px; }
.card.form { padding: 16px 18px; }
.row { display: flex; align-items: center; gap: 14px; padding: 12px 18px; font-size: 12.5px; }
.row + .row { border-top: 1px solid var(--line); }
.hrow { background: var(--bg-lilac); font-size: 11.5px; font-weight: 600; color: var(--content-2); }
.c-id { width: 190px; color: var(--content-2); }
.c-name { flex: 1; min-width: 0; color: var(--content); }
.c-name b { color: var(--ink); }
.c-cat { width: 84px; color: var(--content-2); }
.c-cat.in { color: #3f8c5e; font-weight: 600; }
.c-cat.out { color: var(--red); font-weight: 600; }
.c-uom { width: 60px; color: var(--content-2); }
.c-stock { width: 150px; color: var(--content-2); }
.c-stock b { font-size: 15px; color: var(--ink); }
.c-stock b.low { color: #b8801f; }
.c-stock em { font-style: normal; color: #b8801f; font-size: 11px; }
.c-sup { width: 130px; color: var(--content-2); }
.c-op { width: 118px; display: flex; gap: 6px; }
.mono { font-family: ui-monospace, monospace; font-size: 11.5px; }
.chip { padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.chip.green { background: #e8f3ec; color: #3f8c5e; }
.chip.warn { background: #fdf6ec; color: #8a6420; }
.btn.mini { padding: 5px 12px; font-size: 11.5px; }
.frow { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.frow label { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: var(--content-2); }
.frow input, .frow select { border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; color: var(--ink); background: var(--white); min-width: 130px; }
.hint { padding: 10px 14px; border-radius: 10px; background: var(--bg-lilac); border: 1px solid var(--purple-line); font-size: 11.5px; }
.hint.inset { margin: 12px 18px; }
.hint.warn { border-color: #f0c8c5; background: #fdf0ef; color: var(--red); }
</style>
