<script setup lang="ts">
// 商品管理（design/console.pen S11 视觉·M3 UI 批3）：页头+流水线副标+筛选 chip（真计数）+ 搜索（按名）
// + 三态表格（关联课程/规格·图列 + 6 步上新进度圆点）+ 编辑器（整档 round-trip·图片压缩·危操作两步确认）。
// 「6 步上新进度」换皮误判「无源」——实则 cards/courses/qrcodes 后端 listDrafts bounded join 派生（视频/卡片/批次态·二轮批Cards-3 还原）。
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Search, Trash2, Package } from 'lucide-vue-next'
import { listDrafts, saveDraft, deleteDraft, uploadImage, publishProduct, unpublishProduct, republishProduct } from '../api/products'
import { mapDraftRows, publishErrorText, b64SizeOk, basicsMissing, type DraftRowVM } from '../lib/mapProducts'
import { serialSave } from '../lib/serialSave'
import { useRouter } from 'vue-router'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const KIT_ICONS = ['circle', 'pen-tool', 'cloud', 'eye', 'book-open', 'sparkles-purple', 'package', 'truck'] // 材料清单图标（换皮丢了选择器·恒 circle）

// 嵌入模式（上新向导步 1-3 复用本编辑器·向后兼容·独立 /products 路由用法不传 props 行为不变）：
// embed=true 隐列表壳只留编辑器·wizardProductId 指定要编辑的商品档（向导载入后自动打开）。
const props = defineProps<{ embed?: boolean; wizardProductId?: string }>()

const router = useRouter()
// 商品→课程深链（换皮丢了入口·Courses 页占位文案承诺「商品页会带入」但没按钮）：courseId=商品档 courseId 或 course-<id>
async function editCourse(row: DraftRowVM) {
  const existing = String((row.raw as any).courseId || '')
  const cid = existing || 'course-' + row.id
  // courseId 落库（换皮只算不存·商品与课程/批次关联要人工输易错）：首次深链即写回商品档
  if (!existing) {
    await saveDraft({ ...(row.raw as Record<string, unknown>), courseId: cid })
    void silentRefresh()
  }
  void router.push({ path: '/courses', query: { courseId: cid } })
}

const rows = ref<DraftRowVM[]>([])
const message = ref('')
const busy = ref(false)
const confirmKey = ref('') // 两步确认（`del:<id>` / `off:<id>`）
const edit = ref<Record<string, any> | null>(null)
const coverPreview = ref('')
const search = ref('')
const filter = ref<'all' | 'onsale' | 'preparing' | 'unlisted'>('all')

const counts = computed(() => ({
  all: rows.value.length,
  onsale: rows.value.filter((r) => r.state === 'onsale').length,
  preparing: rows.value.filter((r) => r.state === 'preparing').length,
  unlisted: rows.value.filter((r) => r.state === 'unlisted').length,
}))
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'onsale', label: '在售' },
  { key: 'preparing', label: '筹备中' },
  { key: 'unlisted', label: '已下架' },
] as const
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(
    (r) => (filter.value === 'all' || r.state === filter.value) && (!q || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
  )
})
const imgCount = (r: DraftRowVM) => (Array.isArray((r.raw as any).images) ? (r.raw as any).images.length : 0)
// 圆点深链：进上新向导落到第一个未完成步（全完成落第 1 步）
const firstTodoStep = (r: DraftRowVM) => (r.steps.findIndex((s) => !s.done) + 1) || 1
const courseOf = (r: DraftRowVM) => String((r.raw as any).courseId || '')

// 图片 fileID→url 解析：listDrafts 回的 urls 映射（已存图）+ 本会话新上传的 url
const urlMap = ref<Record<string, string>>({})
const sessionUrls = ref<Record<string, string>>({})
const imgUrl = (fileID: string) => sessionUrls.value[fileID] || urlMap.value[fileID] || ''

async function reload() {
  message.value = '加载中…'
  const r = await listDrafts()
  urlMap.value = r.ok && (r as any).urls ? (r as any).urls : {}
  rows.value = r.ok ? mapDraftRows(r.list, r.urls, r.listed, stepExtras(r)) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}
