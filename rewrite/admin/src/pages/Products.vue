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

async function reload() {
  message.value = '加载中…'
  const r = await listDrafts()
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
      <p class="hint">参数表 / 详情段落 / 材料清单的可视化编辑随上新向导批补——本页保存不会丢掉草稿里已有的这些字段。</p>
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
</style>
