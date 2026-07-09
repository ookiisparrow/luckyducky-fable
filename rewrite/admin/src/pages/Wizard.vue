<script setup lang="ts">
// 上新分步向导（还原旧线 packages/admin StepWizard·换皮删成扁平表 + 只读进度圆点·「导向」这半没还原）：
// 顶部 6 步可点进度条 → 当前步嵌入对应工作面板 → 上一步/下一步 + 上架闸。
// 不重建 2500 行分步逻辑——功能都在 admin2 现有页里，本页只做「编排」：嵌入 Products 编辑器(步1-3)/Courses(步4)/
// Cards(步5)/Batches(步6)（各页 embed 模式·向后兼容）。进度真值走 listDrafts 后端 join 派生（productSteps·同列表列）。
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Store, ArrowLeft, ChevronLeft, ChevronRight, Check } from 'lucide-vue-next'
import { listDrafts, publishProduct } from '../api/products'
import { productSteps, productState, basicsMissing, wizardCanPublish, type StepDot } from '../lib/mapProducts'
import { wizardStepFromQuery } from '../lib/nav'
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
const id = String(route.params.id || '')

const product = ref<Record<string, any> | null>(null)
const extras = ref<{ hasVideo?: Record<string, boolean>; cardFinal?: Record<string, boolean>; hasBatch?: Record<string, boolean> }>({})
const listed = ref<Record<string, boolean>>({})
const loading = ref(true)
const loadError = ref(false) // 载入失败（网络波动）≠ 商品不存在——分开显「重试」态而非误报「商品不存在」死胡同（P3）
let msgLoadFail = false // 当前 banner 是否为「加载失败」——回刷成功只清它、不误清上架等动作反馈（P3）
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
  pubConfirm.value = false // 刷新即复位危险态（P1·防旧武装的「确认上架」残留、重进一击直发·批3 规格）
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
  product.value = (r.list as Record<string, any>[]).find((p) => String(p.id || p._id) === id) || null
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
    msgLoadFail = false // 这是动作反馈·非加载失败——随后的 reloadProduct 成功不得把它当 stale banner 清掉（病根#14）
    void reloadProduct()
  } else {
    // publishErrorText 四道门人话在列表页·此处后端已过前置预检，直报原文错误码
    message.value = '上架没成功：' + String(r.error || '')
    msgLoadFail = false
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
  <div class="ld-page">
    <EmptyState v-if="loading" text="加载中…" />
    <EmptyState v-else-if="loadError" :icon="Store" text="加载失败（可能是网络波动，非商品不存在）">
      <UiButton variant="primary" size="sm" @click="retryLoad">重试</UiButton>
      <UiButton variant="ghost" size="sm" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>回商品列表</span></UiButton>
    </EmptyState>
    <EmptyState v-else-if="!product" :icon="Store" :text="'没有找到这个商品（编号 ' + id + '）'">
      <UiButton variant="ghost" size="sm" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>回商品列表</span></UiButton>
    </EmptyState>

    <template v-else>
      <!-- TopBar：返回面包屑 + 标题/步进副标 + 在售/缺项徽章 + 上架 CTA -->
      <a class="crumb" @click="router.push('/products')"><ArrowLeft :size="14" :stroke-width="1.8" /><span>商品列表</span></a>
      <PageHeader :title="product.name || '新建商品'" :sub="'上新向导 · 第 ' + step + ' / 6 步 · 已完成 ' + doneCount + '/6'">
        <Badge v-if="state === 'onsale'" tone="green">在售</Badge>
        <Badge v-if="missing.length" tone="red">上架还差：{{ missing.join('、') }}</Badge>
        <UiButton :disabled="!canPublish || busy" :title="canPublish ? '' : '完成前三步（图片/信息/SKU）后可上架'" @click="shelve">
          <Store v-if="!busy" :size="15" :stroke-width="1.8" />
          {{ busy ? '上架中…' : pubConfirm ? '确认上架？' : state === 'onsale' ? '更新上架信息' : '上架小程序' }}
        </UiButton>
      </PageHeader>

      <p v-if="message" class="banner">{{ message }}</p>

      <!-- 细进度条：步导航主源在侧栏（Shell）·此处只作轻量进度回显（可点跳步·railState/go 不变） -->
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

      <!-- StepCard：白卡·圆角12·$line 描边·padding24·包裹本步嵌入子页 -->
      <section class="step-card">
        <div class="step-head">
          <h2>第 {{ step }} 步 · {{ STEP_NAMES[step - 1] }}</h2>
          <span v-if="nextTodo && nextTodo.n !== step" class="next-hint">下一个待办：第 {{ nextTodo.n }} 步 {{ nextTodo.name }}</span>
        </div>

        <div class="step-body">
          <!-- 步 1-3：商品图片/信息/SKU 同属商品编辑器（旧线 StepImages/StepInfo/StepSkus·新线合并为一编辑器） -->
          <!-- @saved：内嵌编辑器 autosave 落库后重算顶部上架闸/进度圆点/缺项徽章（P2·否则补齐必备项后向导头仍锁死） -->
          <Products v-if="step <= 3" embed :wizard-product-id="id" @saved="reloadProduct" />
          <Courses v-else-if="step === 4" embed :wizard-course-id="courseId" />
          <Cards v-else-if="step === 5" embed :wizard-product-id="id" />
          <Batches v-else-if="step === 6" embed :wizard-course-id="courseId" />
        </div>
      </section>

      <!-- Footer：上一步 ghost（步1禁用）/ 下一步·完成 brand（两端对齐） -->
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
          <span>完成 · 返回商品列表</span>
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