// listDrafts 派生的 6 步分步态（后端 join·换皮误判「无源」）
const stepExtras = (r: any) => ({ hasVideo: r.hasVideo || {}, cardFinal: r.cardFinal || {}, hasBatch: r.hasBatch || {} })
// 静默刷新列表（不闪「加载中」·不打断正在编辑的编辑器）
async function silentRefresh() {
  const r = await listDrafts()
  if (r.ok) {
    urlMap.value = (r as any).urls || {}
    rows.value = mapDraftRows(r.list, r.urls, r.listed, stepExtras(r))
  }
}

// —— 防抖自动保存（换皮把「编排即自动存」退成手动「保存草稿」·忘点即丢·且已上传的封面/相册 fileID 成孤儿）——
const autoState = ref('') // '' | saving | saved | error
let saveTimer: ReturnType<typeof setTimeout> | null = null
let editorLoaded = false // load-guard：打开/新建时的赋值不触发自动保存
watch(
  edit,
  () => {
    if (!edit.value || !editorLoaded) return
    autoState.value = 'saving'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void flushSave(), 900)
  },
  { deep: true }
)
async function autosave() {
  if (!edit.value) return
  const r = await saveDraft(edit.value)
  autoState.value = r.ok ? 'saved' : 'error'
  if (r.ok) void silentRefresh()
}
const flushSave = serialSave(autosave) // 串行化·防慢网下两次自动保存乱序覆盖（P2·根因#8）
function markLoaded() {
  editorLoaded = false
  autoState.value = ''
  void nextTick(() => (editorLoaded = true)) // 赋值落定后再放开自动保存
}
function closeEditor() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  // 同步抓快照 + 立即关闭（杜绝关闭期手输）：有未落盘编辑就排空在途后存**快照**（不读实时 ref、不被置空击穿）。
  // 修两回归：批4b「在途保存期关闭丢最后编辑」(迭代D) + 批5「await 期间手输丢失/孤儿计时器」(迭代E)。
  const snap = autoState.value === 'saving' && edit.value ? (JSON.parse(JSON.stringify(edit.value)) as Record<string, any>) : null
  editorLoaded = false
  edit.value = null
  if (snap)
    void flushSave() // 先排空任何在途 autosave（其 run 读已 null 的 edit→no-op·仅用于等排空）
      .then(() => saveDraft(snap)) // 排空后存快照·成为最后一次写（不被旧在途覆盖）
      .then(() => void silentRefresh())
      .catch(() => {})
}
onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    void flushSave()
  }
})

function newProduct() {
  edit.value = { id: 'p' + Date.now().toString(36), name: '', tag: '', brief: '', price: '', was: '', cover: '', images: [], skus: [], params: [], detailSections: [], kit: [], courseId: '' }
  coverPreview.value = ''
  markLoaded()
}

function openEdit(row: DraftRowVM) {
  edit.value = JSON.parse(JSON.stringify(row.raw)) // 整档拷贝·round-trip 防抹字段
  coverPreview.value = row.coverUrl
  markLoaded()
}

function addSku() {
  if (edit.value) (edit.value.skus as any[]).push({ name: '', price: edit.value.price || '' }) // 默认带商品现价（换皮恒空价·手抄易错）
}
function clearCover() {
  if (edit.value) {
    edit.value.cover = ''
    coverPreview.value = ''
  }
}
function delSku(i: number) {
  if (edit.value) (edit.value.skus as any[]).splice(i, 1)
}

async function pickCover(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file || !edit.value) return
  const b64 = await compress(file)
  if (!b64SizeOk(b64)) {
    message.value = '图片压缩后仍超限，换小一点的图'
    return
  }
  busy.value = true
  const r = await uploadImage(b64, String(edit.value.id), 'jpg')
  busy.value = false
  if (r.ok) {
    edit.value.cover = String(r.fileID || '')
    coverPreview.value = String(r.url || '')
    message.value = ''
  } else {
    message.value = '图片上传失败：' + String(r.error || '')
  }
}

