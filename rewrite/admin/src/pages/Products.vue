<script setup lang="ts">
// 商品管理（design/console.pen S11 视觉·M3 UI 批3）：页头+流水线副标+筛选 chip（真计数）+ 搜索（按名）
// + 三态表格（关联课程/规格·图列）+ 编辑器（整档 round-trip·图片压缩·危操作两步确认，逻辑批3 未动）。
// 设计稿「6 步上新进度」需分步完成态数据（上新向导 S5-S9 才有），当前无源——省略并记待办，不编进度。
import { ref, computed, onMounted } from 'vue'
import { Search, Trash2 } from 'lucide-vue-next'
import { listDrafts, saveDraft, deleteDraft, uploadImage, publishProduct, unpublishProduct, republishProduct } from '../api/products'
import { mapDraftRows, publishErrorText, b64SizeOk, type DraftRowVM } from '../lib/mapProducts'

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
const courseOf = (r: DraftRowVM) => String((r.raw as any).courseId || '')

// 图片 fileID→url 解析：listDrafts 回的 urls 映射（已存图）+ 本会话新上传的 url
const urlMap = ref<Record<string, string>>({})
const sessionUrls = ref<Record<string, string>>({})
const imgUrl = (fileID: string) => sessionUrls.value[fileID] || urlMap.value[fileID] || ''

