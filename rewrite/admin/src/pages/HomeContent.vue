<script setup lang="ts">
// 首页内容（设计语言一致性·M3 UI 批12）：hero 文案/信任条/FAQ/激活页背景图（全局 + 按课三态）。
// 图片走 uploadImage（前端压缩·与商品封面同通道）；保存走白名单（云端二次净化）。逻辑未动，仅套设计语言。
import { ref, onMounted } from 'vue'
import { Plus, Check } from 'lucide-vue-next'
import { getHomeContent, saveHomeContent } from '../api/content'
import { uploadImage } from '../api/products'
import { normalizeHome, homePayload, type HomeModel } from '../lib/mapContent'
import { b64SizeOk } from '../lib/mapProducts'

const model = ref<HomeModel | null>(null)
const message = ref('')
const busy = ref(false)

onMounted(async () => {
  const r = await getHomeContent()
  model.value = normalizeHome(r.ok ? r.home : null)
  if (!r.ok) message.value = '加载失败：' + String(r.error || '')
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
    assign(String(r.fileID || ''))
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

async function save() {
  if (!model.value || busy.value) return
  busy.value = true
  const r = await saveHomeContent(homePayload(model.value))
  busy.value = false
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
      <button class="btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存全部' }}</button>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <section class="card">
      <h2>Hero 文案</h2>
      <div class="field"><label>主标题（≤20 字）</label><input v-model="model.heroTitle" maxlength="20" /></div>
      <div class="field"><label>副标语（≤40 字）</label><input v-model="model.heroTagline" maxlength="40" /></div>
    </section>

    <section class="card">
      <h2>激活页背景图</h2>
      <div class="upload-field">
        <label>全局背景（激活/loading 回退用）</label>
        <div class="upload-row">
          <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.activationBg = f), e)" />
          <span v-if="model.activationBg" class="filetag"><Check :size="12" :stroke-width="2" />{{ model.activationBg.slice(-18) }}</span>
        </div>
      </div>
      <div class="upload-field">
        <label>Loading 图</label>
        <div class="upload-row">
          <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.loadingBg = f), e)" />
          <span v-if="model.loadingBg" class="filetag"><Check :size="12" :stroke-width="2" />{{ model.loadingBg.slice(-18) }}</span>
        </div>
      </div>
      <h3>按课程三态图（欢迎 / 欢迎回来 / 已被激活）</h3>
      <div v-for="(row, i) in model.byCourse" :key="i" class="course-row">
        <input v-model="row.courseId" placeholder="course-xxx" class="cid" />
        <label class="mini">欢迎<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.welcome = f), e)" /><Check v-if="row.welcome" :size="13" :stroke-width="2" class="ok" /></label>
        <label class="mini">回访<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.welcomeBack = f), e)" /><Check v-if="row.welcomeBack" :size="13" :stroke-width="2" class="ok" /></label>
        <label class="mini">已用<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.taken = f), e)" /><Check v-if="row.taken" :size="13" :stroke-width="2" class="ok" /></label>
      </div>
      <button class="add-btn" @click="addCourseRow"><Plus :size="13" :stroke-width="2" /><span>加一门课</span></button>
    </section>

    <section class="card">
      <h2>信任条（≤4）</h2>
      <div v-for="(t, i) in model.trust" :key="i" class="pair">
        <input v-model="t.icon" placeholder="图标名（如 truck）" />
        <input v-model="t.label" placeholder="文案（≤12 字）" maxlength="12" />
      </div>
      <button class="add-btn" @click="addTrust"><Plus :size="13" :stroke-width="2" /><span>加一条</span></button>
    </section>

    <section class="card">
      <h2>FAQ（≤8）</h2>
      <div v-for="(f, i) in model.faq" :key="i" class="faq">
        <input v-model="f.title" placeholder="问题（≤40 字）" maxlength="40" />
        <textarea v-model="f.body" placeholder="回答（≤150 字）" maxlength="150" />
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
.btn-primary:disabled {
  opacity: 0.5;
}
.status {
  font-size: 13px;
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
  grid-template-columns: 160px 1fr 1fr 1fr;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
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
  grid-template-columns: 1fr 2fr;
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