// 前端压缩（canvas ≤720px 宽·jpeg 0.8→0.5 逐档压到 80K 内）
async function compress(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const scale = Math.min(1, 720 / img.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const q of [0.8, 0.65, 0.5, 0.35]) {
      const b64 = canvas.toDataURL('image/jpeg', q).split(',')[1] || ''
      if (b64SizeOk(b64)) return b64
    }
    return ''
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function doSave() {
  if (!edit.value || busy.value) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  busy.value = true
  const r = await saveDraft(edit.value)
  busy.value = false
  message.value = r.ok ? '' : '保存失败：' + String(r.error || '')
  if (r.ok) {
    editorLoaded = false
    edit.value = null
    void reload()
  }
}

// 上架两步确认（换皮直接上架无确认·上架即对小程序可见·应有一道）
const doPublish = (id: string) =>
  twoStep('pub:' + id, async () => {
    busy.value = true
    const r = await publishProduct(id)
    busy.value = false
    message.value = r.ok ? '' : publishErrorText(r.error) // 四道门人话
    void reload()
  })

async function twoStep(key: string, run: () => Promise<void>) {
  if (confirmKey.value !== key) {
    confirmKey.value = key
    return
  }
  confirmKey.value = ''
  await run()
}

const doUnpublish = (id: string) =>
  twoStep('off:' + id, async () => {
    const r = await unpublishProduct(id)
    message.value = r.ok ? '' : '下架失败：' + String(r.error || '')
    void reload()
  })

// 恢复销售＝把已下架商品重新对小程序可见（可见性变更·同上/下架应有一道二次确认·审核补漏）
const doRepublish = (id: string) =>
  twoStep('re:' + id, async () => {
    const r = await republishProduct(id)
    message.value = r.ok ? '' : '恢复失败：' + String(r.error || '')
    void reload()
  })

const doDelete = (id: string) =>
  twoStep('del:' + id, async () => {
    const r = await deleteDraft(id)
    message.value = r.ok ? '' : '删除失败：' + String(r.error || '')
    void reload()
  })

// —— 多图相册（换皮丢·仅 round-trip 保全无编辑 UI）：多选上传·压缩·增删·排序 ——
async function addImages(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = input.files
  if (!files || !edit.value) return
  busy.value = true
  for (const file of Array.from(files)) {
    const b64 = await compress(file)
    if (!b64SizeOk(b64)) {
      message.value = '有图压缩后仍超限，已跳过'
      continue
    }
    const r = await uploadImage(b64, String(edit.value.id), 'jpg')
    if (r.ok && r.fileID) {
      ;(edit.value.images as string[]).push(String(r.fileID))
      sessionUrls.value[String(r.fileID)] = String(r.url || '')
    } else {
      message.value = '有图上传失败：' + String(r.error || '')
    }
  }
  busy.value = false
  input.value = '' // 允许再次选同一批
}
function delImage(i: number) {
  if (edit.value) (edit.value.images as unknown[]).splice(i, 1)
}
function moveImage(i: number, dir: number) {
  if (!edit.value) return
  const arr = edit.value.images as unknown[]
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  const t = arr[i]
  arr[i] = arr[j]
  arr[j] = t
}
// —— 参数表(≤8·[k,v] 元组) / 详情段落(≤4·{lead,body}) / 材料清单(≤8·{icon,name,qty})：1:1 旧 StepInfo shape ——
function addParam() {
  if (edit.value && (edit.value.params as unknown[]).length < 8) (edit.value.params as unknown[]).push(['', ''])
}
function delParam(i: number) {
  if (edit.value) (edit.value.params as unknown[]).splice(i, 1)
}
function addSection() {
  if (edit.value && (edit.value.detailSections as unknown[]).length < 4) (edit.value.detailSections as unknown[]).push({ lead: '', body: '' })
}
function delSection(i: number) {
  if (edit.value) (edit.value.detailSections as unknown[]).splice(i, 1)
}
function addKit() {
  if (edit.value && (edit.value.kit as unknown[]).length < 8) (edit.value.kit as unknown[]).push({ icon: 'circle', name: '', qty: '' })
}
function delKit(i: number) {
  if (edit.value) (edit.value.kit as unknown[]).splice(i, 1)
}

// 上架前缺项预检（1:1 旧 Wizard missing·换皮退成事后报错）：封面/名称/价格/有效规格四项必备。
// basicsMissing 单源（向导上架闸与本页预检同口径·守卫 rw-admin-products-ui-golden）。
const missing = computed(() => (edit.value ? basicsMissing(edit.value) : []))

onMounted(async () => {
  await reload()
  // 嵌入向导：载入后自动打开目标商品的编辑器（步 1-3 面板即本编辑器）
  if (props.embed && props.wizardProductId) {
    const row = rows.value.find((r) => r.id === props.wizardProductId)
    if (row) openEdit(row)
  }
})
</script>

<template>
  <div class="ld-page" :class="{ embed }">
    <!-- 页头（独立态显·embed 隐·右操作＝新建商品） -->
    <PageHeader
      v-if="!embed"
      title="商品与上新"
      sub="一款商品一条流水线：产品图片 → 商品信息 → SKU → 教学视频 → 二维码卡片 → 码批次"
    >
      <UiButton @click="newProduct">＋ 新建商品</UiButton>
    </PageHeader>

    <!-- 工具条：筛选 chip（真计数）+ 搜索（独立态显·embed 隐） -->
    <div v-if="!embed" class="ld-toolbar">
      <button v-for="f in FILTERS" :key="f.key" class="ld-chip" :class="{ on: filter === f.key }" @click="filter = f.key">
        {{ f.label }}<span class="chip-n">{{ counts[f.key] }}</span>
      </button>
      <div class="ld-search prod-search">
        <Search :size="15" :stroke-width="1.8" />
        <input v-model="search" placeholder="搜索商品名 / 编号" />
      </div>
    </div>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <!-- 商品表卡（S11 表格语言·独立态显·embed 隐） -->
    <Card v-if="shown.length && !embed" flush>
      <div class="ld-thead">
        <div class="ld-th grow">商品</div>
        <div class="ld-th" :style="{ width: '130px' }">关联课程</div>
        <div class="ld-th" :style="{ width: '80px' }">价格</div>
        <div class="ld-th" :style="{ width: '108px' }">规格 / 图</div>
        <div class="ld-th" :style="{ width: '150px' }">上新进度</div>
        <div class="ld-th" :style="{ width: '92px' }">状态</div>
        <div class="ld-th" :style="{ width: '260px' }">操作</div>
      </div>
      <div class="ld-tbody">
        <div v-for="row in shown" :key="row.id" class="ld-tr">
          <div class="ld-td grow prod">
            <img v-if="row.coverUrl" :src="row.coverUrl" class="thumb" />
            <span v-else class="thumb empty">无图</span>
            <div class="prod-text">
              <div class="prod-name">{{ row.name }}</div>
              <div class="pid">{{ row.id }}</div>
            </div>
          </div>
          <div class="ld-td course" :style="{ width: '130px' }">{{ courseOf(row) || '未关联' }}</div>
          <div class="ld-td price" :style="{ width: '80px' }">{{ row.priceLabel }}</div>
          <div class="ld-td spec" :style="{ width: '108px' }">{{ row.skuCount }} 规格 · {{ imgCount(row) }} 图</div>
          <!-- 6 步上新进度圆点（真值 productSteps·后端 listDrafts 派生视频/卡片/批次态·根因#7 bounded join）·点击进上新向导落到第一个未完成步 -->
          <div class="ld-td" :style="{ width: '150px' }">
            <div
              class="steps-cell"
              :title="row.steps.map((s) => (s.done ? '✓' : '○') + ' ' + s.label).join(' · ') + ' · 点击进上新向导'"
              @click="router.push('/products/' + row.id + '/wizard?step=' + firstTodoStep(row))"
            >
              <span v-for="s in row.steps" :key="s.key" class="dot" :class="{ on: s.done }"></span>
              <span class="done-n">{{ row.doneCount }}/6</span>
            </div>
          </div>
          <div class="ld-td" :style="{ width: '92px' }">
            <Badge :tone="row.state === 'onsale' ? 'green' : row.state === 'unlisted' ? 'red' : 'brand'">{{ row.stateLabel }}</Badge>
          </div>
          <div class="ld-td ops" :style="{ width: '260px' }">
            <UiButton variant="ghost" size="sm" title="6 步上新向导：图片→信息→SKU→视频→卡片→批次" @click="router.push('/products/' + row.id + '/wizard')">上新向导</UiButton>
            <UiButton variant="ghost" size="sm" @click="openEdit(row)">编辑</UiButton>
            <UiButton variant="ghost" size="sm" @click="editCourse(row)">编辑课程</UiButton>
            <UiButton variant="ghost" size="sm" @click="router.push({ path: '/cards', query: { productId: row.id } })">卡片设计</UiButton>
            <UiButton v-if="row.state === 'preparing'" variant="primary" size="sm" @click="doPublish(row.id)">{{ confirmKey === 'pub:' + row.id ? '确认上架？' : '上架' }}</UiButton>
            <UiButton v-if="row.state === 'onsale'" variant="ghost" size="sm" @click="doPublish(row.id)">{{ confirmKey === 'pub:' + row.id ? '确认重上？' : '重新上架' }}</UiButton>
            <UiButton v-if="row.state === 'onsale'" variant="danger" size="sm" @click="doUnpublish(row.id)">{{ confirmKey === 'off:' + row.id ? '确认下架？' : '下架' }}</UiButton>
            <UiButton v-if="row.state === 'unlisted'" variant="primary" size="sm" @click="doRepublish(row.id)">{{ confirmKey === 're:' + row.id ? '确认恢复销售？' : '恢复销售' }}</UiButton>
            <button class="icon-btn" :title="confirmKey === 'del:' + row.id ? '连已上架一起删？' : '删除'" @click="doDelete(row.id)">
              <Trash2 :size="15" :stroke-width="1.8" />
            </button>
          </div>
        </div>
      </div>
      <div class="tfoot">共 {{ counts.all }} 款商品<span v-if="filter !== 'all' || search">（当前筛选 {{ shown.length }}）</span></div>
    </Card>
    <EmptyState
      v-else-if="!message && !embed"
      :icon="Package"
      :text="rows.length ? '没有符合筛选的商品' : '还没有商品，点「新建商品」开始'"
    />

    <!-- 编辑器（独立态 + embed 步 1-3 都显·白卡语言·embed 时去外框由向导供卡） -->
    <div v-if="edit" class="editor">
      <h3>{{ edit.name || '新商品' }} <span class="pid">{{ edit.id }}</span>
        <span class="auto" :class="autoState">{{ autoState === 'saving' ? '自动保存中…' : autoState === 'saved' ? '已自动保存' : autoState === 'error' ? '自动保存失败' : '' }}</span>
      </h3>
      <div class="grid">
        <label>名称 <input v-model="edit.name" maxlength="60" /></label>
        <label>标签 <input v-model="edit.tag" maxlength="20" placeholder="如 送礼首选" /></label>
        <label>价格（元）<input v-model="edit.price" /></label>
        <label>划线价 <input v-model="edit.was" /></label>
        <label class="wide">一句话简介 <input v-model="edit.brief" maxlength="120" /></label>
        <label>关联课程 <input v-model="edit.courseId" placeholder="course-xxx（可空）" /></label>
        <label>封面图
          <input type="file" accept="image/*" @change="pickCover" />
        </label>
      </div>
      <div v-if="coverPreview" class="cover-wrap">
        <img :src="coverPreview" class="cover-preview" />
        <UiButton variant="ghost" size="sm" @click="clearCover">删除封面</UiButton>
      </div>
      <h4>规格（SKU）</h4>
      <div v-for="(s, i) in edit.skus" :key="i" class="skurow">
        <input v-model="s.name" placeholder="规格名" maxlength="30" />
        <input v-model="s.price" placeholder="价格（元）" />
        <button class="icon-btn" title="删除该规格" @click="delSku(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
      </div>
      <UiButton variant="ghost" size="sm" @click="addSku">＋ 加规格</UiButton>

      <h4>商品相册（小程序详情页轮播 · 可拖序 ‹ ›）</h4>
      <div class="gallery">
        <div v-for="(f, i) in (edit.images as string[])" :key="i" class="g-item">
          <img v-if="imgUrl(f)" :src="imgUrl(f)" alt="" />
          <span v-else class="g-ph">已存图</span>
          <div class="g-ops">
            <button v-if="i > 0" title="前移" @click="moveImage(i, -1)">‹</button>
            <button v-if="i < (edit.images as string[]).length - 1" title="后移" @click="moveImage(i, 1)">›</button>
            <button class="g-del" title="删除" @click="delImage(i)">✕</button>
          </div>
        </div>
        <label class="g-add">＋ 加图<input type="file" accept="image/*" multiple hidden @change="addImages" /></label>
      </div>

      <h4>参数表（≤8）</h4>
      <div v-for="(p, i) in (edit.params as string[][])" :key="i" class="kvrow">
        <input v-model="p[0]" placeholder="参数名（如 适用年龄）" maxlength="20" />
        <input v-model="p[1]" placeholder="参数值（如 8 岁+）" maxlength="40" />
        <button class="icon-btn" title="删除该参数" @click="delParam(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
      </div>
      <UiButton variant="ghost" size="sm" :disabled="(edit.params as unknown[]).length >= 8" @click="addParam">＋ 加参数</UiButton>

      <h4>详情段落（≤4）</h4>
      <div v-for="(d, i) in (edit.detailSections as { lead: string; body: string }[])" :key="i" class="secrow">
        <div class="secrow-head">
          <input v-model="d.lead" placeholder="小标题" maxlength="30" />
          <button class="icon-btn" title="删除该段落" @click="delSection(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
        </div>
        <textarea v-model="d.body" placeholder="段落正文" maxlength="200" rows="2" />
      </div>
      <UiButton variant="ghost" size="sm" :disabled="(edit.detailSections as unknown[]).length >= 4" @click="addSection">＋ 加段落</UiButton>

      <h4>材料清单（≤8）</h4>
      <div v-for="(k, i) in (edit.kit as { icon: string; name: string; qty: string }[])" :key="i" class="kvrow">
        <select v-model="k.icon" class="kit-icon" title="图标">
          <option v-for="ic in KIT_ICONS" :key="ic" :value="ic">{{ ic }}</option>
        </select>
        <input v-model="k.name" placeholder="物品名" maxlength="14" />
        <input v-model="k.qty" placeholder="数量（如 1 包 50g）" maxlength="14" />
        <button class="icon-btn" title="删除该材料" @click="delKit(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
      </div>
      <UiButton variant="ghost" size="sm" :disabled="(edit.kit as unknown[]).length >= 8" @click="addKit">＋ 加材料</UiButton>

      <!-- 上架前缺项预检（换皮退成事后报错·1:1 旧 Wizard missing） -->
      <p v-if="missing.length" class="preflight">上架还差：<b>{{ missing.join('、') }}</b>（补齐保存后到列表点「上架」）</p>
      <p v-else class="preflight ok">✓ 必备项齐全，保存后可到列表上架</p>

      <div class="editor-ops">
        <UiButton variant="primary" :disabled="busy" @click="doSave">保存草稿</UiButton>
        <UiButton v-if="!embed" variant="ghost" @click="closeEditor">关闭</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 嵌入向导步 1-3：编辑器去白卡外框（向导已提供卡片容器） */
.embed .editor {
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  max-width: none;
}

/* 筛选 chip 计数徽章（design：bg-grey 药丸·激活时 brand 底白字） */
.chip-n {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ld-bg-grey);
  color: var(--ld-content-2);
  font-size: 11px;
  font-weight: 600;
}
.ld-chip.on .chip-n {
  background: var(--ld-brand);
  color: #fff;
}
.prod-search {
  margin-left: auto;
}

