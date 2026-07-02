<script setup>
/**
 * 备货计算（进销存车道 D·蓝图 docs/进销存ERP/ §4D）。只读计算器：填「各产品目标套数」→ 云端按
 * 配方展开用料、对比库存 → 给两张缺口清单：① 外协缺口（缺带结＝该给织女发多少同色大团原团）
 * ② 采购缺口（按供应商分列·够扣的不出行）。不动任何账——照单去开采购单/外协单。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { cloudMode, getRestockPlan, loadProducts } from '@/api/cloud.js'
import { toast } from '@/utils/ui.js'
import { setPurchaseHandoff, setOutworkHandoff } from '@/store/scmHandoff.js'
import { RefreshCw, Plus, Trash2, ArrowRight } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import ScmFlowTabs from '@/components/ScmFlowTabs.vue'

const router = useRouter()

const loading = ref(true)
const loadErr = ref('')
const products = ref([])

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const ps = await loadProducts()
    products.value = ps.list || []
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

const productName = (pid) => products.value.find((p) => p.id === pid)?.name || pid
const targets = ref([{ productId: '', sets: 50 }])
const plan = ref(null)
const computing = ref(false)

async function compute() {
  const rows = targets.value.filter((t) => t.productId)
  if (!rows.length) return toast('至少选一个产品', 'err')
  if (rows.some((t) => !Number.isInteger(Number(t.sets)) || Number(t.sets) <= 0)) return toast('套数必须是正整数', 'err')
  computing.value = true
  try {
    plan.value = await getRestockPlan(rows.map((t) => ({ productId: t.productId, sets: Number(t.sets) })))
  } catch (e) {
    plan.value = null
    toast(e.productId ? `${e.message}（产品：${productName(e.productId)}）` : e.message, 'err')
  } finally {
    computing.value = false
  }
}

// ── 联动开单：算完缺口直接带数据跳过去，不用手抄颜色/物料/数量（用户反馈「使用流程割裂」）──
function goOutworkOrder() {
  setOutworkHandoff({ lines: plan.value.outworkGaps.map((g) => ({ materialId: `yarn:${g.color}:L:raw`, qty: g.rawToIssue })) })
  router.push('/scm-outwork')
}
function goPurchaseOrder(group) {
  setPurchaseHandoff({ supplierId: group.supplierId, lines: group.lines.map((l) => ({ materialId: l.materialId, qty: l.gap })) })
  router.push('/scm-purchase')
}
</script>

<template>
  <div>
    <ScmFlowTabs />
    <header class="head">
      <div>
        <h1>备货计算</h1>
        <p class="sub">目标套数 → 按配方算用料、对库存 → 外协缺口（该发织女多少原团）+ 采购缺口（按供应商分列）· 只算不动账</p>
      </div>
      <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">备货计算需云端模式（配置 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <Skeleton v-else-if="loading" class="card" :rows="4" />

    <template v-else>
      <div class="card form">
        <h2>要备多少</h2>
        <div v-for="(t, i) in targets" :key="i" class="trow">
          <select v-model="t.productId">
            <option value="">选产品…</option>
            <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name || p.id }}</option>
          </select>
          <input v-model.number="t.sets" type="number" min="1" /> 套
          <button class="btn ghost mini" @click="targets.splice(i, 1)"><Trash2 :size="13" /></button>
        </div>
        <div class="actions">
          <button class="btn ghost mini" @click="targets.push({ productId: '', sets: 50 })"><Plus :size="13" />加产品</button>
          <button class="btn" :disabled="computing" @click="compute">算缺口</button>
        </div>
      </div>

      <template v-if="plan">
        <!-- 外协缺口 -->
        <div class="card">
          <div class="row hrow"><span class="c-name">外协缺口（带结不外购·发原团给织女织）</span><span class="c-num">需带结</span><span class="c-num">现库存</span><span class="c-num">缺</span><span class="c-num strong">应发原团</span></div>
          <p v-if="!plan.outworkGaps.length" class="hint inset">带结团都够——不用发外协。</p>
          <div v-for="g in plan.outworkGaps" :key="g.color" class="row">
            <span class="c-name"><b>{{ g.color }}</b> 大团</span>
            <span class="c-num">{{ g.knottedNeed }}</span>
            <span class="c-num">{{ g.knottedStock }}</span>
            <span class="c-num"><b class="red">{{ g.gap }}</b></span>
            <span class="c-num strong"><b>{{ g.rawToIssue }} 团</b></span>
          </div>
          <p v-if="plan.outworkGaps.length" class="hint inset">
            照这个数去「外协加工」开单发料（发出去的原团已叠进下方采购口径）。
            <button class="btn ghost mini" @click="goOutworkOrder">去外协加工开单 <ArrowRight :size="12" /></button>
          </p>
        </div>

        <!-- 采购缺口（按供应商分列） -->
        <div class="card">
          <div class="row hrow"><span class="c-name">采购缺口（够扣的不列）</span><span class="c-num">要用</span><span class="c-num">现库存</span><span class="c-num">缺</span></div>
          <p v-if="!plan.purchaseGroups.length" class="hint inset">原料都够——不用采购。</p>
          <template v-for="g in plan.purchaseGroups" :key="g.supplierId || 'none'">
            <div class="row group">
              <span class="c-name"><b>{{ g.supplierName }}</b></span><span class="c-num" /><span class="c-num" /><span class="c-num" />
              <button v-if="g.supplierId" class="btn ghost mini" @click="goPurchaseOrder(g)">去采购管理开单 <ArrowRight :size="12" /></button>
            </div>
            <div v-for="l in g.lines" :key="l.materialId" class="row">
              <span class="c-name">{{ l.name }} <span class="mono dim">{{ l.materialId }}</span><em v-if="l.missing">（未建档）</em></span>
              <span class="c-num">{{ l.need }} {{ l.uom === 'gram' ? '克' : '件' }}</span>
              <span class="c-num">{{ l.stock }}</span>
              <span class="c-num"><b class="red">{{ l.gap }}</b></span>
            </div>
          </template>
          <p v-if="plan.missingMaterials.length" class="hint inset warnText">有料号还没建档：{{ plan.missingMaterials.join('、') }}——先去「物料与供应商」建档挂供应商，缺口才有归属。</p>
          <p v-else-if="plan.purchaseGroups.length" class="hint inset">照供应商分组去「采购管理」逐家开单。</p>
        </div>
      </template>
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
.row.group { background: var(--bg-lilac); }
.hrow { background: var(--bg-lilac); font-size: 11.5px; font-weight: 600; color: var(--content-2); }
.c-name { flex: 1; min-width: 0; color: var(--content); }
.c-name b { color: var(--ink); }
.c-name em { font-style: normal; color: var(--red); font-size: 11px; }
.c-num { width: 110px; color: var(--content); }
.c-num.strong b { color: var(--ink); font-size: 14px; }
.red { color: var(--red); }
.mono { font-family: ui-monospace, monospace; font-size: 11px; }
.dim { color: var(--content-2); }
.trow { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; font-size: 12px; color: var(--content-2); }
.trow select { flex: 1; max-width: 320px; }
.trow input { width: 90px; }
select, input { border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; color: var(--ink); background: var(--white); }
.actions { display: flex; gap: 10px; margin-top: 6px; }
.btn.mini { padding: 5px 12px; font-size: 11.5px; }
.hint { padding: 10px 14px; border-radius: 10px; background: var(--bg-lilac); border: 1px solid var(--purple-line); font-size: 11.5px; }
.hint.inset { margin: 12px 18px; }
.hint.warn { border-color: #f0c8c5; background: #fdf0ef; color: var(--red); }
.hint.warnText { color: #8a6420; }
</style>
