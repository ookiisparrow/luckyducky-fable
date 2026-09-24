<script setup lang="ts">
// 上新分步向导：顶部 5 步可点进度条 → 当前步嵌入对应工作面板 → 上一步/下一步 + 上架闸。
// 编排：Products 切片(步1 封面 / 步2 图与名 / 步3 详情) / Courses(步4) / Cards 上传 + Batches(步5)。
// 进度真值走 listDrafts 后端 join 派生（productSteps·同列表列）。
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Store, ArrowLeft, ChevronLeft, ChevronRight, Check } from 'lucide-vue-next'
import { listDrafts, publishProduct, republishProduct, saveDraft } from '../api/products'
import {
  productSteps,
  productState,
  basicsMissing,
  wizardCanPublish,
  freshDraft,
  publishErrorText,
  draftSyncLabel,
  draftSyncConfirm,
  restoreSaleLabel,
  restoreSaleConfirm,
  restoreSaleOk,
  draftSyncBusy,
  draftSyncMissingHint,
  draftSyncOk,
  type StepDot,
} from '../lib/mapProducts'
import { launchErrorText } from '../lib/mapSystem'
import { wizardStepFromQuery, WIZARD_STEPS, WIZARD_STEP_MAX } from '../lib/nav'
import { isUploadLocked } from '../lib/uploadLock'
import { settleAllSaves } from '../lib/serialSave'
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
const restoreArmed = ref(false)
const createdDraftId = ref('') // /launch 刚建档后首包偶发读不到新档时，区分「暂未同步」与真不存在

const STEP_NAMES = WIZARD_STEPS.map((s) => s.label)
const STEP_HINTS = WIZARD_STEPS.map((s) => s.hint)
const LEGEND = [
  { term: '保存草稿', desc: '只存在后台，前台看不到' },
  { term: '发布课程', desc: '视频对已购学员可见' },
  { term: '上架', desc: '第一次公开卖' },
  { term: '同步到小程序', desc: '在售时把草稿推给顾客' },
  { term: '同步草稿', desc: '已下架时把新草稿写出去，商品仍停售' },
  { term: '恢复销售', desc: '按上次上架页再卖，不是刚才改的草稿' },
  { term: '上传卡片', desc: '把卡面素材交给印厂' },
  { term: '生成批次', desc: '产出可扫码的二维码序列' },
] as const
// 步单源=URL ?step（侧栏与本页横向 rail 同读它·深链落到首个未完成步）·夹 1..5
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

// 载入商品档 + 5 步派生真值（listDrafts 一次给 list/listed/urls + hasVideo/cardFinal/hasBatch）
async function reloadProduct() {
  if (!id.value) {
    product.value = null
    loading.value = false
    return
  }
  pubConfirm.value = false // 刷新即复位危险态（P1·防旧武装的「确认同步」残留、重进一击直发·批3 规格）
  restoreArmed.value = false
  loadError.value = false
  const r: any = await listDrafts()
  if (!r.ok) {
    // 载入失败：仅在「还没载到商品」（初次深链·product 仍 null）时显全屏可重试态区别于「商品不存在」；
    // 已载入后的刷新失败（@saved autosave 回刷 / 切步回刷）只降级为 message banner、不撕掉正在编辑的向导+内嵌编辑器（P2 回归修·reloadProduct 是共享回刷路径）
    if (!product.value) loadError.value = true
    message.value = launchErrorText(r.error)
    msgLoadFail = true
    loading.value = false
    return
  }
  if (msgLoadFail) {
    message.value = '' // 回刷成功只清上次残留的「加载失败」banner（批10 让回刷失败保编辑器不撕后·否则常驻工作中的编辑器上·P3）
    msgLoadFail = false
  }
  const found = (r.list as Record<string, any>[]).find((p) => String(p.id || p._id) === id.value)
  if (found) {
    product.value = found
    createdDraftId.value = '' // 刚建档已可读，清掉「同步中」上下文
  } else if (product.value && String(product.value.id || product.value._id) === id.value) {
    // 乐观写入还在：列表首包漏新档时保住向导，不闪「商品不存在」
  } else {
    product.value = null
  }
  listed.value = r.listed || {}
  extras.value = { hasVideo: r.hasVideo || {}, cardFinal: r.cardFinal || {}, hasBatch: r.hasBatch || {} }
  loading.value = false
}
function retryLoad() {
  loading.value = true
  void reloadProduct()
}

function go(n: number) {
  if (n < 1 || n > WIZARD_STEP_MAX || n === step.value) return
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
    message.value = draftSyncOk(state.value)
    msgLoadFail = false // 这是动作反馈·非加载失败——随后的 reloadProduct 成功不得把它当 stale banner 清掉（病根#14）
    void reloadProduct()
  } else {
    message.value = publishErrorText(r.error, state.value)
    msgLoadFail = false
  }
}

