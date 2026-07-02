<script setup>
/**
 * 打包组装（进销存车道 C·蓝图 docs/进销存ERP/ §4C）。选产品×规格×套数 → 预演（云端 resolveBom×库存对照·
 * 只读）→ 确认执行（云端：快照冻结→门1 扣原料→门4 入成品·assemblyId 幂等·料不足整单回滚不动账）。
 * 撤销无逆向流转：打错了去「物料与供应商」用调整单对平（蓝图定稿）。
 */
import { ref, computed } from 'vue'
import { cloudMode, previewAssembly, runAssembly, listAssemblies, getBomSetup, loadProducts } from '@/api/cloud.js'
import { confirmDialog, toast } from '@/utils/ui.js'
import { RefreshCw } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'

const loading = ref(true)
const loadErr = ref('')
const products = ref([])
const profiles = ref([])
const orders = ref([])

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const [ps, setup, list] = await Promise.all([loadProducts(), getBomSetup(), listAssemblies(50)])
    products.value = ps.list || []
    profiles.value = setup.profiles
    orders.value = list
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

const hasProfile = (pid) => profiles.value.some((p) => p._id === pid)
const form = ref({ productId: '', spec: '', sets: 10 })
const curProduct = computed(() => products.value.find((p) => p.id === form.value.productId) || null)
const specOptions = computed(() => (curProduct.value?.skus || []).map((s) => s.name).filter(Boolean))
const productName = (pid) => products.value.find((p) => p.id === pid)?.name || pid

// ── 预演（只读·换产品/套数后须重新预演才能执行）──
const preview = ref(null) // [{materialId,name,uom,need,stock,short,missing}]
const previewing = ref(false)
const shortCount = computed(() => (preview.value || []).filter((l) => l.short > 0 || l.missing).length)
async function doPreview() {
  const f = form.value
  if (!f.productId) return toast('先选产品', 'err')
  if (!Number.isInteger(Number(f.sets)) || Number(f.sets) <= 0) return toast('套数必须是正整数', 'err')
  previewing.value = true
  try {
    preview.value = await previewAssembly(f.productId, Number(f.sets))
  } catch (e) {
    preview.value = null
    toast(e.message, 'err')
  } finally {
    previewing.value = false
  }
}
function resetPreview() {
  preview.value = null
}

// ── 执行（assemblyId 一次生成·重试复用＝幂等；成功后清预演）──
const running = ref(false)
let pendingAssemblyId = ''
async function doRun() {
  const f = form.value
  if (!preview.value) return toast('先点「预演」看看扣什么料', 'err')
  const label = `${productName(f.productId)}${f.spec ? '·' + f.spec : ''} × ${f.sets} 套`
  const warn = shortCount.value ? `\n⚠️ 有 ${shortCount.value} 项缺料，执行会被整单拒绝（不动账）。` : ''
  if (!(await confirmDialog({ title: '确认打包', message: `按当前模板扣原料、入成品：${label}${warn}` }))) return
  running.value = true
  if (!pendingAssemblyId) pendingAssemblyId = (crypto.randomUUID && crypto.randomUUID()) || 'asm-' + Date.now()
  try {
    await runAssembly(pendingAssemblyId, f.productId, f.spec, Number(f.sets))
    toast(`已打包 ${label}·原料已扣、成品已入账`)
    pendingAssemblyId = '' // 成功才换新幂等键；失败保留供重试（重放被云端幂等挡）
    preview.value = null
    await init()
  } catch (e) {
    if (e.materialId) toast(`${e.message}（短缺：${e.materialId}）`, 'err')
    else toast(e.message, 'err')
    if (String(e.message).includes('已经执行过')) pendingAssemblyId = ''
  } finally {
    running.value = false
  }
}

