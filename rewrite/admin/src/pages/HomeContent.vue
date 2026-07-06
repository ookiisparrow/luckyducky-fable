<script setup lang="ts">
// 首页内容（设计语言一致性·M3 UI 批12）：hero 文案/信任条/FAQ/激活页背景图（全局 + 按课三态）。
// 图片走 uploadImage（前端压缩·与商品封面同通道）；保存走白名单（云端二次净化）。逻辑未动，仅套设计语言。
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Plus, Check, Trash2, X, ImageOff, ShieldCheck, HelpCircle } from 'lucide-vue-next'
import { getHomeContent, saveHomeContent } from '../api/content'
import { uploadImage } from '../api/products'
import { normalizeHome, homePayload, type HomeModel } from '../lib/mapContent'
import { b64SizeOk } from '../lib/mapProducts'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

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
  <div v-if="model" class="ld-page">
    <PageHeader
      title="首页内容"
      sub="小程序首页 Hero / 信任条 / FAQ，以及激活页背景图（全局 + 按课三态）。保存后小程序立即生效。"
    >
      <Badge v-if="autoState === 'saving'" tone="amber" dot>自动保存中…</Badge>
      <Badge v-else-if="autoState === 'saved'" tone="green" dot>已自动保存</Badge>
      <Badge v-else-if="autoState === 'error'" tone="red" dot>自动保存失败</Badge>
      <UiButton :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存全部' }}</UiButton>
    </PageHeader>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <!-- Hero 文案（含所见即所得预览·卡面预览本页独有） -->
    <Card title="Hero 文案" sub="小程序首页顶部主标题与副标语">
      <div class="hero-edit">
        <div class="hero-fields">
          <div class="field"><label>主标题（≤20 字）</label><input v-model="model.heroTitle" maxlength="20" /></div>
          <div class="field"><label>副标语（≤40 字）</label><input v-model="model.heroTagline" maxlength="40" /></div>
        </div>
        <div class="hero-preview">
          <div class="hp-frame">
            <div class="hp-title">{{ model.heroTitle || '主标题' }}</div>
            <div class="hp-tagline">{{ model.heroTagline || '副标语' }}</div>
          </div>
          <span class="hp-cap">小程序首页预览</span>
        </div>
      </div>
    </Card>

    <!-- 激活页背景图（全局 + 逐课程三态·上传位本页独有） -->
    <Card title="激活页背景图" sub="激活/加载页背景，可设全局回退与逐课程三态图">
      <div class="upload-field">
        <label>全局背景（激活/loading 回退用）</label>
        <div class="upload-row">
          <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.activationBg = f), e)" />
          <img v-if="thumb(model.activationBg)" :src="thumb(model.activationBg)" class="bg-thumb" alt="" />
          <span v-if="model.activationBg" class="filetag"><Check :size="12" :stroke-width="2" />已设置</span>
          <button v-if="model.activationBg" class="clr" title="恢复默认" @click="model.activationBg = ''"><X :size="14" :stroke-width="2" /></button>
        </div>
      </div>
      <div class="upload-field">
        <label>Loading 图</label>
        <div class="upload-row">
          <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.loadingBg = f), e)" />
          <img v-if="thumb(model.loadingBg)" :src="thumb(model.loadingBg)" class="bg-thumb" alt="" />
          <span v-if="model.loadingBg" class="filetag"><Check :size="12" :stroke-width="2" />已设置</span>
          <button v-if="model.loadingBg" class="clr" title="恢复默认" @click="model.loadingBg = ''"><X :size="14" :stroke-width="2" /></button>
        </div>
      </div>

      <h3 class="sub-head">按课程三态图（欢迎 / 欢迎回来 / 已被激活）</h3>
      <EmptyState v-if="!model.byCourse.length" :icon="ImageOff" text="暂无按课程配置，点「加一门课」为某门课设三态背景图" />
      <template v-else>
        <div v-for="(row, i) in model.byCourse" :key="i" class="course-row">
          <input v-model="row.courseId" placeholder="course-xxx" class="cid" />
          <label class="mini">欢迎<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.welcome = f), e)" /><template v-if="row.welcome"><img v-if="thumb(row.welcome)" :src="thumb(row.welcome)" class="state-thumb" alt="" /><Check v-else :size="13" :stroke-width="2" class="ok" /><button class="clr" title="清除这态" @click.stop.prevent="row.welcome = ''"><X :size="12" :stroke-width="2" /></button></template></label>
          <label class="mini">回访<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.welcomeBack = f), e)" /><template v-if="row.welcomeBack"><img v-if="thumb(row.welcomeBack)" :src="thumb(row.welcomeBack)" class="state-thumb" alt="" /><Check v-else :size="13" :stroke-width="2" class="ok" /><button class="clr" title="清除这态" @click.stop.prevent="row.welcomeBack = ''"><X :size="12" :stroke-width="2" /></button></template></label>
          <label class="mini">已用<input type="file" accept="image/*" @change="(e) => uploadTo((f) => (row.taken = f), e)" /><template v-if="row.taken"><img v-if="thumb(row.taken)" :src="thumb(row.taken)" class="state-thumb" alt="" /><Check v-else :size="13" :stroke-width="2" class="ok" /><button class="clr" title="清除这态" @click.stop.prevent="row.taken = ''"><X :size="12" :stroke-width="2" /></button></template></label>
          <button class="icon-btn" title="删除这门课" @click="delCourseRow(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
        </div>
      </template>
      <div class="row-add">
        <UiButton variant="ghost" size="sm" @click="addCourseRow"><Plus :size="14" :stroke-width="2" />加一门课</UiButton>
      </div>
    </Card>

    <!-- 信任条（≤4） -->
    <Card title="信任条" :sub="`最多 4 条 · 当前 ${model.trust.length} 条`">
      <template #head>
        <UiButton variant="ghost" size="sm" :disabled="model.trust.length >= 4" @click="addTrust"><Plus :size="14" :stroke-width="2" />新增一条</UiButton>
      </template>
      <EmptyState v-if="!model.trust.length" :icon="ShieldCheck" text="暂无信任条，点「新增一条」添加" />
      <div v-else class="rows">
        <div v-for="(t, i) in model.trust" :key="i" class="pair">
          <input v-model="t.icon" placeholder="图标名（如 truck）" />
          <input v-model="t.label" placeholder="文案（≤12 字）" maxlength="12" />
          <button class="icon-btn" title="删除" @click="delTrust(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
        </div>
      </div>
    </Card>

    <!-- FAQ（≤8） -->
    <Card title="FAQ" :sub="`最多 8 条 · 当前 ${model.faq.length} 条`">
      <template #head>
        <UiButton variant="ghost" size="sm" :disabled="model.faq.length >= 8" @click="addFaq"><Plus :size="14" :stroke-width="2" />新增一条</UiButton>
      </template>
      <EmptyState v-if="!model.faq.length" :icon="HelpCircle" text="暂无 FAQ，点「新增一条」添加" />
      <div v-else class="rows">
        <div v-for="(f, i) in model.faq" :key="i" class="faq">
          <input v-model="f.title" placeholder="问题（≤40 字）" maxlength="40" />
          <textarea v-model="f.body" placeholder="回答（≤150 字）" maxlength="150" />
          <button class="icon-btn" title="删除" @click="delFaq(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
        </div>
      </div>
    </Card>
  </div>
