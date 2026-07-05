<script setup lang="ts">
// 首页内容（M3 批4）：hero 文案/信任条/FAQ/激活页背景图（全局 + 按课三态）。
// 图片走 uploadImage（前端压缩·与商品封面同通道）；保存走白名单（云端二次净化）。
import { ref, onMounted } from 'vue'
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

async function uploadTo(assign: (fileID: string) => void, ev: Event) {
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
  <div v-if="model">
    <h2>首页内容</h2>
    <p v-if="message" class="status">{{ message }}</p>

    <div class="panel">
      <h3>Hero 文案</h3>
      <label>主标题（≤20 字）<input v-model="model.heroTitle" maxlength="20" /></label>
      <label>副标语（≤40 字）<input v-model="model.heroTagline" maxlength="40" /></label>
    </div>

    <div class="panel">
      <h3>激活页背景图</h3>
      <label>全局背景（激活/loading 回退用）
        <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.activationBg = f), e)" />
        <code v-if="model.activationBg">{{ model.activationBg.slice(-24) }}</code>
      </label>
      <label>Loading 图
        <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.loadingBg = f), e)" />
        <code v-if="model.loadingBg">{{ model.loadingBg.slice(-24) }}</code>
      </label>
      <h4>按课程三态图（欢迎 / 欢迎回来 / 已被激活）</h4>
      <div v-for="(row, i) in model.byCourse" :key="i" class="courserow">
        <input v-model="row.courseId" placeholder="course-xxx" class="cid" />
        <label>欢迎<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.welcome = f), e)" /><span v-if="row.welcome">✓</span></label>
        <label>回访<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.welcomeBack = f), e)" /><span v-if="row.welcomeBack">✓</span></label>
        <label>已用<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.taken = f), e)" /><span v-if="row.taken">✓</span></label>
      </div>
      <button class="act ghost" @click="addCourseRow">+ 加一门课</button>
    </div>

    <div class="panel">
      <h3>信任条（≤4）</h3>
      <div v-for="(t, i) in model.trust" :key="i" class="pair">
        <input v-model="t.icon" placeholder="图标名（如 truck）" />
        <input v-model="t.label" placeholder="文案（≤12 字）" maxlength="12" />
      </div>
      <button class="act ghost" @click="addTrust">+ 加一条</button>
    </div>

    <div class="panel">
      <h3>FAQ（≤8）</h3>
      <div v-for="(f, i) in model.faq" :key="i" class="faqrow">
        <input v-model="f.title" placeholder="问题（≤40 字）" maxlength="40" />
        <textarea v-model="f.body" placeholder="回答（≤150 字）" maxlength="150" />
      </div>
      <button class="act ghost" @click="addFaq">+ 加一条</button>
    </div>

    <button class="act" :disabled="busy" @click="save">保存全部</button>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
h3 {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--ld-purple-ink);
}
h4 {
  margin: 14px 0 8px;
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.panel {
  padding: 16px 18px;
  margin-bottom: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 720px;
}
label {
  display: block;
  font-size: 12px;
  color: var(--ld-purple-meta);
  margin-bottom: 8px;
}
input,
textarea {
  display: block;
  width: 100%;
  padding: 7px 10px;
  margin-top: 4px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
}
code {
  font-size: 11px;
  color: var(--ld-purple-tab);
}
.courserow {
  display: grid;
  grid-template-columns: 160px 1fr 1fr 1fr;
  gap: 8px;
  align-items: end;
  margin-bottom: 8px;
}
.pair,
.faqrow {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 8px;
  margin-bottom: 8px;
}
.faqrow textarea {
  min-height: 48px;
}
.act {
  padding: 7px 20px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.act.ghost {
  background: transparent;
  color: var(--ld-purple-meta);
  border: 1px solid var(--ld-purple-line);
}
.act:disabled {
  opacity: 0.5;
}
</style>
