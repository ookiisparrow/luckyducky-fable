<script setup>
/**
 * 产销统计（进销存车道 D 另一只读视角·蓝图 docs/进销存ERP/ §4D）。按产品×规格对照三件事：
 * 累计打包（stockLedger assembly_in 求和）/ 累计发货售出（stockLedger ship 求和）/ 现存库存（inventory）。
 * 纯只读聚合，不动任何账；接在「打包组装」之后，看完数字决定要不要回头再点「备货计算」。
 */
import { ref } from 'vue'
import { cloudMode, getFgSummary, listInventory, loadProducts } from '@/api/cloud.js'
import { RefreshCw } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import ScmFlowTabs from '@/components/ScmFlowTabs.vue'

const loading = ref(true)
const loadErr = ref('')
const products = ref([])
const rows = ref([])

// 本地演示数据（cloudMode 由构建期 VITE_ADMIN_API 决定——生产构建必配该变量，此分支生产不可达，
// 同 loadProducts() 等既有函数的本地模式范式）：仅供 `npm run dev` 未接云端时看页面效果，不改
// cloud.js 里被 Inventory.vue 等其他页面共用的 listInventory()，改动面收在本文件、不外溢。
const DEMO_ROWS = [
  { productId: 'demo-hat', spec: '', packed: 80, shipped: 15, stock: 65 },
  { productId: 'demo-scarf', spec: 'grey', packed: 20, shipped: 5, stock: 15 },
  { productId: 'demo-mittens', spec: '', packed: 40, shipped: 40, stock: null }, // 不限量款
]

async function init() {
  if (!cloudMode) {
    rows.value = DEMO_ROWS
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const [fg, inv, ps] = await Promise.all([getFgSummary(), listInventory(), loadProducts()])
    products.value = ps.list || []
    rows.value = buildRows(fg.packed, fg.shipped, inv)
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

// 三份数据按 productId+spec 取并集 join（任一份出现过的 key 都要显示，不能因为只在一份里出现就漏掉）
function buildRows(packed, shipped, inventory) {
  const key = (productId, spec) => `${productId}__${spec || ''}`
  const map = new Map()
  const get = (productId, spec) => {
    const k = key(productId, spec)
    if (!map.has(k)) map.set(k, { productId, spec: spec || '', packed: 0, shipped: 0, stock: null })
    return map.get(k)
  }
  for (const r of packed || []) get(r.productId, r.spec).packed = r.qty
  for (const r of shipped || []) get(r.productId, r.spec).shipped = r.qty
  for (const r of inventory || []) get(r.productId, r.spec).stock = Number.isInteger(r.stock) ? r.stock : null
  return [...map.values()].sort((a, b) => a.productId.localeCompare(b.productId) || a.spec.localeCompare(b.spec))
}

const productName = (pid) => products.value.find((p) => p.id === pid)?.name || pid
</script>

<template>
  <div>
    <ScmFlowTabs />
    <header class="head">
      <div>
        <h1>产销统计</h1>
        <p class="sub">按产品/规格对照：累计打包 · 累计发货/售出 · 现存库存 · 纯只读汇总不动账</p>
      </div>
      <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">演示数据——本地未配置云端（VITE_ADMIN_API），下表为效果预览、非真实统计。</p>
    <p v-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <Skeleton v-if="loading" class="card" :rows="6" />

    <div v-if="!loading && !loadErr" class="card">
      <div class="row hrow">
        <span class="c-name">产品</span><span class="c-spec">规格</span><span class="c-num">累计打包</span><span class="c-num">累计发货/售出</span><span class="c-num">现存库存</span>
      </div>
      <p v-if="!rows.length" class="hint inset">还没有打包/发货记录——先去「打包组装」打第一批。</p>
      <div v-for="r in rows" :key="r.productId + '__' + r.spec" class="row">
        <span class="c-name"><b>{{ productName(r.productId) }}</b></span>
        <span class="c-spec">{{ r.spec || '—' }}</span>
        <span class="c-num">{{ r.packed }}</span>
        <span class="c-num">{{ r.shipped }}</span>
        <span class="c-num">{{ r.stock === null ? '不限量' : r.stock }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
h1 { font-size: 22px; color: var(--ink); margin: 0 0 5px; }
.sub { margin: 0; font-size: 12.5px; color: var(--content-2); }
.card { background: var(--white); border: 1px solid var(--line); border-radius: 13px; overflow: hidden; margin-bottom: 18px; }
.row { display: flex; align-items: center; gap: 14px; padding: 12px 18px; font-size: 12.5px; }
.row + .row { border-top: 1px solid var(--line); }
.hrow { background: var(--bg-lilac); font-size: 11.5px; font-weight: 600; color: var(--content-2); }
.c-name { flex: 1; min-width: 0; color: var(--content); }
.c-name b { color: var(--ink); }
.c-spec { width: 110px; color: var(--content-2); }
.c-num { width: 130px; color: var(--content); }
.hint { padding: 10px 14px; border-radius: 10px; background: var(--bg-lilac); border: 1px solid var(--purple-line); font-size: 11.5px; }
.hint.inset { margin: 12px 18px; }
.hint.warn { border-color: #f0c8c5; background: #fdf0ef; color: var(--red); }
</style>
