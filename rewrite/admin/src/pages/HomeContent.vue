<script setup lang="ts">
// 首页内容（设计语言一致性·M3 UI 批12）：hero 文案/信任条/FAQ/激活页背景图（全局 + 按课三态）。
// 图片走 uploadImage（前端压缩·与商品封面同通道）；保存走白名单（云端二次净化）。逻辑未动，仅套设计语言。
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Plus, Check } from 'lucide-vue-next'
import { getHomeContent, saveHomeContent } from '../api/content'
import { uploadImage } from '../api/products'
import { normalizeHome, homePayload, type HomeModel } from '../lib/mapContent'
import { b64SizeOk } from '../lib/mapProducts'
import UiButton from '../components/ui/Button.vue'

const model = ref<HomeModel | null>(null)
const message = ref('')
const busy = ref(false)
const sessionUrls = ref<Record<string, string>>({}) // 新上传 fileID→url 缩略预览
const thumb = (fileID: string) => sessionUrls.value[fileID] || ''

// —— 防抖自动保存 + 离页补存（换皮唯独 HomeContent 没补·编辑 hero/信任条/FAQ/背景图后不点保存直接切页→静默丢失）——
const autoState = ref('') // '' | saving | saved | error
let saveTimer: ReturnType<typeof setTimeout> | null = null
let loaded = false // load-guard：首次载入赋值不触发自动保存
watch(
  model,
  () => {
    if (!model.value || !loaded) return
    autoState.value = 'saving'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void autosave(), 900)
  },
  { deep: true }
)
async function autosave() {
  if (!model.value) return
  const r = await saveHomeContent(homePayload(model.value))
  autoState.value = r.ok ? 'saved' : 'error'
}
onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    void autosave() // 离页补存 pending
  }
})

onMounted(async () => {
  const r = await getHomeContent()
  model.value = normalizeHome(r.ok ? r.home : null)
  if (!r.ok) message.value = '加载失败：' + String(r.error || '')
  void nextTick(() => (loaded = true)) // 载入落定后放开自动保存
})

async function uploadTo(assign: (_fileID: string) => void, ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const b64 = await compress(file)
  if (!b64SizeOk(b64)) {
    message.value = '图片压缩后仍超限，换小一点的图'
    return
  }
  busy.value = true
  const r = await uploadImage(b64, 'homecontent', 'jpg')
  busy.value = false
  if (r.ok) {
    const fid = String(r.fileID || '')
    assign(fid)
    if (fid) sessionUrls.value[fid] = String(r.url || '') // 缩略预览（本会话）
    message.value = ''
  } else message.value = '图片上传失败：' + String(r.error || '')
}

async function compress(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const scale = Math.min(1, 900 / img.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const q of [0.8, 0.6, 0.45, 0.3]) {
      const b64 = canvas.toDataURL('image/jpeg', q).split(',')[1] || ''
      if (b64SizeOk(b64)) return b64
    }
    return ''
  } finally {
    URL.revokeObjectURL(url)
  }
}

function addCourseRow() {
  model.value?.byCourse.push({ courseId: '', welcome: '', welcomeBack: '', taken: '' })
}
function addTrust() {
  if (model.value && model.value.trust.length < 4) model.value.trust.push({ icon: '', label: '' })
}
function addFaq() {
  if (model.value && model.value.faq.length < 8) model.value.faq.push({ title: '', body: '' })
}
// 删除（换皮只增不删·脏行永久残留）：
function delCourseRow(i: number) {
  model.value?.byCourse.splice(i, 1)
}
function delTrust(i: number) {
  model.value?.trust.splice(i, 1)
}
function delFaq(i: number) {
  model.value?.faq.splice(i, 1)
}

async function save() {
  if (!model.value || busy.value) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  busy.value = true
  const r = await saveHomeContent(homePayload(model.value))
  busy.value = false
  autoState.value = ''
  message.value = r.ok ? '已保存，小程序立即生效' : '保存失败：' + String(r.error || '')
}
</script>