async function restoreSale() {
  if (busy.value || !id.value || state.value !== 'unlisted') return
  if (!restoreArmed.value) {
    restoreArmed.value = true
    return
  }
  restoreArmed.value = false
  busy.value = true
  const r: any = await republishProduct(id.value)
  busy.value = false
  if (r.ok) {
    message.value = restoreSaleOk()
    msgLoadFail = false
    void reloadProduct()
  } else {
    message.value = '恢复失败：' + String(r.error || '')
    msgLoadFail = false
  }
}

async function createDraft() {
  if (busy.value) return
  busy.value = true
  const newId = 'p' + Date.now().toString(36)
  const draft = freshDraft(newId)
  const r: any = await saveDraft(draft)
  busy.value = false
  if (!r.ok) {
    message.value = launchErrorText(r.error)
    msgLoadFail = false
    return
  }
  createdDraftId.value = newId
  product.value = draft
  listed.value = {}
  extras.value = {}
  // 同实例从 /launch 切到带编号路由：先写入档再换路由，避免 product 仍 null 时闪「没有找到这个商品」。
  loading.value = true
  void router.replace({ path: `/products/${newId}/wizard`, query: { step: '1' } })
}

// 切步 / 从 /launch 建档后换成带编号路由 → 刷新进度真值 + 收起同步二次确认
watch(id, () => {
  pubConfirm.value = false
  restoreArmed.value = false
  if (id.value) {
    const same = !!(product.value && String(product.value.id || product.value._id) === id.value)
    if (!same) loading.value = true // 换编号才转圈；同档切步不撕编辑器
    void reloadProduct()
  } else {
    createdDraftId.value = ''
    product.value = null
    loading.value = false
  }
})

