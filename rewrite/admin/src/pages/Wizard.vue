<script setup lang="ts">
// 上新分步向导（还原旧线 packages/admin StepWizard·换皮删成扁平表 + 只读进度圆点·「导向」这半没还原）：
// 顶部 6 步可点进度条 → 当前步嵌入对应工作面板 → 上一步/下一步 + 上架闸。
// 不重建 2500 行分步逻辑——功能都在 admin2 现有页里，本页只做「编排」：嵌入 Products 编辑器(步1-3)/Courses(步4)/
// Cards(步5)/Batches(步6)（各页 embed 模式·向后兼容）。进度真值走 listDrafts 后端 join 派生（productSteps·同列表列）。
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Store, ArrowLeft, ChevronLeft, ChevronRight, Check } from 'lucide-vue-next'
import { listDrafts, publishProduct, saveDraft } from '../api/products'
import { productSteps, productState, basicsMissing, wizardCanPublish, freshDraft, type StepDot } from '../lib/mapProducts'
import { wizardStepFromQuery, WIZARD_STEPS } from '../lib/nav'
import { isUploadLocked } from '../lib/uploadLock'
import Products from './Products.vue'
import Courses from './Courses.vue'
import Cards from './Cards.vue'
import Batches from './Batches.vue'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id || ''))

const product = ref<Record<string, any> | null>(null)
const extras = ref<{ hasVideo?: Record<string, boolean>; cardFinal?: Record<string, boolean>; hasBatch?: Record<string, boolean> }>({})
const listed = ref<Record<string, boolean>>({})
const loading = ref(!!route.params.id)
const loadError = ref(false) // 载入失败（网络波动）≠ 商品不存在——分开显「重试」态而非误报「商品不存在」死胡同（P3）
let msgLoadFail = false // 当前 banner 是否为「加载失败」——回刷成功只清它、不误清上架等动作反馈（P3）
const message = ref('')
const busy = ref(false)
const pubConfirm = ref(false)

const STEP_NAMES = WIZARD_STEPS.map((s) => s.label)
// 步单源=URL ?step（决策§27②·Shell 侧栏与本页横向 rail 同读它·深链落到首个未完成步）·夹 1..6
// 还没建档（/launch）只能停在第 1 步
const step = computed(() => (id.value ? wizardStepFromQuery(route.query.step) : 1))

const courseId = computed(() => String(product.value?.courseId || '') || (id.value ? 'course-' + id.value : ''))
const steps = computed<StepDot[]>(() => (product.value ? productSteps(product.value, extras.value) : []))
const doneCount = computed(() => steps.value.filter((s) => s.done).length)
const state = computed(() => productState(id.value, listed.value))
const stateLabel = computed(() => (state.value === 'onsale' ? '小程序在售' : state.value === 'unlisted' ? '已从橱窗拿下' : '草稿（顾客看不见）'))
const missing = computed(() => (product.value ? basicsMissing(product.value) : []))
const canPublish = computed(() => !!product.value && wizardCanPublish(product.value))
// 下一步待办：第一个未完成步（引导「先做这个」）；全齐则空
const nextTodo = computed(() => {
  const i = steps.value.findIndex((s) => !s.done)
  return i < 0 ? null : { n: i + 1, name: STEP_NAMES[i] }
})

// 载入商品档 + 6 步派生真值（listDrafts 一次给 list/listed/urls + hasVideo/cardFinal/hasBatch）
async function reloadProduct() {
  if (!id.value) {
    product.value = null
    loading.value = false
    return
  }
  pubConfirm.value = false // 刷新即复位危险态（P1·防旧武装的「确认同步」残留、重进一击直发·批3 规格）
  loadError.value = false
  const r: any = await listDrafts()
  if (!r.ok) {
    // 载入失败：仅在「还没载到商品」（初次深链·product 仍 null）时显全屏可重试态区别于「商品不存在」；
    // 已载入后的刷新失败（@saved autosave 回刷 / 切步回刷）只降级为 message banner、不撕掉正在编辑的向导+内嵌编辑器（P2 回归修·reloadProduct 是共享回刷路径）
    if (!product.value) loadError.value = true
    message.value = '加载失败：' + String(r.error || '')
    msgLoadFail = true
    loading.value = false
    return
  }
  if (msgLoadFail) {
    message.value = '' // 回刷成功只清上次残留的「加载失败」banner（批10 让回刷失败保编辑器不撕后·否则常驻工作中的编辑器上·P3）
    msgLoadFail = false
  }
  product.value = (r.list as Record<string, any>[]).find((p) => String(p.id || p._id) === id.value) || null
  listed.value = r.listed || {}
  extras.value = { hasVideo: r.hasVideo || {}, cardFinal: r.cardFinal || {}, hasBatch: r.hasBatch || {} }
  loading.value = false
}
function retryLoad() {
  loading.value = true
  void reloadProduct()
}