async function reload() {
  message.value = '加载中…'
  const r = await listDrafts()
  urlMap.value = r.ok && (r as any).urls ? (r as any).urls : {}
  rows.value = r.ok ? mapDraftRows(r.list, r.urls, r.listed) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

function newProduct() {
  edit.value = { id: 'p' + Date.now().toString(36), name: '', tag: '', brief: '', price: '', was: '', cover: '', images: [], skus: [], params: [], detailSections: [], kit: [], courseId: '' }
  coverPreview.value = ''
}

function openEdit(row: DraftRowVM) {
  edit.value = JSON.parse(JSON.stringify(row.raw)) // 整档拷贝·round-trip 防抹字段
  coverPreview.value = row.coverUrl
}

function addSku() {
  if (edit.value) (edit.value.skus as any[]).push({ name: '', price: '' })
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
  busy.value = true
  const r = await saveDraft(edit.value)
  busy.value = false
  message.value = r.ok ? '' : '保存失败：' + String(r.error || '')
  if (r.ok) {
    edit.value = null
    void reload()
  }
}

async function doPublish(id: string) {
  busy.value = true
  const r = await publishProduct(id)
  busy.value = false
  message.value = r.ok ? '' : publishErrorText(r.error) // 四道门人话
  void reload()
}

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

const doRepublish = async (id: string) => {
  const r = await republishProduct(id)
  message.value = r.ok ? '' : '恢复失败：' + String(r.error || '')
  void reload()
}

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

// 上架前缺项预检（1:1 旧 Wizard missing·换皮退成事后报错）：封面/名称/价格/规格四项必备
const missing = computed(() => {
  const e = edit.value
  if (!e) return [] as string[]
  const m: string[] = []
  if (!e.cover) m.push('封面图')
  if (!String(e.name || '').trim()) m.push('商品名称')
  if (!String(e.price || '').trim()) m.push('价格')
  if (!Array.isArray(e.skus) || !e.skus.length) m.push('至少一个规格')
  return m
})

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>商品与上新</h1>
        <p class="sub">一款商品一条流水线：产品图片 → 商品信息 → SKU → 教学视频 → 二维码卡片 → 码批次</p>
      </div>
      <button class="btn-primary" @click="newProduct">＋ 新建商品</button>
    </header>

    <div class="toolbar">
      <div class="chips">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          class="chip"
          :class="{ on: filter === f.key }"
          @click="filter = f.key"
        >
          {{ f.label }} <span class="chip-n">{{ counts[f.key] }}</span>
        </button>
      </div>
      <div class="searchbox">
        <Search :size="15" :stroke-width="1.8" class="search-ico" />
        <input v-model="search" placeholder="搜索商品名 / 编号" />
      </div>
    </div>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="shown.length" class="table">
      <div class="thead">
        <span class="c-prod">商品</span>
        <span class="c-course">关联课程</span>
        <span class="c-price">价格</span>
        <span class="c-spec">规格 / 图</span>
        <span class="c-state">状态</span>
        <span class="c-ops">操作</span>
      </div>
      <div v-for="row in shown" :key="row.id" class="trow">
        <div class="c-prod prod">
          <img v-if="row.coverUrl" :src="row.coverUrl" class="thumb" />
          <span v-else class="thumb empty">无图</span>
          <div class="prod-text">
            <div class="prod-name">{{ row.name }}</div>
            <div class="pid">{{ row.id }}</div>
          </div>
        </div>
        <span class="c-course course">{{ courseOf(row) || '未关联' }}</span>
        <span class="c-price price">{{ row.priceLabel }}</span>
        <span class="c-spec spec">{{ row.skuCount }} 规格 · {{ imgCount(row) }} 图</span>
        <span class="c-state"><span :class="['state', row.state]">{{ row.stateLabel }}</span></span>
        <div class="c-ops ops">
          <button class="act ghost" @click="openEdit(row)">编辑</button>
          <button v-if="row.state === 'preparing'" class="act" @click="doPublish(row.id)">上架</button>
          <button v-if="row.state === 'onsale'" class="act ghost" @click="doPublish(row.id)">重新上架</button>
          <button v-if="row.state === 'onsale'" class="act warn" @click="doUnpublish(row.id)">
            {{ confirmKey === 'off:' + row.id ? '确认下架？' : '下架' }}
          </button>
          <button v-if="row.state === 'unlisted'" class="act" @click="doRepublish(row.id)">恢复销售</button>
          <button class="icon-btn" :title="confirmKey === 'del:' + row.id ? '连已上架一起删？' : '删除'" @click="doDelete(row.id)">
            <Trash2 :size="15" :stroke-width="1.8" />
          </button>
        </div>
      </div>
      <div class="tfoot">共 {{ counts.all }} 款商品<span v-if="filter !== 'all' || search">（当前筛选 {{ shown.length }}）</span></div>
    </div>
    <p v-else-if="!message" class="status-soft">{{ rows.length ? '没有符合筛选的商品' : '还没有商品，点「新建商品」开始' }}</p>

    <div v-if="edit" class="editor">
      <h3>{{ edit.name || '新商品' }} <span class="pid">{{ edit.id }}</span></h3>
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
      <img v-if="coverPreview" :src="coverPreview" class="cover-preview" />
      <h4>规格（SKU）</h4>
      <div v-for="(s, i) in edit.skus" :key="i" class="skurow">
        <input v-model="s.name" placeholder="规格名" maxlength="30" />
        <input v-model="s.price" placeholder="价格（元）" />
        <button class="act ghost" @click="delSku(i)">删行</button>
      </div>
      <button class="act ghost" @click="addSku">+ 加规格</button>

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
        <button class="act ghost" @click="delParam(i)">删</button>
      </div>
      <button class="act ghost" :disabled="(edit.params as unknown[]).length >= 8" @click="addParam">+ 加参数</button>

      <h4>详情段落（≤4）</h4>
      <div v-for="(d, i) in (edit.detailSections as { lead: string; body: string }[])" :key="i" class="secrow">
        <div class="secrow-head"><input v-model="d.lead" placeholder="小标题" maxlength="30" /><button class="act ghost" @click="delSection(i)">删</button></div>
        <textarea v-model="d.body" placeholder="段落正文" maxlength="200" rows="2" />
      </div>
      <button class="act ghost" :disabled="(edit.detailSections as unknown[]).length >= 4" @click="addSection">+ 加段落</button>

      <h4>材料清单（≤8）</h4>
      <div v-for="(k, i) in (edit.kit as { name: string; qty: string }[])" :key="i" class="kvrow">
        <input v-model="k.name" placeholder="物品名" maxlength="14" />
        <input v-model="k.qty" placeholder="数量（如 1 包 50g）" maxlength="14" />
        <button class="act ghost" @click="delKit(i)">删</button>
      </div>
      <button class="act ghost" :disabled="(edit.kit as unknown[]).length >= 8" @click="addKit">+ 加材料</button>

      <!-- 上架前缺项预检（换皮退成事后报错·1:1 旧 Wizard missing） -->
      <p v-if="missing.length" class="preflight">上架还差：<b>{{ missing.join('、') }}</b>（补齐保存后到列表点「上架」）</p>
      <p v-else class="preflight ok">✓ 必备项齐全，保存后可到列表上架</p>

      <div class="editor-ops">
        <button class="act" :disabled="busy" @click="doSave">保存草稿</button>
        <button class="act ghost" @click="edit = null">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1160px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--ld-ink);
}
.sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.btn-primary {
  flex: none;
  padding: 10px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chip {
  padding: 6px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 13px;
  cursor: pointer;
}
.chip.on {
  background: var(--ld-purple-ink);
  border-color: var(--ld-purple-ink);
  color: #fff;
}
.chip-n {
  opacity: 0.7;
  margin-left: 2px;
}
.searchbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  min-width: 240px;
}
.search-ico {
  color: var(--ld-content-2);
  flex: none;
}
.searchbox input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  width: 100%;
  color: var(--ld-ink);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
}
.table {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 2.4fr 1.2fr 1fr 1.2fr 0.9fr 1.8fr;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
}
.thead {
  background: var(--ld-bg-lilac);
  font-size: 12px;
  color: var(--ld-content-2);
}
.trow {
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
}
.prod {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
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
.state {
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 12px;
}
.state.onsale {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.state.unlisted {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.state.preparing {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.ops {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.act {
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.act.ghost {
  background: transparent;
  color: var(--ld-content-2);
  border: 1px solid var(--ld-line);
}
.act.warn {
  background: var(--ld-red);
}
.act:disabled {
  opacity: 0.5;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  cursor: pointer;
}
.icon-btn:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.tfoot {
  padding: 12px 20px;
  border-top: 1px solid var(--ld-line);
  font-size: 12px;
  color: var(--ld-content-2);
}
.editor {
  margin-top: 18px;
  padding: 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
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
  border-radius: 8px;
  font-size: 13px;
}
.cover-preview {
  margin-top: 10px;
  width: 120px;
  border-radius: 8px;
}
.skurow {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.hint {
  font-size: 12px;
  color: var(--ld-content-2);
}
.editor-ops {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
/* 相册 */
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
  border-radius: 8px;
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
  border-radius: 8px;
  font-size: 12.5px;
}
.secrow textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 8px;
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