watch(step, async () => {
  pubConfirm.value = false
  restoreArmed.value = false
  if (id.value) {
    await settleAllSaves()
    void reloadProduct()
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

    <!-- /launch：还没建档，第 1 步先建草稿（建完留在本步传封面） -->
    <template v-else-if="!id">
      <a class="crumb" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>产品管理</span></a>
      <PageHeader title="上新" sub="第 1 / 5 步 · 新建与封面" />
      <p v-if="message" class="banner">{{ message }}</p>
      <section class="step-card">
        <div class="step-head">
          <h2>新建与封面</h2>
          <span class="next-hint">先创建草稿并上传封面图，这两件事在同一步完成。</span>
        </div>
        <div class="step-body">
          <p class="identity-lead">先建一档草稿。编号和课程号自动生成。建好后在本步上传封面。顾客还看不见。</p>
          <UiButton :disabled="busy" @click="createDraft">{{ busy ? '建立中…' : '建立草稿，接着传封面' }}</UiButton>
        </div>
        <dl class="legend-grid">
          <div class="legend-cap">这些事互不等同</div>
          <div v-for="item in LEGEND" :key="item.term" class="legend-row">
            <dt>{{ item.term }}</dt>
            <dd>{{ item.desc }}</dd>
          </div>
        </dl>
      </section>
    </template>

    <EmptyState
      v-else-if="!product"
      :icon="Store"
      :text="id === createdDraftId ? '草稿已创建，列表还在同步，点「重试」继续（编号 ' + id + '）' : '没有找到这个商品（编号 ' + id + '）'"
    >
      <UiButton variant="primary" size="sm" @click="retryLoad">重试</UiButton>
      <UiButton variant="ghost" size="sm" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>回产品管理</span></UiButton>
    </EmptyState>

    <template v-else>
      <a class="crumb" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>产品管理</span></a>
      <PageHeader :title="product.name || '上新'" :sub="'上新 · 第 ' + step + ' / 5 步 · 已完成 ' + doneCount + '/5'">
        <Badge v-if="state === 'onsale'" tone="green">小程序在售</Badge>
        <Badge v-else-if="state === 'unlisted'" tone="red">已从橱窗拿下</Badge>
        <Badge v-else tone="brand">草稿（顾客看不见）</Badge>
        <Badge v-if="missing.length" tone="red">{{ draftSyncMissingHint(state, missing) }}</Badge>
        <UiButton :disabled="!canPublish || busy" :title="canPublish ? '' : '补齐封面、名称、价格和规格后才能' + draftSyncLabel(state)" @click="shelve">
          <Store v-if="!busy" :size="15" :stroke-width="1.8" />
          {{ busy ? draftSyncBusy(state) : pubConfirm ? draftSyncConfirm(state) : draftSyncLabel(state) }}
        </UiButton>
        <UiButton v-if="state === 'unlisted'" variant="ghost" :disabled="busy" @click="restoreSale">
          {{ restoreArmed ? restoreSaleConfirm() : restoreSaleLabel() }}
        </UiButton>
      </PageHeader>

      <p v-if="message" class="banner">{{ message }}</p>

      <div class="rail-card">
        <div class="rail">
          <template v-for="s in WIZARD_STEPS" :key="s.n">
            <button class="rail-step" :class="railState(s.n)" @click="go(s.n)">
              <span class="rail-dot">
                <Check v-if="railState(s.n) === 'done'" :size="12" :stroke-width="2.6" />
                <template v-else>{{ s.n }}</template>
              </span>
              <span class="rail-name">{{ s.label }}</span>
            </button>
            <span v-if="s.n < WIZARD_STEP_MAX" class="rail-line" :class="{ lit: railState(s.n) === 'done' }"></span>
          </template>
        </div>
      </div>

      <section class="step-card">
        <div class="step-head">
          <div>
            <h2>{{ STEP_NAMES[step - 1] }}</h2>
            <p class="step-hint">{{ STEP_HINTS[step - 1] }}</p>
          </div>
          <span v-if="nextTodo && nextTodo.n !== step" class="next-hint">下一个待办：第 {{ nextTodo.n }} 步 {{ nextTodo.name }}</span>
        </div>

        <div class="step-body">
          <div v-if="step === 1" class="step1">
            <div class="identity">
              <p>商品编号 <code>{{ id }}</code> · 课程编号 <code>{{ courseId }}</code></p>
              <p>状态：{{ stateLabel }} · 已完成 {{ doneCount }}/5</p>
              <p class="identity-lead">草稿已建。顾客还看不见。本步上传封面，下一步再改相册和名字。</p>
            </div>
            <Products embed :wizard-product-id="id" :wizard-slice="1" @saved="reloadProduct" />
          </div>
          <Products v-else-if="step === 2" embed :wizard-product-id="id" :wizard-slice="2" @saved="reloadProduct" />
          <Products v-else-if="step === 3" embed :wizard-product-id="id" :wizard-slice="3" @saved="reloadProduct" />
          <Courses v-else-if="step === 4" embed :wizard-course-id="courseId" @saved="reloadProduct" />
          <div v-else-if="step === 5" class="step5">
            <section class="step5-sec">
              <header class="step5-head">
                <h3>卡片素材</h3>
                <p>这里只负责上传成品卡面，不做设计。设计稿请在设计工具中完成后导出上传。</p>
              </header>
              <Cards embed :wizard-product-id="id" @saved="reloadProduct" />
            </section>
            <section class="step5-sec">
              <header class="step5-head">
                <h3>二维码批次</h3>
                <p>生成可扫码的激活码，一码一用。</p>
              </header>
              <Batches embed :wizard-course-id="courseId" :course-ready="!!(extras.hasVideo && extras.hasVideo[courseId])" @saved="reloadProduct" />
            </section>
          </div>
        </div>
        <dl v-if="step === 1" class="legend-grid">
          <div class="legend-cap">这些事互不等同</div>
          <div v-for="item in LEGEND" :key="item.term" class="legend-row">
            <dt>{{ item.term }}</dt>
            <dd>{{ item.desc }}</dd>
          </div>
        </dl>
      </section>

      <div class="wiz-footer">
        <UiButton variant="ghost" :disabled="step === 1" @click="go(step - 1)">
          <ChevronLeft :size="15" :stroke-width="1.9" />
          <span>上一步{{ step > 1 ? ' · ' + STEP_NAMES[step - 2] : '' }}</span>
        </UiButton>
        <UiButton v-if="step < WIZARD_STEP_MAX" @click="go(step + 1)">
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

/* 进度条：白卡托起·当前步淡紫底（步导航主源在侧栏·此处可点跳步） */
.rail-card {
  padding: 8px 10px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
}
.rail {
  display: flex;
  align-items: center;
  gap: 4px;
}
.rail-line {
  width: 16px;
  height: 1px;
  flex: none;
  background: var(--ld-line-strong);
}
.rail-line.lit {
  background: var(--ld-purple-line);
}
.rail-step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-step.done .rail-dot {
  background: var(--ld-bg-green-soft);
  border-color: var(--ld-green);
  color: var(--ld-green);
}
.rail-step.done .rail-name {
  color: var(--ld-content);
}
.rail-step.current {
  background: var(--ld-bg-lilac);
}
.rail-step.current .rail-dot {
  background: var(--ld-bg);
  border-color: var(--ld-brand);
  color: var(--ld-brand-active);
}
.rail-step.current .rail-name {
  color: var(--ld-brand-active);
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
.step-hint {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.next-hint {
  font-size: 12px;
  color: var(--ld-content-2);
}
.legend-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px 20px;
  margin: 20px 0 0;
  padding: 14px 16px;
  border-top: 1px solid var(--ld-line);
  background: var(--ld-bg-faint);
}
.legend-cap {
  grid-column: 1 / -1;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-content);
}
.legend-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.legend-row dt {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-ink);
  white-space: nowrap;
}
.legend-row dd {
  margin: 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
  min-width: 0;
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
.step1 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
  gap: 28px;
  align-items: start;
}
@media (max-width: 820px) {
  .step1 {
    grid-template-columns: 1fr;
  }
}
.step5 {
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.step5-sec {
  padding-bottom: 8px;
}
.step5-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ld-purple-ink);
}
.step5-head p {
  margin: 4px 0 14px;
  font-size: 12.5px;
  color: var(--ld-content-2);
}

/* Footer：上一步 ghost（步1禁用·UiButton 自带禁用态）/ 下一步·完成 brand（两端对齐） */
.wiz-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>
