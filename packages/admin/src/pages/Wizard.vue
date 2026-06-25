<script setup>
/**
 * 上新向导（规格 §七）：单页 + 顶部六步进度条（可点跳转）+ 当前步内容 + 上一步/下一步。
 * ①产品图片 ②商品信息 ③SKU 本期可用；④教学视频 ⑤二维码卡片 ⑥码批次 为 v1.5 占位。
 */
import { useRouter } from 'vue-router'
import { ref, computed } from 'vue'
import { useProductsStore, stepDone, STEP_NAMES } from '@/store/products.js'
import { publishProduct } from '@/api/cloud.js'
import { confirmDialog, toast } from '@/utils/ui.js'
import StepImages from '@/pages/steps/StepImages.vue'
import StepInfo from '@/pages/steps/StepInfo.vue'
import StepSkus from '@/pages/steps/StepSkus.vue'
import StepVideos from '@/pages/steps/StepVideos.vue'
import StepCards from '@/pages/steps/StepCards.vue'
import StepBatch from '@/pages/steps/StepBatch.vue'
import StepStub from '@/pages/steps/StepStub.vue'

const props = defineProps({ id: { type: String, default: '' }, n: { type: String, default: '1' } })
const router = useRouter()
const store = useProductsStore()
store.load()

const product = computed(() => store.getById(props.id))
const step = computed(() => Math.min(6, Math.max(1, parseInt(props.n, 10) || 1)))
const comp = computed(
  () => [StepImages, StepInfo, StepSkus, StepVideos, StepCards, StepBatch][step.value - 1] || StepStub,
)

function go(n) {
  if (n >= 1 && n <= 6) router.push(`/product/${props.id}/step/${n}`)
}
function railState(n) {
  if (n === step.value) return 'current'
  return product.value && stepDone(product.value, n) ? 'done' : 'todo'
}

// 上架小程序（设计稿 S5 顶栏）：①②③齐即可上架；④未配齐给确认提示
const shelving = ref(false)
const canShelve = computed(() => product.value && [1, 2, 3].every((n) => stepDone(product.value, n)))
// 上架硬性门槛清单（与 publishProduct 云端校验一致），缺啥提示啥
const missing = computed(() => {
  const p = product.value
  if (!p) return []
  const m = []
  if (!p.cover) m.push('封面图(第1步)')
  if (!p.name) m.push('商品名称(第2步)')
  if (!p.price) m.push('现价(第2步)')
  if (!(p.skus.length && p.skus.every((s) => s.name && s.price))) m.push('至少1个规格(第3步)')
  return m
})
async function shelve() {
  if (shelving.value || !canShelve.value) return
  const videoMiss = !stepDone(product.value, 4)
  const tip =
    (videoMiss ? '配套教学视频还没配齐（第 4 步），可以先上架商品、之后再补课程。\n' : '') +
    '上架后小程序首页与详情页立即可见。确认上架？'
  if (!(await confirmDialog({ title: '上架商品', message: tip, confirmText: '上架' }))) return
  shelving.value = true
  try {
    await publishProduct(product.value.id)
    await store.update(product.value.id, { status: 'onsale' })
    toast('已上架，打开小程序即可看到该商品', 'ok')
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    shelving.value = false
  }
}
</script>

<template>
  <div v-if="!product" class="missing">
    没有找到这个商品。<router-link to="/products">回商品列表</router-link>
  </div>
  <div v-else>
    <header class="top">
      <router-link class="back" to="/products">← 商品列表</router-link>
      <span class="slash">/</span>
      <h1 class="title">{{ product.name || '新建商品' }}</h1>
      <span class="chip">上新向导 · 第 {{ step }} / 6 步</span>
      <span v-if="product.status === 'onsale'" class="chip green">在售</span>
      <span class="autosave">每步修改自动保存 ✓</span>
      <span v-if="missing.length" class="missing">上架还差：{{ missing.join('、') }}</span>
      <button class="btn primary" :disabled="!canShelve || shelving" :title="canShelve ? '' : '完成前三步后可上架'" @click="shelve">
        {{ shelving ? '上架中…' : product.status === 'onsale' ? '🏪 更新上架信息' : '🏪 上架小程序' }}
      </button>
    </header>

    <div class="rail card">
      <template v-for="sn in 6" :key="sn">
        <span v-if="sn > 1" class="line" :class="{ lit: railState(sn) !== 'todo' || railState(sn - 1) === 'done' }"></span>
        <button class="step" :class="railState(sn)" @click="go(sn)">
          <span class="circ">{{ railState(sn) === 'done' ? '✓' : sn }}</span>
          <span class="sname">{{ STEP_NAMES[sn - 1] }}</span>
        </button>
      </template>
    </div>

    <div class="content card">
      <component :is="comp" :product="product" :step="step" />
      <div class="nav">
        <button v-if="step > 1" class="btn ghost" @click="go(step - 1)">
          ← 上一步 · {{ STEP_NAMES[step - 2] }}
        </button>
        <span class="flex"></span>
        <button v-if="step < 6" class="btn primary" @click="go(step + 1)">
          下一步 · {{ STEP_NAMES[step] }} →
        </button>
        <button v-else class="btn primary" @click="router.push('/products')">✓ 完成 · 返回商品列表</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.missing {
  padding: 60px;
  text-align: center;
  color: var(--content-2);
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.back {
  font-size: 13px;
  color: var(--content-2);
  text-decoration: none;
}
.back:hover {
  color: var(--brand-active);
}
.slash {
  color: var(--line-strong);
}
.title {
  font-size: 19px;
  color: var(--ink);
  margin: 0;
}
.autosave {
  margin-left: auto;
  font-size: 12px;
  color: var(--content-2);
}
.missing {
  font-size: 11.5px;
  color: var(--red);
  background: #fdf0ef;
  border: 1px solid #f0c8c5;
  border-radius: 99px;
  padding: 5px 12px;
}
.rail {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  margin-bottom: 18px;
}
.line {
  flex: 1;
  height: 2px;
  border-radius: 2px;
  background: var(--line);
}
.line.lit {
  background: var(--green-line);
}
.step {
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.circ {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 700;
  background: var(--bg-grey);
  border: 1px solid var(--line-strong);
  color: var(--content-2);
}
.sname {
  font-size: 12px;
  color: var(--content-2);
}
.step.done .circ {
  background: var(--green-bg);
  border-color: var(--green-line);
  color: var(--green);
}
.step.done .sname {
  color: var(--content);
}
.step.current .circ {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--white);
}
.step.current .sname {
  color: var(--purple-ink);
  font-weight: 700;
}
.content {
  padding: 22px 24px;
  min-height: 480px;
  display: flex;
  flex-direction: column;
}
.nav {
  display: flex;
  align-items: center;
  border-top: 1px solid var(--line);
  padding-top: 16px;
  margin-top: auto;
}
.flex {
  flex: 1;
}
</style>
