<script setup lang="ts">
// 上新分步向导（还原旧线 packages/admin StepWizard·换皮删成扁平表 + 只读进度圆点·「导向」这半没还原）：
// 顶部 6 步可点进度条 → 当前步嵌入对应工作面板 → 上一步/下一步 + 上架闸。
// 不重建 2500 行分步逻辑——功能都在 admin2 现有页里，本页只做「编排」：嵌入 Products 编辑器(步1-3)/Courses(步4)/
// Cards(步5)/Batches(步6)（各页 embed 模式·向后兼容）。进度真值走 listDrafts 后端 join 派生（productSteps·同列表列）。
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Store } from 'lucide-vue-next'
import { listDrafts, publishProduct } from '../api/products'
import { productSteps, productState, basicsMissing, wizardCanPublish, type StepDot } from '../lib/mapProducts'
import { wizardStepFromQuery } from '../lib/nav'
import Products from './Products.vue'
import Courses from './Courses.vue'
import Cards from './Cards.vue'
import Batches from './Batches.vue'
import UiButton from '../components/ui/Button.vue'

const route = useRoute()
const router = useRouter()
const id = String(route.params.id || '')

const product = ref<Record<string, any> | null>(null)
const extras = ref<{ hasVideo?: Record<string, boolean>; cardFinal?: Record<string, boolean>; hasBatch?: Record<string, boolean> }>({})
const listed = ref<Record<string, boolean>>({})
const loading = ref(true)
const message = ref('')
const busy = ref(false)
const pubConfirm = ref(false)

const STEP_NAMES = ['产品图片', '商品信息', 'SKU', '教学视频', '二维码卡片', '码批次']
// 步单源=URL ?step（决策§27②·Shell 侧栏与本页横向 rail 同读它·深链落到首个未完成步）·夹 1..6
const step = computed(() => wizardStepFromQuery(route.query.step))

const courseId = computed(() => String(product.value?.courseId || '') || 'course-' + id)
const steps = computed<StepDot[]>(() => (product.value ? productSteps(product.value, extras.value) : []))
const doneCount = computed(() => steps.value.filter((s) => s.done).length)
const state = computed(() => productState(id, listed.value))
const missing = computed(() => (product.value ? basicsMissing(product.value) : []))
const canPublish = computed(() => !!product.value && wizardCanPublish(product.value))
// 下一步待办：第一个未完成步（引导「先做这个」）；全齐则空
const nextTodo = computed(() => {
  const i = steps.value.findIndex((s) => !s.done)
  return i < 0 ? null : { n: i + 1, name: STEP_NAMES[i] }
})

// 载入商品档 + 6 步派生真值（listDrafts 一次给 list/listed/urls + hasVideo/cardFinal/hasBatch）
async function reloadProduct() {
  const r: any = await listDrafts()
  if (!r.ok) {
    message.value = '加载失败：' + String(r.error || '')
    loading.value = false
    return
  }
  product.value = (r.list as Record<string, any>[]).find((p) => String(p.id || p._id) === id) || null
  listed.value = r.listed || {}
  extras.value = { hasVideo: r.hasVideo || {}, cardFinal: r.cardFinal || {}, hasBatch: r.hasBatch || {} }
  loading.value = false
}

function go(n: number) {
  if (n < 1 || n > 6 || n === step.value) return
  // 步写进 URL（单源）→ step 重算 → watch 触发刷新；Shell 侧栏点步走 router-link 同径同步
  void router.push({ path: route.path, query: { ...route.query, step: String(n) } })
}

function railState(n: number): 'current' | 'done' | 'todo' {
  if (n === step.value) return 'current'
  return steps.value[n - 1]?.done ? 'done' : 'todo'
}

async function shelve() {
  if (busy.value || !canPublish.value) return
  if (!pubConfirm.value) {
    pubConfirm.value = true
    return
  }
  pubConfirm.value = false
  busy.value = true
  const r: any = await publishProduct(id)
  busy.value = false
  if (r.ok) {
    message.value = '已上架，打开小程序即可看到该商品'
    void reloadProduct()
  } else {
    // publishErrorText 四道门人话在列表页·此处后端已过前置预检，直报原文错误码
    message.value = '上架没成功：' + String(r.error || '')
  }
}

// 切步（本页按钮或侧栏点步改 ?step）→ 刷新进度真值 + 收起上架二次确认
watch(step, () => {
  pubConfirm.value = false
  void reloadProduct()
})

onMounted(reloadProduct)
</script>

