<script setup lang="ts">
// 商品管理（M3 批3）：三态列表 + 编辑（整档 round-trip·只绑核心字段防覆盖抹值）+ 图片上传（前端压缩到限内）
// + 上架/下架/恢复/删除（危操作两步确认·no-alert 纪律）。参数表/详情段落/材料清单高级编辑随内容批补（编辑不丢值）。
import { ref, onMounted } from 'vue'
import { listDrafts, saveDraft, deleteDraft, uploadImage, publishProduct, unpublishProduct, republishProduct } from '../api/products'
import { mapDraftRows, publishErrorText, b64SizeOk, type DraftRowVM } from '../lib/mapProducts'

const rows = ref<DraftRowVM[]>([])
const message = ref('')
const busy = ref(false)
const confirmKey = ref('') // 两步确认（`del:<id>` / `off:<id>`）
const edit = ref<Record<string, any> | null>(null)
const coverPreview = ref('')

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
  <div>
    <h2>商品管理</h2>
    <div class="topbar">
      <button class="act" @click="newProduct">+ 新建商品</button>
      <span v-if="message" class="status">{{ message }}</span>
    </div>

    <table v-if="rows.length">
      <thead>
        <tr><th>封面</th><th>商品</th><th>价格</th><th>规格</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td><img v-if="row.coverUrl" :src="row.coverUrl" class="thumb" /><span v-else class="thumb empty">无图</span></td>
          <td>{{ row.name }}<div class="pid">{{ row.id }}</div></td>
          <td>{{ row.priceLabel }}</td>
          <td>{{ row.skuCount }} 个</td>
          <td><span :class="['state', row.state]">{{ row.stateLabel }}</span></td>
          <td>
            <button class="act ghost" @click="openEdit(row)">编辑</button>
            <button v-if="row.raw.courseId" class="act ghost" @click="$router.push('/courses?courseId=' + row.raw.courseId)">编辑课程</button>
            <button v-if="row.state === 'preparing'" class="act" @click="doPublish(row.id)">上架</button>
            <button v-if="row.state === 'onsale'" class="act ghost" @click="doPublish(row.id)">重新上架</button>
            <button v-if="row.state === 'onsale'" class="act warn" @click="doUnpublish(row.id)">
              {{ confirmKey === 'off:' + row.id ? '确认下架？' : '下架' }}
            </button>
            <button v-if="row.state === 'unlisted'" class="act" @click="doRepublish(row.id)">恢复销售</button>
            <button class="act warn" @click="doDelete(row.id)">
              {{ confirmKey === 'del:' + row.id ? '连已上架一起删？' : '删除' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!message" class="status-soft">还没有商品，点「新建商品」开始</p>

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
      <p class="hint">参数表 / 详情段落 / 材料清单的可视化编辑随内容批补——本页保存不会丢掉草稿里已有的这些字段。</p>
      <div class="ops">
        <button class="act" :disabled="busy" @click="doSave">保存草稿</button>
        <button class="act ghost" @click="edit = null">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 16px;
  color: var(--ld-purple-ink);
}
.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  overflow: hidden;
}
th,
td {
  padding: 10px 12px;
  font-size: 13px;
  text-align: left;
  border-bottom: 1px solid var(--ld-bg-faint);
}
th {
  background: var(--ld-bg-lilac);
  color: var(--ld-purple-meta);
}
.thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 8px;
  background: var(--ld-bg-faint);
  display: inline-block;
}
.thumb.empty {
  font-size: 11px;
  color: var(--ld-purple-meta);
  text-align: center;
  line-height: 48px;
}
.pid {
  font-size: 11px;
  color: var(--ld-purple-meta);
  font-family: ui-monospace, monospace;
}
.state {
  padding: 2px 10px;
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
  color: var(--ld-purple-tab);
}
.act {
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  margin-right: 4px;
  margin-bottom: 4px;
}
.act.ghost {
  background: transparent;
  color: var(--ld-purple-meta);
  border: 1px solid var(--ld-purple-line);
}
.act.warn {
  background: var(--ld-red);
}
.act:disabled {
  opacity: 0.5;
}
.editor {
  margin-top: 18px;
  padding: 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
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
  color: var(--ld-purple-meta);
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
  border: 1px solid var(--ld-purple-line);
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
  color: var(--ld-purple-meta);
}
.ops {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
</style>