function go(n: number) {
  if (n < 1 || n > 6 || n === step.value) return
  // 批量上传在途拦截（P1·bug sweep Round2 item12c）：Wizard 切步＝仅 query 变化＝路由 update 非 leave，
  // Courses.vue 内嵌的 onBeforeRouteLeave 不会触发——这是 batchUpload 孤儿化的主触发路径，须在这里前置拦。
  if (isUploadLocked()) {
    message.value = '批量上传进行中，切步将丢失未落库的视频关联，请等其完成再切步'
    msgLoadFail = false
    return
  }
  // 步写进 URL（单源）→ step 重算 → watch 触发刷新；Shell 侧栏点步走 router-link 同径同步
  void router.push({ path: route.path, query: { ...route.query, step: String(n) } })
}

function railState(n: number): 'current' | 'done' | 'todo' {
  if (n === step.value) return 'current'
  return steps.value[n - 1]?.done ? 'done' : 'todo'
}

async function shelve() {
  if (busy.value || !canPublish.value || !id.value) return
  if (!pubConfirm.value) {
    pubConfirm.value = true
    return
  }
  pubConfirm.value = false
  busy.value = true
  const r: any = await publishProduct(id.value)
  busy.value = false
  if (r.ok) {
    message.value = '已同步到小程序，打开小程序即可看到该商品'
    msgLoadFail = false // 这是动作反馈·非加载失败——随后的 reloadProduct 成功不得把它当 stale banner 清掉（病根#14）
    void reloadProduct()
  } else {
    message.value = '同步到小程序没成功：' + String(r.error || '')
    msgLoadFail = false
  }
}

async function createDraft() {
  if (busy.value) return
  busy.value = true
  const newId = 'p' + Date.now().toString(36)
  const r: any = await saveDraft(freshDraft(newId))
  busy.value = false
  if (!r.ok) {
    message.value = '建立草稿没成功：' + String(r.error || '')
    msgLoadFail = false
    return
  }
  void router.replace({ path: `/products/${newId}/wizard`, query: { step: '2' } })
}

// 切步 / 从 /launch 建档后换成带编号路由 → 刷新进度真值 + 收起同步二次确认
watch([step, id], () => {
  pubConfirm.value = false
  if (id.value) void reloadProduct()
  else {
    product.value = null
    loading.value = false
  }
})

onMounted(() => {
  if (id.value) void reloadProduct()
  else loading.value = false
})
</script>

<template>
  <div class="ld-page">
    <EmptyState v-if="loading" text="加载中…" />
    <EmptyState v-else-if="loadError" :icon="Store" text="加载失败（可能是网络波动，非商品不存在）">
      <UiButton variant="primary" size="sm" @click="retryLoad">重试</UiButton>
      <UiButton variant="ghost" size="sm" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>回产品管理</span></UiButton>
    </EmptyState>

    <!-- /launch：还没建档，只做第 1 步（不得嵌整张商品表） -->
    <template v-else-if="!id">
      <a class="crumb" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>产品管理</span></a>
      <PageHeader title="上新" sub="第 1 / 6 步 · 先建草稿（顾客看不见）" />
      <p v-if="message" class="banner">{{ message }}</p>
      <section class="step-card">
        <div class="step-head"><h2>第 1 步 · 新建商品</h2></div>
        <div class="step-body">
          <p class="identity-lead">先建一档草稿。编号和课程号自动生成。顾客还看不见。</p>
          <p class="legend">保存草稿 ≠ 发布课程 ≠ 同步到小程序 ≠ 卡片定稿 ≠ 生成批次</p>
          <UiButton :disabled="busy" @click="createDraft">{{ busy ? '建立中…' : '建立草稿，进入下一步' }}</UiButton>
        </div>
      </section>
    </template>

    <EmptyState v-else-if="!product" :icon="Store" :text="'没有找到这个商品（编号 ' + id + '）'">
      <UiButton variant="ghost" size="sm" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>回产品管理</span></UiButton>
    </EmptyState>

    <template v-else>
      <a class="crumb" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>产品管理</span></a>
      <PageHeader :title="product.name || '上新'" :sub="'上新 · 第 ' + step + ' / 6 步 · 已完成 ' + doneCount + '/6'">
        <Badge v-if="state === 'onsale'" tone="green">小程序在售</Badge>
        <Badge v-else-if="state === 'unlisted'" tone="red">已从橱窗拿下</Badge>
        <Badge v-else tone="brand">草稿（顾客看不见）</Badge>
        <Badge v-if="missing.length" tone="red">同步到小程序还差：{{ missing.join('、') }}</Badge>
        <UiButton v-if="step !== 4" :disabled="!canPublish || busy" :title="canPublish ? '' : '补齐封面、名称、价格和规格后才能同步到小程序'" @click="shelve">
          <Store v-if="!busy" :size="15" :stroke-width="1.8" />
          {{ busy ? '同步中…' : pubConfirm ? '确认同步到小程序？' : '同步到小程序' }}
        </UiButton>
      </PageHeader>

      <p v-if="message" class="banner">{{ message }}</p>
      <p class="legend">保存草稿 ≠ 发布课程 ≠ 同步到小程序 ≠ 卡片定稿 ≠ 生成批次</p>

      <div class="rail">
        <template v-for="sn in 6" :key="sn">
          <span v-if="sn > 1" class="rail-line" :class="{ lit: railState(sn) !== 'todo' || railState(sn - 1) === 'done' }"></span>
          <button class="rail-step" :class="railState(sn)" @click="go(sn)">
            <span class="rail-dot">
              <Check v-if="railState(sn) === 'done'" :size="12" :stroke-width="2.6" />
              <template v-else>{{ sn }}</template>
            </span>
            <span class="rail-name">{{ STEP_NAMES[sn - 1] }}</span>
          </button>
        </template>
      </div>

      <section class="step-card">
        <div class="step-head">
          <h2>第 {{ step }} 步 · {{ STEP_NAMES[step - 1] }}</h2>
          <span v-if="nextTodo && nextTodo.n !== step" class="next-hint">下一个待办：第 {{ nextTodo.n }} 步 {{ nextTodo.name }}</span>
        </div>

        <div class="step-body">
          <div v-if="step === 1" class="identity">
            <p>商品编号 <code>{{ id }}</code> · 课程编号 <code>{{ courseId }}</code></p>
            <p>状态：{{ stateLabel }} · 已完成 {{ doneCount }}/6</p>
            <p class="identity-lead">草稿已建。顾客还看不见。下一步改图片与名字。</p>
          </div>
          <Products v-else-if="step === 2" embed :wizard-product-id="id" :wizard-slice="2" @saved="reloadProduct" />
          <Products v-else-if="step === 3" embed :wizard-product-id="id" :wizard-slice="3" @saved="reloadProduct" />
          <Courses v-else-if="step === 4" embed :wizard-course-id="courseId" />
          <Cards v-else-if="step === 5" embed :wizard-product-id="id" />
          <Batches v-else-if="step === 6" embed :wizard-course-id="courseId" />
        </div>
      </section>

      <div class="wiz-footer">
        <UiButton variant="ghost" :disabled="step === 1" @click="go(step - 1)">
          <ChevronLeft :size="15" :stroke-width="1.9" />
          <span>上一步{{ step > 1 ? ' · ' + STEP_NAMES[step - 2] : '' }}</span>
        </UiButton>
        <UiButton v-if="step < 6" @click="go(step + 1)">
          <span>下一步 · {{ STEP_NAMES[step] }}</span>
          <ChevronRight :size="15" :stroke-width="1.9" />
        </UiButton>
        <UiButton v-else @click="router.push('/products')">
          <Check :size="15" :stroke-width="2" />
          <span>完成 · 回产品管理</span>
        </UiButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 本页独有：向导壳（返回面包屑 / 上架提示 banner / 细进度条 / StepCard 容器 / 底部导航）。
 * 页头/徽章/空态/填充按钮已交共享原语（PageHeader / Badge / EmptyState / UiButton）。 */