const expanded = ref('')
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—')
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>打包组装</h1>
        <p class="sub">产品 × 套数 → 预演用料 → 执行（扣原料·入成品·全程流水留痕）· 料不足整单拒绝不动账 · 打错走物料页调整单</p>
      </div>
      <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">打包组装需云端模式（配置 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <Skeleton v-else-if="loading" class="card" :rows="6" />

    <template v-else>
      <div class="card form">
        <h2>这批打什么</h2>
        <div class="frow">
          <label>产品
            <select v-model="form.productId" @change="resetPreview">
              <option value="">选产品…</option>
              <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name || p.id }}{{ hasProfile(p.id) ? '' : '（差异位未填）' }}</option>
            </select>
          </label>
          <label>规格
            <select v-if="specOptions.length" v-model="form.spec" @change="resetPreview">
              <option value="">（无规格）</option>
              <option v-for="s in specOptions" :key="s" :value="s">{{ s }}</option>
            </select>
            <input v-else v-model="form.spec" placeholder="可留空" @input="resetPreview" />
          </label>
          <label>套数 <input v-model.number="form.sets" type="number" min="1" @input="resetPreview" /></label>
          <button class="btn ghost" :disabled="previewing" @click="doPreview">预演</button>
          <button class="btn" :disabled="running || !preview" @click="doRun">确认打包</button>
        </div>
        <p v-if="form.productId && !hasProfile(form.productId)" class="hint inset-0">这个产品还没填差异位——先去「配方模板」页补，否则预演/执行会被拒。</p>
      </div>

      <div v-if="preview" class="card">
        <div class="row hrow">
          <span class="c-id">料号</span><span class="c-name">名称</span><span class="c-num">要扣</span><span class="c-num">现库存</span><span class="c-num">缺口</span>
        </div>
        <div v-for="l in preview" :key="l.materialId" class="row" :class="{ bad: l.short > 0 || l.missing }">
          <span class="c-id mono">{{ l.materialId }}</span>
          <span class="c-name">{{ l.name }}<em v-if="l.missing">（未建档）</em></span>
          <span class="c-num">{{ l.need }} {{ l.uom === 'gram' ? '克' : '件' }}</span>
          <span class="c-num">{{ l.stock }}</span>
          <span class="c-num"><b v-if="l.short > 0">缺 {{ l.short }}</b><span v-else>够</span></span>
        </div>
        <p class="hint inset" :class="{ warnText: shortCount }">
          {{ shortCount ? `有 ${shortCount} 项不够：先采购/收带结/调整入账，或减套数。` : '全部够扣——可以执行。' }}
        </p>
      </div>

      <!-- 组装单（历史快照·不追新） -->
      <div class="card">
        <div class="row hrow">
          <span class="c-id">单号</span><span class="c-name">产品</span><span class="c-num">套数</span><span class="c-name">时间 / 操作者</span><span class="c-op">用料</span>
        </div>
        <p v-if="!orders.length" class="hint inset">还没打过包。</p>
        <template v-for="o in orders" :key="o._id">
          <div class="row">
            <span class="c-id mono">{{ o._id }}</span>
            <span class="c-name"><b>{{ productName(o.productId) }}</b>{{ o.spec ? '·' + o.spec : '' }}</span>
            <span class="c-num">{{ o.sets }}</span>
            <span class="c-name">{{ fmtTime(o.at) }} · {{ o.operator || '—' }}</span>
            <span class="c-op"><button class="btn ghost mini" @click="expanded = expanded === o._id ? '' : o._id">{{ expanded === o._id ? '收起' : '展开' }}</button></span>
          </div>
          <div v-if="expanded === o._id" class="row sub-row">
            <span class="c-name mono">{{ (o.consumedLines || []).map((l) => `${l.materialId}×${l.qty}`).join(' · ') }}</span>
          </div>
        </template>
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
.row.bad { background: #fdf6f5; }
.row.sub-row { background: var(--bg-lilac); }
.hrow { background: var(--bg-lilac); font-size: 11.5px; font-weight: 600; color: var(--content-2); }
.c-id { width: 220px; color: var(--content-2); }
.c-name { flex: 1; min-width: 0; color: var(--content); }
.c-name b { color: var(--ink); }
.c-name em { font-style: normal; color: var(--red); font-size: 11px; }
.c-num { width: 90px; color: var(--content); }
.c-num b { color: var(--red); }
.c-op { width: 70px; }
.mono { font-family: ui-monospace, monospace; font-size: 11.5px; }
.frow { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.frow label { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: var(--content-2); }
.frow input, .frow select { border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; color: var(--ink); background: var(--white); min-width: 140px; }
.btn.mini { padding: 5px 12px; font-size: 11.5px; }
.hint { padding: 10px 14px; border-radius: 10px; background: var(--bg-lilac); border: 1px solid var(--purple-line); font-size: 11.5px; }
.hint.inset { margin: 12px 18px; }
.hint.inset-0 { margin: 12px 0 0; }
.hint.warn { border-color: #f0c8c5; background: #fdf0ef; color: var(--red); }
.hint.warnText { color: #8a6420; }
</style>
