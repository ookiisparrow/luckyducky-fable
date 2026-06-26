<script setup>
/**
 * 库存管理（库存#1·S14）。实物库存按 SKU（商品×规格）展开；下单即预留、超时/退款自动回补、缺货自动售罄。
 * 库存写收口云端 kit/inventory（乐观 CAS 防超卖）；本页只读 listInventory + 调用 saveStock 设/调（绝对值·留空=不限量）。
 * 商品名/规格来自 products（store），库存来自 inventory（按 productId__spec 合并；无文档=不限量·现有商品零改动安全迁移）。
 */
import { ref, computed } from 'vue'
import { cloudMode, listInventory, saveStock } from '@/api/cloud.js'
import { useProductsStore } from '@/store/products.js'
import { promptDialog, toast } from '@/utils/ui.js'
import { RefreshCw } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'

const store = useProductsStore()
const invMap = ref({}) // `${productId}__${spec}` -> { stock, threshold }
const loading = ref(true)
const loadErr = ref('')
const tab = ref('all')
const busy = ref('')

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    await store.load()
    const list = await listInventory()
    const m = {}
    for (const d of list) m[`${d.productId}__${d.spec || ''}`] = { stock: d.stock, threshold: d.threshold, updatedAt: d.updatedAt }
    invMap.value = m
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

// 展开成 SKU 行（商品×规格）；商品无规格→默认一行（spec=''）
const rows = computed(() => {
  const out = []
  for (const p of store.list) {
    const skus = Array.isArray(p.skus) && p.skus.length ? p.skus : [{ name: '', price: p.price }]
    for (const sk of skus) {
      const spec = sk.name || ''
      const inv = invMap.value[`${p.id}__${spec}`]
      const stock = inv ? inv.stock : null // 无文档=不限量
      const threshold = inv && inv.threshold != null ? inv.threshold : 10
      let status = 'unlimited'
      if (stock != null) status = stock === 0 ? 'out' : stock <= threshold ? 'low' : 'ok'
      out.push({ productId: p.id, productName: p.name || '未命名商品', spec, price: sk.price ?? p.price, stock, threshold, status, updatedAt: inv ? inv.updatedAt : null })
    }
  }
  return out
})
const STATUS = { ok: ['在售', 'green'], low: ['低库存', 'warn'], out: ['售罄', 'red'], unlimited: ['不限量', 'grey'] }
const TABS = [['all', '全部'], ['ok', '在售'], ['low', '低库存'], ['out', '售罄'], ['unlimited', '不限量']]
const counts = computed(() => {
  const c = { all: rows.value.length, ok: 0, low: 0, out: 0, unlimited: 0 }
  for (const r of rows.value) c[r.status]++
  return c
})
const shown = computed(() => (tab.value === 'all' ? rows.value : rows.value.filter((r) => r.status === tab.value)))