/* 6 步上新进度圆点（可点深链进向导） */
.steps-cell {
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  border-radius: 999px;
  padding: 4px 6px;
  margin: -4px -6px;
}
.steps-cell:hover {
  background: var(--ld-bg-lilac);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ld-bg-faint);
  border: 1px solid var(--ld-line-strong);
  flex: none;
}
.dot.on {
  background: var(--ld-brand);
  border-color: var(--ld-brand);
}
.done-n {
  margin-left: 5px;
  font-size: 11px;
  color: var(--ld-content-2);
}

/* 商品列（缩略图 + 名/编号） */
.prod {
  gap: 12px;
}
.thumb {
  width: 46px;
  height: 46px;
  flex: none;
  object-fit: cover;
  border-radius: 10px;
  background: var(--ld-bg-sage);
}
.thumb.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--ld-content-2);
}
.prod-text {
  min-width: 0;
}
.prod-name {
  font-weight: 600;
  color: var(--ld-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pid {
  font-size: 11px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
  margin-top: 2px;
}
.course {
  color: var(--ld-content-2);
}
.price {
  font-weight: 600;
  color: var(--ld-ink);
}
.spec {
  color: var(--ld-content-2);
}
.ops {
  gap: 6px;
  flex-wrap: wrap;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  color: var(--ld-content-2);
  cursor: pointer;
}
.icon-btn:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.tfoot {
  padding: 12px 16px;
  border-top: 1px solid var(--ld-line);
  font-size: 12px;
  color: var(--ld-content-2);
}

/* 编辑器（白卡语言·独立态有外框·embed 由 .embed .editor 去框） */
.editor {
  padding: 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
  max-width: 720px;
}
.editor h3 {
  margin: 0 0 14px;
  font-size: 15px;
  color: var(--ld-purple-ink);
}
.editor h4 {
  margin: 16px 0 8px;
  font-size: 13px;
  color: var(--ld-purple-ink);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
}
.grid label {
  font-size: 12px;
  color: var(--ld-content-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.grid label.wide {
  grid-column: span 2;
}
.grid input,
.skurow input {
  padding: 7px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
}
.cover-wrap {
  margin-top: 10px;
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.cover-preview {
  width: 120px;
  border-radius: var(--ld-radius-sm);
}
.auto {
  margin-left: 10px;
  font-size: 11.5px;
  font-weight: 400;
}
.auto.saving {
  color: var(--ld-content-2);
}
.auto.saved {
  color: var(--ld-green);
}
.auto.error {
  color: var(--ld-red);
}
.kit-icon {
  flex: none;
  width: 108px;
  padding: 8px 8px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 12px;
  background: var(--ld-bg);
}
.skurow {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.editor-ops {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
/* 相册（本页独有·多图排序拖序） */
.gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 6px 0 4px;
}
.g-item {
  position: relative;
  width: 84px;
  height: 84px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--ld-line);
  background: var(--ld-bg-sage);
}
.g-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.g-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 11px;
  color: var(--ld-content-2);
}
.g-ops {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 3px;
  background: rgba(20, 15, 30, 0.5);
}
.g-ops button {
  border: none;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 5px;
  width: 20px;
  height: 18px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.g-del {
  color: var(--ld-red);
}
.g-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 84px;
  height: 84px;
  border: 1px dashed var(--ld-line-strong);
  border-radius: 10px;
  font-size: 12px;
  color: var(--ld-content-2);
  cursor: pointer;
}
/* 参数/材料 kv 行 + 详情段落 */
.kvrow {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.kvrow input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 12.5px;
}
.secrow {
  margin-bottom: 8px;
}
.secrow-head {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}
.secrow-head input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 12.5px;
}
.secrow textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 12.5px;
  font-family: var(--ld-font);
  resize: vertical;
}
.preflight {
  margin: 14px 0 0;
  padding: 9px 13px;
  border-radius: 9px;
  font-size: 12px;
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.preflight.ok {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
</style>
