<script setup>
/**
 * 商品与上新（S11 重设计·密集表格）。一款商品 = 一条六步流水线（产品图片→信息→SKU→视频→卡片→码批次）。
 *
 * 重设计要点：
 * - 大卡片网格 → 密集表格（商品/关联课程/价格/规格·图/上新进度/状态/操作），一屏看更多。
 * - 三态标签 全部/在售/筹备中/已下架 + 计数 + 搜索商品名。商品是云端草稿、全量加载（量小·无分页），
 *   故计数/筛选/搜索在前端做即诚实（不存在订单那种「分页后失真」）。
 * - 软下架（债#12）此前后端有、管理端无 UI：本页让「已下架」显形 + 提供下架/恢复上架操作。
 *   状态来自 store.statusOf（onsale+listed≠false=在售 / onsale+listed:false=已下架 / 其余=筹备中）。
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useProductsStore, stepDone, STEP_NAMES } from '@/store/products.js'

const router = useRouter()
const store = useProductsStore()
store.load()

const STATUS = {
  onsale: { label: '在售', chip: 'green' },
  preparing: { label: '筹备中', chip: 'warn' },
  unlisted: { label: '已下架', chip: 'grey' },
}
const TABS = [
  ['all', '全部'],
  ['onsale', '在售'],
  ['preparing', '筹备中'],
  ['unlisted', '已下架'],
]

const tab = ref('all')
const q = ref('')
const busy = ref('') // 下架/恢复 in-flight 的商品 id

const counts = computed(() => {
  const c = { all: store.list.length, onsale: 0, preparing: 0, unlisted: 0 }
  for (const p of store.list) c[store.statusOf(p)]++
  return c
})
const shown = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return store.list.filter((p) => {
    if (tab.value !== 'all' && store.statusOf(p) !== tab.value) return false
    if (kw && !(p.name || '').toLowerCase().includes(kw) && !(p.id || '').toLowerCase().includes(kw)) return false
    return true
  })
})

const imgCount = (p) => p.images.length + (p.cover ? 1 : 0)
const priceText = (p) => {
  if (!p.price) return '未定价'
  const prices = p.skus.map((s) => Number(s.price)).filter((n) => n > 0)
  const min = prices.length ? Math.min(...prices) : Number(p.price)
  return `￥${min}${p.skus.length > 1 ? ' 起' : ''}`
}

function createProduct() {
  store.create().then((p) => router.push(`/product/${p.id}/step/1`))
}
function open(p) {
  const n = [1, 2, 3, 4, 5, 6].find((i) => !stepDone(p, i)) || 1
  router.push(`/product/${p.id}/step/${n}`)
}
async function removeProduct(p) {
  if (confirm(`删除「${p.name || '未命名商品'}」？此操作不可撤销（草稿与已上架商品一并删，历史订单不受影响）。`))
    await store.remove(p.id)
}
async function toggleListing(p) {
  const unlisted = store.statusOf(p) === 'unlisted'
  const verb = unlisted ? '恢复上架' : '下架'
  if (!confirm(`确认${verb}「${p.name || '未命名商品'}」？${unlisted ? '恢复后顾客端重新可见。' : '下架后顾客端列表不再显示（详情直达与历史订单不受影响）。'}`)) return
  busy.value = p.id
  try {
    if (unlisted) await store.republish(p.id)
    else await store.unpublish(p.id)
  } catch (e) {
    alert(verb + '失败：' + e.message)
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div>
    <p v-if="store.error" class="errbar">{{ store.error }}</p>
    <header class="head">
      <div>
        <h1>商品与上新</h1>
        <p class="sub">一款商品一条流水线：产品图片 → 商品信息 → SKU → 教学视频 → 二维码卡片 → 码批次</p>
      </div>
      <button class="btn primary" @click="createProduct">＋ 新建商品</button>
    </header>

    <div class="bar">
      <div class="tabs">
        <button v-for="[k, label] in TABS" :key="k" class="tab" :class="{ on: tab === k }" @click="tab = k">
          {{ label }}<span class="tab-n">{{ counts[k] }}</span>
        </button>
      </div>
      <div class="search">
        <input v-model="q" class="input" placeholder="搜索商品名 / 编号" />
      </div>
    </div>

    <p v-if="!store.list.length" class="hint">还没有商品，点右上「新建商品」从第 1 步开始上新。</p>
    <p v-else-if="!shown.length" class="hint">
      {{ q ? '没有匹配的商品' : '这个状态下还没有商品' }}
    </p>

    <div v-else class="card table">
      <div class="row hrow">
        <span>商品</span><span>关联课程</span><span>价格</span><span>规格 / 图</span>
        <span>上新进度</span><span>状态</span><span class="r">操作</span>
      </div>
      <div v-for="p in shown" :key="p.id" class="row">
        <span class="prod" @click="open(p)">
          <span class="thumb"><img v-if="store.imgUrl(p.cover)" :src="store.imgUrl(p.cover)" alt="" /><i v-else>图</i></span>
          <span class="pmeta"><b>{{ p.name || '未命名商品' }}</b><em>{{ p.id }}</em></span>
        </span>
        <span class="course" :class="{ none: !p.courseId }">{{ p.courseId ? '已关联' : '未关联' }}</span>
        <span class="price">{{ priceText(p) }}</span>
        <span class="muted">{{ p.skus.length }} 规格 · {{ imgCount(p) }} 图</span>
        <span class="prog">
          <i v-for="n in 6" :key="n" class="dot" :class="{ done: stepDone(p, n) }" :title="`${n} · ${STEP_NAMES[n - 1]}`">{{ stepDone(p, n) ? '✓' : n }}</i>
          <em>{{ store.doneCount(p) }}/6</em>
        </span>
        <span><span class="chip" :class="STATUS[store.statusOf(p)].chip">{{ STATUS[store.statusOf(p)].label }}</span></span>
        <span class="r ops">
          <button class="btn mini" :class="store.doneCount(p) === 6 ? 'ghost' : 'primary'" @click="open(p)">
            {{ store.doneCount(p) === 6 ? '编辑' : '继续上新' }}
          </button>
          <button
            v-if="store.statusOf(p) !== 'preparing'"
            class="btn ghost mini"
            :disabled="busy === p.id"
            @click="toggleListing(p)"
          >{{ store.statusOf(p) === 'unlisted' ? '恢复' : '下架' }}</button>
          <button class="del" title="删除" @click="removeProduct(p)">🗑</button>
        </span>
      </div>
    </div>

    <p v-if="store.list.length" class="foot muted">共 {{ store.list.length }} 款商品（全部已加载）</p>
  </div>
</template>

<style scoped>
.errbar {
  background: #fdf0ef;
  border: 1px solid #f0c8c5;
  color: var(--red);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12.5px;
  margin: 0 0 16px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
h1 {
  font-size: 22px;
  color: var(--ink);
  margin: 0 0 5px;
}
.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--content-2);
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.tabs {
  display: flex;
  gap: 8px;
}
.tab {
  border: 1px solid var(--line-strong);
  background: var(--white);
  border-radius: var(--r-pill);
  padding: 7px 14px;
  font-size: 12.5px;
  color: var(--content-2);
  cursor: pointer;
}
.tab.on {
  background: var(--purple-ink);
  border-color: var(--purple-ink);
  color: var(--white);
  font-weight: 600;
}
.tab-n {
  margin-left: 5px;
  font-size: 11px;
  opacity: 0.75;
}
.search .input {
  width: 220px;
}
.table {
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 2fr 84px 88px 110px 150px 76px 168px;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  font-size: 12.5px;
}
.row + .row {
  border-top: 1px solid var(--line);
}
.hrow {
  background: var(--bg-lilac);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--content-2);
}
.r {
  justify-self: end;
}
.prod {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  cursor: pointer;
}
.thumb {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-sage);
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb i {
  font-style: normal;
  font-size: 11px;
  color: var(--content-2);
}
.pmeta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}
.pmeta b {
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pmeta em {
  font-style: normal;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
  color: var(--content-2);
}
.course {
  color: var(--green);
  font-size: 11.5px;
}
.course.none {
  color: var(--content-2);
}
.price {
  color: var(--ink);
  font-weight: 600;
}
.muted {
  color: var(--content-2);
}
.prog {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
  background: var(--bg-grey);
  color: var(--content-2);
  font-size: 9px;
  font-weight: 700;
  font-style: normal;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dot.done {
  background: var(--green-bg);
  border-color: var(--green-line);
  color: var(--green);
}
.prog em {
  font-style: normal;
  font-size: 11px;
  color: var(--content-2);
  margin-left: 4px;
}
.ops {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
.btn.mini {
  padding: 6px 11px;
  font-size: 12px;
}
.del {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  opacity: 0.65;
}
.del:hover {
  opacity: 1;
}
.chip.warn {
  background: #fdf6ec;
  border-color: #f0ddc0;
  color: #8a6420;
}
.foot {
  margin-top: 14px;
  font-size: 11.5px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
</style>