async function adjust(r) {
  const cur = r.stock == null ? '' : String(r.stock)
  const v = await promptDialog({
    title: '调整库存',
    message: `${r.productName}${r.spec ? ' / ' + r.spec : ''}\n输入数量（留空 = 不限量）：`,
    defaultValue: cur,
    placeholder: '留空 = 不限量',
  })
  if (v === null) return
  const t = v.trim()
  const stock = t === '' ? null : parseInt(t, 10)
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return toast('请输入非负整数，或留空表示不限量', 'err')
  busy.value = `${r.productId}__${r.spec}`
  try {
    // 回传加载时的 updatedAt 走云端 CAS（外审 P1.8）：库存自加载已被并发预留/他人改动则冲突，刷新后重试不覆盖预留
    await saveStock(r.productId, r.spec, stock, r.threshold, r.updatedAt)
    await init()
  } catch (e) {
    await init() // 冲突或失败都拉最新库存，避免管理员在旧值上继续覆盖
    toast('保存失败：' + e.message, 'err')
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>库存管理</h1>
        <p class="sub">实物库存按 SKU 追踪 · 下单即预留、超时/退款自动回补、缺货自动售罄 · 留空 = 不限量</p>
      </div>
      <button class="btn ghost" @click="init"><RefreshCw :size="14" />刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">库存管理需云端模式（配置 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <Skeleton v-else-if="loading" class="card" :rows="6" />

    <template v-else>
      <div class="tabs">
        <button v-for="[k, label] in TABS" :key="k" class="tab" :class="{ on: tab === k }" @click="tab = k">
          {{ label }}<span class="tab-n">{{ counts[k] }}</span>
        </button>
      </div>
      <p v-if="!shown.length" class="hint">这个状态下还没有 SKU</p>
      <div v-else class="card">
        <div class="row hrow">
          <span class="c-prod">商品 · 规格</span><span class="c-price">价格</span><span class="c-stock">当前库存</span><span class="c-status">状态</span><span class="c-op">操作</span>
        </div>
        <div v-for="r in shown" :key="r.productId + '__' + r.spec" class="row">
          <span class="c-prod"><b>{{ r.productName }}</b><em v-if="r.spec"> · {{ r.spec }}</em></span>
          <span class="c-price">{{ r.price ? '￥' + r.price : '—' }}</span>
          <span class="c-stock">
            <template v-if="r.status === 'unlimited'">∞ 不限量</template>
            <template v-else><b :class="r.status">{{ r.stock }}</b> 件<em v-if="r.status === 'low'"> · 低于 {{ r.threshold }}</em></template>
          </span>
          <span class="c-status"><span class="chip" :class="STATUS[r.status][1]">{{ STATUS[r.status][0] }}</span></span>
          <span class="c-op"><button class="btn ghost mini" :disabled="busy === r.productId + '__' + r.spec" @click="adjust(r)">调整</button></span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
h1 { font-size: 22px; color: var(--ink); margin: 0 0 5px; }
.sub { margin: 0; font-size: 12.5px; color: var(--content-2); }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tab { border: 1px solid var(--line-strong); background: var(--white); border-radius: var(--r-pill); padding: 7px 14px; font-size: 12.5px; color: var(--content-2); cursor: pointer; }
.tab.on { background: var(--purple-ink); border-color: var(--purple-ink); color: var(--white); font-weight: 600; }
.tab-n { margin-left: 5px; font-size: 11px; opacity: 0.75; }
.card { background: var(--white); border: 1px solid var(--line); border-radius: 13px; overflow: hidden; }
.row { display: flex; align-items: center; gap: 14px; padding: 12px 18px; font-size: 12.5px; }
.row + .row { border-top: 1px solid var(--line); }
.hrow { background: var(--bg-lilac); font-size: 11.5px; font-weight: 600; color: var(--content-2); }
.c-prod { flex: 1; min-width: 0; color: var(--content); }
.c-prod b { color: var(--ink); }
.c-prod em { color: var(--content-2); font-style: normal; }
.c-price { width: 90px; color: var(--ink); }
.c-stock { width: 160px; color: var(--content-2); }
.c-stock b { font-size: 15px; color: var(--ink); }
.c-stock b.low { color: #b8801f; }
.c-stock b.out { color: var(--red); }
.c-stock em { font-style: normal; color: #b8801f; font-size: 11px; }
.c-status { width: 90px; }
.c-op { width: 80px; }
.chip { padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.chip.green { background: #e8f3ec; color: #3f8c5e; }
.chip.warn { background: #fdf6ec; color: #8a6420; }
.chip.red { background: #fdf0ef; color: var(--red); }
.chip.grey { background: var(--bg-grey, #f3f3f3); color: var(--content-2); }
.btn.mini { padding: 5px 12px; font-size: 11.5px; }
.hint { padding: 10px 14px; border-radius: 10px; background: var(--bg-lilac); border: 1px solid var(--purple-line); font-size: 11.5px; }
.hint.warn { border-color: #f0c8c5; background: #fdf0ef; color: var(--red); }
</style>