</template>

<style scoped>
/* 首页内容编辑器·本页独有（共享原语管页头/卡/按钮/徽章/空态；这里只留表单位/上传位/卡面预览的私有样式） */

/* 表单输入基线 */
.field {
  margin-bottom: 12px;
}
.field:last-child {
  margin-bottom: 0;
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
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  font-family: var(--ld-font);
  color: var(--ld-content);
  background: var(--ld-bg);
  box-sizing: border-box;
}
input:focus,
textarea:focus {
  outline: none;
  border-color: var(--ld-purple-line);
}
textarea {
  min-height: 50px;
  resize: vertical;
}
input[type='file'] {
  width: auto;
  border: none;
  padding: 0;
  background: none;
  font-size: 12px;
}

/* Hero 卡面预览 */
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
  border-radius: var(--ld-radius);
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

/* 上传位 */
.upload-field {
  margin-bottom: 14px;
}
.sub-head {
  margin: 6px 0 10px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-purple-meta);
}
.upload-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.filetag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ld-green);
  font-family: var(--ld-font-mono);
}
.bg-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: var(--ld-radius-sm);
  border: 1px solid var(--ld-line);
}

/* 按课程三态行 */
.course-row {
  display: grid;
  grid-template-columns: 150px 1fr 1fr 1fr auto;
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
.mini input[type='file'] {
  font-size: 11px;
}
.state-thumb {
  width: 22px;
  height: 22px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--ld-line);
}
.ok {
  color: var(--ld-green);
}
.row-add {
  margin-top: 4px;
}

/* 信任条 / FAQ 行 */
.rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pair,
.faq {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 8px;
  align-items: start;
}

/* 内联清除按钮（图片态清除·恢复默认） */
.clr {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--ld-content-2);
  cursor: pointer;
  padding: 2px 4px;
}
.clr:hover {
  color: var(--ld-red);
}

/* 行删除按钮（对齐 Courses/Kb 图标按钮语言） */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  align-self: start;
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
</style>