<template>
  <div class="wizard">
    <div v-if="loading" class="status-soft">加载中…</div>
    <div v-else-if="!product" class="missing">
      没有找到这个商品（编号 {{ id }}）。<a @click="router.push('/products')">← 回商品列表</a>
    </div>
    <template v-else>
      <header class="top">
        <a class="back" @click="router.push('/products')">← 商品列表</a>
        <span class="slash">/</span>
        <h1 class="title">{{ product.name || '新建商品' }}</h1>
        <span class="chip">上新向导 · 第 {{ step }} / 6 步 · 已完成 {{ doneCount }}/6</span>
        <span v-if="state === 'onsale'" class="chip green">在售</span>
        <span class="spacer"></span>
        <span v-if="missing.length" class="miss">上架还差：{{ missing.join('、') }}</span>
        <UiButton :disabled="!canPublish || busy" :title="canPublish ? '' : '完成前三步（图片/信息/SKU）后可上架'" @click="shelve">
          <Store v-if="!busy" :size="15" :stroke-width="1.8" />
          {{ busy ? '上架中…' : pubConfirm ? '确认上架？' : state === 'onsale' ? '更新上架信息' : '上架小程序' }}
        </UiButton>
      </header>

      <p v-if="message" class="banner">{{ message }}</p>

      <!-- 6 步可点进度条（还原旧线 rail·换皮退成只读圆点） -->
      <div class="rail">
        <template v-for="sn in 6" :key="sn">
          <span v-if="sn > 1" class="line" :class="{ lit: railState(sn) !== 'todo' || railState(sn - 1) === 'done' }"></span>
          <button class="step" :class="railState(sn)" @click="go(sn)">
            <span class="circ">{{ railState(sn) === 'done' ? '✓' : sn }}</span>
            <span class="sname">{{ STEP_NAMES[sn - 1] }}</span>
          </button>
        </template>
      </div>

      <!-- 当前步内容：嵌入现有页面（embed 模式·各页独立路由用法不受影响） -->
      <div class="content">
        <div class="panel-head">
          <h2>第 {{ step }} 步 · {{ STEP_NAMES[step - 1] }}</h2>
          <span v-if="nextTodo && nextTodo.n !== step" class="next-hint">下一个待办：第 {{ nextTodo.n }} 步 {{ nextTodo.name }}</span>
        </div>

        <div class="panel-body">
          <!-- 步 1-3：商品图片/信息/SKU 同属商品编辑器（旧线 StepImages/StepInfo/StepSkus·新线合并为一编辑器） -->
          <Products v-if="step <= 3" embed :wizard-product-id="id" />
          <Courses v-else-if="step === 4" embed :wizard-course-id="courseId" />
          <Cards v-else-if="step === 5" embed :wizard-product-id="id" />
          <Batches v-else-if="step === 6" embed :wizard-course-id="courseId" />
        </div>

        <div class="nav">
          <button v-if="step > 1" class="btn-ghost" @click="go(step - 1)">← 上一步 · {{ STEP_NAMES[step - 2] }}</button>
          <span class="flex"></span>
          <UiButton v-if="step < 6" @click="go(step + 1)">下一步 · {{ STEP_NAMES[step] }} →</UiButton>
          <UiButton v-else @click="router.push('/products')">✓ 完成 · 返回商品列表</UiButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wizard {
  max-width: 1160px;
}
.status-soft {
  padding: 40px;
  font-size: 13px;
  color: var(--ld-content-2);
}
.missing {
  padding: 60px;
  text-align: center;
  color: var(--ld-content-2);
  font-size: 14px;
}
.missing a,
.back {
  color: var(--ld-brand-active);
  cursor: pointer;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.back {
  font-size: 13px;
  color: var(--ld-content-2);
  text-decoration: none;
}
.slash {
  color: var(--ld-line-strong);
}
.title {
  font-size: 20px;
  font-weight: 700;
  color: var(--ld-ink);
  margin: 0;
}
.chip {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.chip.green {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.spacer {
  flex: 1;
}
.miss {
  font-size: 12px;
  color: var(--ld-red);
  background: var(--ld-bg-red-soft);
  border-radius: 999px;
  padding: 5px 12px;
}
.btn-ghost {
  padding: 9px 16px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 13px;
  cursor: pointer;
}
.banner {
  margin: 0 0 14px;
  padding: 9px 14px;
  border-radius: 10px;
  font-size: 13px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.rail {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  margin-bottom: 16px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.line {
  flex: 1;
  height: 2px;
  border-radius: 2px;
  background: var(--ld-line);
}
.line.lit {
  background: var(--ld-green);
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
  background: var(--ld-bg-grey);
  border: 1px solid var(--ld-line-strong);
  color: var(--ld-content-2);
}
.sname {
  font-size: 12px;
  color: var(--ld-content-2);
}
.step.done .circ {
  background: var(--ld-bg-green-soft);
  border-color: var(--ld-green);
  color: var(--ld-green);
}
.step.done .sname {
  color: var(--ld-content);
}
.step.current .circ {
  background: var(--ld-brand);
  border-color: var(--ld-brand);
  color: #fff;
}
.step.current .sname {
  color: var(--ld-purple-ink);
  font-weight: 700;
}
.content {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  padding: 20px 22px;
}
.panel-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ld-line);
}
.panel-head h2 {
  margin: 0;
  font-size: 15px;
  color: var(--ld-purple-ink);
}
.next-hint {
  font-size: 12px;
  color: var(--ld-content-2);
}
.panel-body {
  min-height: 360px;
}
.nav {
  display: flex;
  align-items: center;
  gap: 10px;
  border-top: 1px solid var(--ld-line);
  padding-top: 16px;
  margin-top: 18px;
}
.flex {
  flex: 1;
}
</style>