<template>
  <div v-if="model" class="page">
    <header class="page-head">
      <div>
        <h1>首页内容</h1>
        <p class="sub">小程序首页 Hero / 信任条 / FAQ，以及激活页背景图（全局 + 按课三态）。保存后小程序立即生效。</p>
      </div>
      <div class="head-r">
        <span class="auto" :class="autoState">{{ autoState === 'saving' ? '自动保存中…' : autoState === 'saved' ? '已自动保存' : autoState === 'error' ? '自动保存失败' : '' }}</span>
        <UiButton :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存全部' }}</UiButton>
      </div>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <section class="card">
      <h2>Hero 文案</h2>
      <div class="hero-edit">
        <div class="hero-fields">
          <div class="field"><label>主标题（≤20 字）</label><input v-model="model.heroTitle" maxlength="20" /></div>
          <div class="field"><label>副标语（≤40 字）</label><input v-model="model.heroTagline" maxlength="40" /></div>
        </div>
        <!-- 所见即所得预览（换皮丢·改 hero 是盲编看不到首页效果） -->
        <div class="hero-preview">
          <div class="hp-frame">
            <div class="hp-title">{{ model.heroTitle || '主标题' }}</div>
            <div class="hp-tagline">{{ model.heroTagline || '副标语' }}</div>
          </div>
          <span class="hp-cap">小程序首页预览</span>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>激活页背景图</h2>
      <div class="upload-field">
        <label>全局背景（激活/loading 回退用）</label>
        <div class="upload-row">
          <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.activationBg = f), e)" />
          <img v-if="thumb(model.activationBg)" :src="thumb(model.activationBg)" class="bg-thumb" alt="" />
          <span v-if="model.activationBg" class="filetag"><Check :size="12" :stroke-width="2" />已设置</span>
          <button v-if="model.activationBg" class="del-x" title="恢复默认" @click="model.activationBg = ''">✕</button>
        </div>
      </div>
      <div class="upload-field">
        <label>Loading 图</label>
        <div class="upload-row">
          <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.loadingBg = f), e)" />
          <img v-if="thumb(model.loadingBg)" :src="thumb(model.loadingBg)" class="bg-thumb" alt="" />
          <span v-if="model.loadingBg" class="filetag"><Check :size="12" :stroke-width="2" />已设置</span>
          <button v-if="model.loadingBg" class="del-x" title="恢复默认" @click="model.loadingBg = ''">✕</button>
        </div>
      </div>
      <h3>按课程三态图（欢迎 / 欢迎回来 / 已被激活）</h3>
      <div v-for="(row, i) in model.byCourse" :key="i" class="course-row">
        <input v-model="row.courseId" placeholder="course-xxx" class="cid" />
        <label class="mini">欢迎<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.welcome = f), e)" /><template v-if="row.welcome"><img v-if="thumb(row.welcome)" :src="thumb(row.welcome)" class="state-thumb" alt="" /><Check v-else :size="13" :stroke-width="2" class="ok" /><button class="clr" title="清除这态" @click.stop.prevent="row.welcome = ''">✕</button></template></label>
        <label class="mini">回访<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.welcomeBack = f), e)" /><template v-if="row.welcomeBack"><img v-if="thumb(row.welcomeBack)" :src="thumb(row.welcomeBack)" class="state-thumb" alt="" /><Check v-else :size="13" :stroke-width="2" class="ok" /><button class="clr" title="清除这态" @click.stop.prevent="row.welcomeBack = ''">✕</button></template></label>
        <label class="mini">已用<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.taken = f), e)" /><template v-if="row.taken"><img v-if="thumb(row.taken)" :src="thumb(row.taken)" class="state-thumb" alt="" /><Check v-else :size="13" :stroke-width="2" class="ok" /><button class="clr" title="清除这态" @click.stop.prevent="row.taken = ''">✕</button></template></label>
        <button class="del-x" title="删除这门课" @click="delCourseRow(i)">✕</button>
      </div>
      <button class="add-btn" @click="addCourseRow"><Plus :size="13" :stroke-width="2" /><span>加一门课</span></button>
    </section>

    <section class="card">
      <h2>信任条（≤4）</h2>
      <div v-for="(t, i) in model.trust" :key="i" class="pair">
        <input v-model="t.icon" placeholder="图标名（如 truck）" />
        <input v-model="t.label" placeholder="文案（≤12 字）" maxlength="12" />
        <button class="del-x" title="删除" @click="delTrust(i)">✕</button>
      </div>
      <button class="add-btn" @click="addTrust"><Plus :size="13" :stroke-width="2" /><span>加一条</span></button>
    </section>

    <section class="card">
      <h2>FAQ（≤8）</h2>
      <div v-for="(f, i) in model.faq" :key="i" class="faq">
        <input v-model="f.title" placeholder="问题（≤40 字）" maxlength="40" />
        <textarea v-model="f.body" placeholder="回答（≤150 字）" maxlength="150" />
        <button class="del-x" title="删除" @click="delFaq(i)">✕</button>
      </div>
      <button class="add-btn" @click="addFaq"><Plus :size="13" :stroke-width="2" /><span>加一条</span></button>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 780px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
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
.head-r {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.auto {
  font-size: 11.5px;
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
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.hero-edit {
  display: flex;
  gap: 18px;
  align-items: flex-start;
}
.hero-fields {
  flex: 1;
  min-width: 0;
}
.hero-preview {
  flex: none;
  width: 190px;
  text-align: center;
}
.hp-frame {
  padding: 22px 16px;
  border-radius: 14px;
  background: linear-gradient(160deg, var(--ld-bg-lilac), var(--ld-bg-sage));
  border: 1px solid var(--ld-line);
}
.hp-title {
  font-size: 17px;
  font-weight: 800;
  color: var(--ld-ink);
  line-height: 1.3;
}
.hp-tagline {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ld-content-2);
}
.hp-cap {
  display: block;
  margin-top: 6px;
  font-size: 10.5px;
  color: var(--ld-content-2);
}
.state-thumb {
  width: 22px;
  height: 22px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--ld-line);
}
.clr {
  border: none;
  background: transparent;
  color: var(--ld-content-2);
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
}
.clr:hover {
  color: var(--ld-red);
}
.card {
  padding: 18px 20px;
  margin-bottom: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
h3 {
  margin: 16px 0 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-purple-meta);
}
.field {
  margin-bottom: 10px;
}
.field label,
.upload-field label {
  display: block;
  font-size: 12px;
  color: var(--ld-content-2);
  margin-bottom: 5px;
}
input,
textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  font-family: var(--ld-font);
  box-sizing: border-box;
}
textarea {
  min-height: 50px;
  resize: vertical;
}
.upload-field {
  margin-bottom: 12px;
}
.upload-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.upload-row input {
  width: auto;
}
.filetag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ld-green);
  font-family: var(--ld-font-mono);
}
.course-row {
  display: grid;
  grid-template-columns: 150px 1fr 1fr 1fr auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.del-x {
  border: none;
  background: transparent;
  color: var(--ld-content-2);
  font-size: 14px;
  cursor: pointer;
  padding: 4px 6px;
  align-self: start;
}
.del-x:hover {
  color: var(--ld-red);
}
.bg-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--ld-line);
}
.cid {
  font-family: var(--ld-font-mono);
  font-size: 12px;
}
.mini {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ld-content-2);
}
.mini input {
  width: auto;
  font-size: 11px;
}
.ok {
  color: var(--ld-green);
}
.pair,
.faq {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 8px;
  margin-bottom: 8px;
}
.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  padding: 6px 14px;
  border: 1px dashed var(--ld-purple-line);
  border-radius: 999px;
  background: transparent;
  color: var(--ld-brand-active);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
</style>