/* 返回面包屑（TopBar 上方·回商品列表） */
.crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  font-size: 12.5px;
  color: var(--ld-content-2);
  cursor: pointer;
}
.crumb:hover {
  color: var(--ld-brand-active);
}

/* 上架结果提示（成功/错误同一软条·紫底） */
.banner {
  margin: 0;
  padding: 9px 14px;
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}

/* 细进度条：小圆点 + 细连接线（步导航主源在侧栏·此处轻量回显·可点跳步） */
.rail {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rail-line {
  flex: 1;
  height: 2px;
  border-radius: 2px;
  background: var(--ld-line);
}
.rail-line.lit {
  background: var(--ld-green);
}
.rail-step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  cursor: pointer;
}
.rail-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  background: var(--ld-bg-grey);
  border: 1px solid var(--ld-line-strong);
  color: var(--ld-content-2);
}
.rail-name {
  font-size: 12px;
  color: var(--ld-content-2);
}
.rail-step.done .rail-dot {
  background: var(--ld-bg-green-soft);
  border-color: var(--ld-green);
  color: var(--ld-green);
}
.rail-step.done .rail-name {
  color: var(--ld-content);
}
.rail-step.current .rail-dot {
  background: var(--ld-brand);
  border-color: var(--ld-brand);
  color: #fff;
}
.rail-step.current .rail-name {
  color: var(--ld-purple-ink);
  font-weight: 700;
}

/* StepCard：白卡·圆角12·$line 描边·padding24（design 向导壳·包裹嵌入子页） */
.step-card {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
  padding: 24px;
}
.step-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--ld-line);
}
.step-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ld-purple-ink);
}
.next-hint {
  font-size: 12px;
  color: var(--ld-content-2);
}
.legend {
  margin: 0;
  font-size: 12px;
  color: var(--ld-content-2);
}
.identity-lead {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--ld-content);
}
.identity p {
  margin: 0 0 8px;
  font-size: 14px;
}
.identity code {
  font-family: var(--ld-font-mono);
  font-size: 12px;
}
.step-body {
  min-height: 360px;
}

/* Footer：上一步 ghost（步1禁用·UiButton 自带禁用态）/ 下一步·完成 brand（两端对齐） */
.wiz-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>
