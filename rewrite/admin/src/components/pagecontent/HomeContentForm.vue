<script setup lang="ts">
// 首页内容表单（批C·从 pages/HomeContent.vue 整体搬入·逻辑逐字保留）：hero 文案/品牌/特写/信任条/放心区/
// 买家秀/FAQ/收尾/页脚 + 激活页背景图（全局 + 按课三态）。背景图三态存于 content/home 档、由 saveHomeContent
// 全档写——故随首页签保留在此不迁移（拆到欢迎签会出双写全档互踩）。
// 保存链：serialSave 串行防乱序 + 900ms 防抖 + loaded load-guard + onBeforeUnmount 离签补存 + uploadImage 管线。
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Plus, Check, Trash2, X, ImageOff, ShieldCheck, HelpCircle, Film, RotateCcw } from 'lucide-vue-next'
import { getHomeContent, saveHomeContent, uploadFrameImage } from '../../api/content'
import { uploadImage } from '../../api/products'
import { normalizeHome, homePayload, STOPMOTION_FRAMES, type HomeModel } from '../../lib/mapContent'
import { b64SizeOk } from '../../lib/mapProducts'
import { serialSave } from '../../lib/serialSave'
import { setUploadLock, clearUploadLock } from '../../lib/uploadLock'
import UiButton from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import Badge from '../ui/Badge.vue'
import EmptyState from '../ui/EmptyState.vue'

const model = ref<HomeModel | null>(null)
const message = ref('')
const busy = ref(false)
const sessionUrls = ref<Record<string, string>>({}) // 新上传 fileID→url 缩略预览
const thumb = (fileID: string) => sessionUrls.value[fileID] || ''

const autoState = ref('') // '' | saving | saved | error
let saveTimer: ReturnType<typeof setTimeout> | null = null
let loaded = false // load-guard：首次载入赋值不触发自动保存
watch(
  model,
  () => {
    if (!model.value || !loaded) return
    autoState.value = 'saving'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void flushSave(), 900)
  },
  { deep: true }
)
async function autosave() {
  if (!model.value) return
  const r = await saveHomeContent(homePayload(model.value))
  autoState.value = r.ok ? 'saved' : 'error'
}
// 串行化·防慢网下两次自动保存乱序覆盖（P2·根因#8）；key='page-content:home'（批D·P1，与 usePageContent.ts
// 其余四签用同一 key 命名法·本组件独立存 content/home 档不复用该 composable，见文件头注）：改走模块级
// 共享槽位，快速切签再切回首页签重建组件实例时，新实例接管旧实例仍在途的补存链，防旧快照覆盖新编辑。
const flushSave = serialSave(autosave, 'page-content:home')
onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    void flushSave() // 离签补存 pending
  }
  revokeThumbs() // 定格帧预览的 blob URL 随组件回收（36 张不回收会一直占内存）
})

onMounted(async () => {
  const r = await getHomeContent()
  model.value = normalizeHome(r.ok ? r.home : null)
  if (!r.ok) {
    // 载入失败不放开自动保存、也不允许手动保存（loaded 恒 false）——否则一次编辑就 saveHomeContent(空档) 整块覆盖
    message.value = '加载失败：' + String(r.error || '')
    return
  }
  void nextTick(() => (loaded = true)) // 载入成功落定后才放开自动保存
})

async function uploadTo(assign: (_fileID: string) => void, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 重置 value：允许上传失败后重选同一文件重试（否则浏览器不再触发 change）
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

// —— 首页定格动画（36 帧 scrub 层 720² + 1 张定格层 1080²）——
// 双层素材：手指拖动逐帧 scrub 用小图（36 张同时在内存，尺寸必须压住），静止那一帧另出高清定格图。
// 降采样一律在浏览器端 canvas 做，云端只存定尺成品——不依赖 CDN 实时缩放（那条路小程序侧不可控）。
const framesInput = ref<HTMLInputElement | null>(null)
const frameBusy = ref(false)
const frameProgress = ref('') // '' | 'x/36'
const frameUploading = ref(-1) // 正在上传的槽位（-1＝无）
const frameThumbs = ref<Record<number, string>>({}) // 槽位→本地 blob URL（直传不回 url，预览只能靠本会话原图）
const frameSources: File[] = [] // 槽位→本会话原图：改定格帧后可就地重出 1080²，不用让用户重传
const heroFromSlot = ref<number | null>(null) // 当前定格层由哪一格生成（本会话内可知；云端载入的不可知＝null）
const slots = computed(() => Array.from({ length: STOPMOTION_FRAMES }, (_, i) => i))
const framesDone = computed(() => (model.value?.stopmotionFrames || []).filter(Boolean).length)
const heroStale = computed(() => heroFromSlot.value !== null && heroFromSlot.value !== model.value?.stopmotionHeroIndex)

/** 1:1 居中裁切后缩到 size²（scrub 720 / 定格 1080）。读图失败返回 null，由调用方如实报告、不静默当成功。 */
async function squareBlob(file: File, size: number): Promise<Blob | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const side = Math.min(img.width, img.height)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85))
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function setThumb(slot: number, file: File) {
  const old = frameThumbs.value[slot]
  if (old) URL.revokeObjectURL(old) // 换图即回收旧 blob URL，否则 36 格反复重传会漏内存
  frameThumbs.value[slot] = URL.createObjectURL(file)
}
const frameThumb = (slot: number) => frameThumbs.value[slot] || ''

/** 写回某一格：云档可能只存了前若干帧，直接 arr[30]= 会在数组里留 empty 洞（JSON 化成 null）——先补齐 36 槽。 */
function setFrame(m: HomeModel, slot: number, fileId: string) {
  const arr = m.stopmotionFrames
  while (arr.length < STOPMOTION_FRAMES) arr.push('')
  arr[slot] = fileId
}

/** 生成并上传定格层（1080²）。snap＝本次上传的目标模型，回包时已换档就丢弃（同 Products.addImages 范式）。 */
async function putHero(snap: HomeModel, slot: number, file: File, fails: string[]) {
  const hero = await squareBlob(file, 1080)
  if (!hero) {
    fails.push(`第 ${slot} 格的定格图读不出来`)
    return
  }
  const r = await uploadFrameImage('hero', hero)
  if (model.value !== snap) return
  if (r.ok) {
    snap.stopmotionHero = String(r.fileId || '')
    heroFromSlot.value = slot
  } else fails.push('定格层上传失败：' + String(r.error || ''))
}

/** 单格落地：720² scrub 帧必传；这一格恰是定格帧时，另出一张 1080² 作定格层。 */
async function putFrame(snap: HomeModel, slot: number, file: File, fails: string[]) {
  const scrub = await squareBlob(file, 720)
  if (!scrub) {
    fails.push(`第 ${slot} 格图片读不出来，已跳过`)
    return
  }
  const r = await uploadFrameImage(slot, scrub)
  if (model.value !== snap) return // 回包时已切签/重载——不写回一棵不可达的模型
  if (!r.ok) {
    fails.push(`第 ${slot} 格上传失败：${String(r.error || '')}`) // fail-soft：一格失败不中断其余
    return
  }
  setFrame(snap, slot, String(r.fileId || ''))
  setThumb(slot, file)
  frameSources[slot] = file
  if (slot === snap.stopmotionHeroIndex) await putHero(snap, slot, file, fails)
}

/** 整批 36 张：按文件名自然排序（1,2,10 而非字典序 1,10,2·同 videoBatch.planLessonBatch）后依次占 0..35。 */
async function uploadFrames(ev: Event) {
  const input = ev.target as HTMLInputElement
  const picked = Array.from(input.files || [])
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, STOPMOTION_FRAMES)
  if (!picked.length || !model.value || frameBusy.value) return
  const snap = model.value // 快照本次目标（同 Products.addImages）：await 期间可能已切签重建模型
  const fails: string[] = []
  frameBusy.value = true
  setUploadLock() // 36 张是长在途，router 全局 beforeEach 据此拦离页，防上传回包写进不可达的模型
  try {
    for (let i = 0; i < picked.length; i++) {
      frameProgress.value = `${i + 1}/${picked.length}`
      frameUploading.value = i
      await putFrame(snap, i, picked[i], fails)
      if (model.value !== snap) break // 已切签：后续再传也写不回去，早停省流量
    }
  } finally {
    frameBusy.value = false
    frameUploading.value = -1
    frameProgress.value = ''
    clearUploadLock()
  }
  message.value = fails.length ? `本次有 ${fails.length} 格没成功——${fails.join('；')}` : ''
  input.value = '' // 允许再次选同一批（否则浏览器不再触发 change）
}

async function uploadOneFrame(slot: number, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !model.value || frameBusy.value) return
  const snap = model.value
  const fails: string[] = []
  frameBusy.value = true
  frameUploading.value = slot
  setUploadLock()
  try {
    await putFrame(snap, slot, file, fails)
  } finally {
    frameBusy.value = false
    frameUploading.value = -1
    clearUploadLock()
  }
  message.value = fails.join('；')
}

/** 改了定格帧序号后重出定格层：本会话有原图就地重出；没有（刷新过/云端载入）只能请用户重传那一格。 */
async function regenHero() {
  if (!model.value || frameBusy.value) return
  const snap = model.value
  const slot = snap.stopmotionHeroIndex
  const src = frameSources[slot]
  if (!src) {
    message.value = `本会话没有第 ${slot} 格的原图，请点该格重传一次（会自动同时生成高清定格层）`
    return
  }
  const fails: string[] = []
  frameBusy.value = true
  setUploadLock()
  try {
    await putHero(snap, slot, src, fails)
  } finally {
    frameBusy.value = false
    clearUploadLock()
  }
  message.value = fails.length ? fails.join('；') : '定格层已更新'
}

function clearFrames() {
  if (!model.value || frameBusy.value) return
  model.value.stopmotionFrames = []
  model.value.stopmotionHero = ''
  revokeThumbs()
  frameSources.length = 0
  heroFromSlot.value = null
  message.value = '已清空 36 帧（保存后小程序回退包内测试帧）'
}

function revokeThumbs() {
  for (const url of Object.values(frameThumbs.value)) URL.revokeObjectURL(url)
  frameThumbs.value = {}
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
function addReassure() {
  if (model.value && model.value.reassureItems.length < 6) model.value.reassureItems.push({ icon: '', title: '', body: '', img: '' })
}
function addReview() {
  if (model.value && model.value.reviewsItems.length < 12) model.value.reviewsItems.push({ quote: '', user: '', img: '' })
}
function addFooterLink() {
  if (model.value && model.value.footerLinks.length < 6) model.value.footerLinks.push('')
}
function delCourseRow(i: number) {
  model.value?.byCourse.splice(i, 1)
}
function delTrust(i: number) {
  model.value?.trust.splice(i, 1)
}
function delFaq(i: number) {
  model.value?.faq.splice(i, 1)
}
function delReassure(i: number) {
  model.value?.reassureItems.splice(i, 1)
}
function delReview(i: number) {
  model.value?.reviewsItems.splice(i, 1)
}
function delFooterLink(i: number) {
  model.value?.footerLinks.splice(i, 1)
}

async function save() {
  if (!model.value || busy.value) return
  if (!loaded) {
    message.value = '内容未成功载入，暂不能保存（避免覆盖已有首页配置·请刷新重试）'
    return
  }
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  busy.value = true
  await flushSave() // 先排空在途/待发的自动保存链（防旧快照 autosave POST 落在手动保存之后·覆盖新编辑·P2）
  const r = await saveHomeContent(homePayload(model.value))
  busy.value = false
  autoState.value = ''
  message.value = r.ok ? '已保存，小程序立即生效' : '保存失败：' + String(r.error || '')
}
</script>

<template>
  <div v-if="model">
    <div class="pc-toolbar">
      <Badge v-if="autoState === 'saving'" tone="amber" dot>自动保存中…</Badge>
      <Badge v-else-if="autoState === 'saved'" tone="green" dot>已自动保存</Badge>
      <Badge v-else-if="autoState === 'error'" tone="red" dot>自动保存失败</Badge>
      <UiButton :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</UiButton>
    </div>
    <p v-if="message" class="ld-status">{{ message }}</p>

    <div class="pc-split">
      <div class="pc-forms">
        <!-- Hero 文案 -->
        <Card title="Hero 顶部" sub="首页顶部主标题 / 副标语 / 搜索框占位文案 / 背景图">
          <div class="field"><label>主标题（≤20 字·留空＝「创造幸运」）</label><input v-model="model.heroTitle" maxlength="20" placeholder="创造幸运" /></div>
          <div class="field"><label>副标语（≤40 字·留空＝「Get ducky get lucky」）</label><input v-model="model.heroTagline" maxlength="40" placeholder="Get ducky get lucky" /></div>
          <div class="field"><label>搜索框占位文案（≤40 字·留空＝「入门钩织的妙趣方式」）</label><input v-model="model.heroSearch" maxlength="40" placeholder="入门钩织的妙趣方式" /></div>
          <div class="upload-field mt">
            <label>顶部背景图（留空＝浅色渐变占位）</label>
            <div class="upload-row">
              <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.heroImg = f), e)" />
              <img v-if="thumb(model.heroImg)" :src="thumb(model.heroImg)" class="bg-thumb" alt="" />
              <span v-if="model.heroImg" class="filetag"><Check :size="12" :stroke-width="2" />已设置</span>
              <button v-if="model.heroImg" class="clr" title="恢复默认" @click="model.heroImg = ''"><X :size="14" :stroke-width="2" /></button>
            </div>
          </div>
        </Card>

        <!-- 首页定格动画（36 帧 scrub + 1 张定格层） -->
        <!-- 副标题分两态（浏览器实测发现：满 36 帧时仍显示「不满 36 帧…」读着自相矛盾）：
             齐了就说小程序已在用这组，没齐才提示回退规则——状态描述必须随状态变。 -->
        <Card
          title="首页定格动画"
          :sub="framesDone === 36 ? `36 帧 · 已传 36/36 · 小程序正在用这组帧` : `36 帧 · 已传 ${framesDone}/36 · 不满 36 帧时小程序用包内测试帧`"
        >
          <template #head>
            <UiButton variant="ghost" size="sm" :disabled="frameBusy" @click="framesInput?.click()">
              <Film :size="14" :stroke-width="2" />{{ frameBusy ? `上传中 ${frameProgress}` : '一次选 36 张' }}
            </UiButton>
            <UiButton variant="ghost" size="sm" :disabled="frameBusy || !framesDone" @click="clearFrames">清空</UiButton>
          </template>
          <input ref="framesInput" type="file" accept="image/*" multiple hidden @change="uploadFrames" />
          <p class="sm-hint">按文件名顺序（1,2,…,36）依次占 0–35 格；单格可点开重传。每张在浏览器里裁成 1:1 后压到 720²，定格那一格另出一张 1080² 高清图。</p>

          <div class="fr-grid">
            <label v-for="i in slots" :key="i" class="fr-cell" :class="{ 'is-hero': model.stopmotionHeroIndex === i }" :title="`第 ${i} 格${model.stopmotionHeroIndex === i ? '（定格帧）' : ''}`">
              <input type="file" accept="image/*" hidden :disabled="frameBusy" @change="(e) => uploadOneFrame(i, e)" />
              <img v-if="frameThumb(i)" :src="frameThumb(i)" class="fr-img" alt="" />
              <span class="fr-idx">{{ i }}</span>
              <Badge v-if="frameUploading === i" tone="amber" dot>传</Badge>
              <Badge v-else-if="model.stopmotionFrames[i]" tone="green"><Check :size="10" :stroke-width="2.5" /></Badge>
              <Badge v-else tone="neutral">空</Badge>
            </label>
          </div>

          <div class="field mt">
            <label>定格帧（首页静止时显示的那一帧 · 默认第 17 格）</label>
            <select v-model.number="model.stopmotionHeroIndex" :disabled="frameBusy">
              <option v-for="i in slots" :key="i" :value="i">第 {{ i }} 格</option>
            </select>
          </div>
          <div class="upload-row">
            <span v-if="model.stopmotionHero" class="filetag"><Check :size="12" :stroke-width="2" />定格层已生成</span>
            <span v-else class="sm-hint">定格层未生成（小程序会退用该格的 720² 帧）</span>
            <UiButton variant="ghost" size="sm" :disabled="frameBusy" @click="regenHero"><RotateCcw :size="13" :stroke-width="2" />重新生成定格层</UiButton>
          </div>
          <p v-if="heroStale" class="sm-warn">定格帧已改到第 {{ model.stopmotionHeroIndex }} 格，当前定格层还是旧那格的——点「重新生成定格层」。</p>
        </Card>

        <!-- 品牌自述 -->
        <Card title="品牌自述" sub="Hero 下方的品牌名与一句话理念">
          <div class="field"><label>品牌名（≤20 字·留空＝「易织™小棉鸭®」）</label><input v-model="model.brandName" maxlength="20" placeholder="易织™小棉鸭®" /></div>
          <div class="field"><label>一句话理念（≤60 字）</label><textarea v-model="model.brandLead" maxlength="60" placeholder="我们希望每个人都能亲手创造自己的随身幸运物。" /></div>
        </Card>

        <!-- 特写方案 -->
        <Card title="特写方案" sub="带配图的方案介绍板块">
          <div class="field"><label>标题（≤30 字）</label><input v-model="model.featureTitle" maxlength="30" placeholder="入门钩织的妙趣方案" /></div>
          <div class="field"><label>正文（≤80 字）</label><textarea v-model="model.featureBody" maxlength="80" placeholder="为了让钩织入门更轻松、更有趣，我们精心设计了这些小家伙。" /></div>
          <div class="upload-field">
            <label>配图（留空＝浅色占位）</label>
            <div class="upload-row">
              <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.featureImg = f), e)" />
              <img v-if="thumb(model.featureImg)" :src="thumb(model.featureImg)" class="bg-thumb" alt="" />
              <span v-if="model.featureImg" class="filetag"><Check :size="12" :stroke-width="2" />已设置</span>
              <button v-if="model.featureImg" class="clr" title="恢复默认" @click="model.featureImg = ''"><X :size="14" :stroke-width="2" /></button>
            </div>
          </div>
        </Card>

        <!-- 激活页背景图（全局 + 逐课程三态·背景图三态留首页签编辑） -->
        <Card title="激活页背景图" sub="激活/加载页背景，可设全局回退与逐课程三态图（此处为背景图三态的唯一编辑处）">
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

        <!-- 放心区（≤6） -->
        <Card title="放心区（把门槛拆掉）" :sub="`标题 + 引语 + 至多 6 条 · 当前 ${model.reassureItems.length} 条 · 留空整组＝用设计默认`">
          <template #head>
            <UiButton variant="ghost" size="sm" :disabled="model.reassureItems.length >= 6" @click="addReassure"><Plus :size="14" :stroke-width="2" />新增一条</UiButton>
          </template>
          <div class="field"><label>区块标题（≤20 字）</label><input v-model="model.reassureHeading" maxlength="20" placeholder="把门槛一一拆掉" /></div>
          <div class="field"><label>引语（≤60 字）</label><textarea v-model="model.reassureLead" maxlength="60" placeholder="新手学习钩织存在很多门槛，我们把这些门槛一一拆掉了。" /></div>
          <div v-for="(it, i) in model.reassureItems" :key="i" class="item-block">
            <div class="item-head"><span class="item-idx">第 {{ i + 1 }} 条</span><button class="icon-btn" title="删除这条" @click="delReassure(i)"><Trash2 :size="14" :stroke-width="1.8" /></button></div>
            <div class="pair2">
              <input v-model="it.icon" placeholder="图标名（如 heart-handshake）" />
              <input v-model="it.title" placeholder="标题（≤20 字）" maxlength="20" />
            </div>
            <textarea v-model="it.body" placeholder="正文（≤120 字）" maxlength="120" />
            <div class="upload-row inline">
              <span class="up-lbl">配图</span>
              <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (it.img = f), e)" />
              <img v-if="thumb(it.img)" :src="thumb(it.img)" class="state-thumb" alt="" />
              <span v-else-if="it.img" class="filetag"><Check :size="12" :stroke-width="2" />已设置</span>
              <button v-if="it.img" class="clr" title="清除配图" @click="it.img = ''"><X :size="13" :stroke-width="2" /></button>
            </div>
          </div>
        </Card>

        <!-- 买家秀（≤12） -->
        <Card title="真实买家秀" :sub="`标题 + 至多 12 条 · 当前 ${model.reviewsItems.length} 条 · 留空整组＝用设计默认`">
          <template #head>
            <UiButton variant="ghost" size="sm" :disabled="model.reviewsItems.length >= 12" @click="addReview"><Plus :size="14" :stroke-width="2" />新增一条</UiButton>
          </template>
          <div class="field"><label>区块标题（≤20 字）</label><input v-model="model.reviewsHeading" maxlength="20" placeholder="真实买家秀" /></div>
          <div v-for="(it, i) in model.reviewsItems" :key="i" class="item-block">
            <div class="item-head"><span class="item-idx">第 {{ i + 1 }} 条</span><button class="icon-btn" title="删除这条" @click="delReview(i)"><Trash2 :size="14" :stroke-width="1.8" /></button></div>
            <textarea v-model="it.quote" placeholder="买家评价（≤120 字）" maxlength="120" />
            <div class="upload-row inline">
              <input v-model="it.user" placeholder="昵称（≤20 字）" maxlength="20" class="user-in" />
              <span class="up-lbl">买家秀图</span>
              <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (it.img = f), e)" />
              <img v-if="thumb(it.img)" :src="thumb(it.img)" class="state-thumb" alt="" />
              <span v-else-if="it.img" class="filetag"><Check :size="12" :stroke-width="2" />已设置</span>
              <button v-if="it.img" class="clr" title="清除配图" @click="it.img = ''"><X :size="13" :stroke-width="2" /></button>
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

        <!-- 收尾 CTA -->
        <Card title="收尾 CTA" sub="首页底部的收尾标语与配图">
          <div class="field"><label>标题（≤20 字）</label><input v-model="model.closingTitle" maxlength="20" placeholder="创造幸运" /></div>
          <div class="field"><label>副标语（≤40 字）</label><input v-model="model.closingCta" maxlength="40" placeholder="Get ducky get lucky" /></div>
          <div class="upload-field">
            <label>配图（留空＝浅色占位）</label>
            <div class="upload-row">
              <input type="file" accept="image/*" @change="(e) => uploadTo((f) => (model!.closingImg = f), e)" />
              <img v-if="thumb(model.closingImg)" :src="thumb(model.closingImg)" class="bg-thumb" alt="" />
              <span v-if="model.closingImg" class="filetag"><Check :size="12" :stroke-width="2" />已设置</span>
              <button v-if="model.closingImg" class="clr" title="恢复默认" @click="model.closingImg = ''"><X :size="14" :stroke-width="2" /></button>
            </div>
          </div>
        </Card>

        <!-- 页脚（≤6 链接 + 版权） -->
        <Card title="页脚" :sub="`底部链接（至多 6）+ 版权文案 · 留空＝用设计默认`">
          <template #head>
            <UiButton variant="ghost" size="sm" :disabled="model.footerLinks.length >= 6" @click="addFooterLink"><Plus :size="14" :stroke-width="2" />新增链接</UiButton>
          </template>
          <div v-if="model.footerLinks.length" class="rows">
            <div v-for="(_, i) in model.footerLinks" :key="i" class="linkrow">
              <input v-model="model.footerLinks[i]" placeholder="链接文案（≤20 字）" maxlength="20" />
              <button class="icon-btn" title="删除" @click="delFooterLink(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
            </div>
          </div>
          <div class="field mt"><label>版权文案（≤120 字）</label><input v-model="model.footerCopy" maxlength="120" placeholder="Copyright © 2026 ZHUO DUCKI LUCKY · All Rights Reserved." /></div>
        </Card>
      </div>

      <!-- 右侧手机预览（首页签简化为 Hero + 品牌区两块） -->
      <div class="pc-phone-wrap">
        <div class="pc-phone">
          <div class="hp-frame">
            <div class="hp-title">{{ model.heroTitle || '创造幸运' }}</div>
            <div class="hp-tagline">{{ model.heroTagline || 'Get ducky get lucky' }}</div>
            <div class="hp-search">{{ model.heroSearch || '入门钩织的妙趣方式' }}</div>
          </div>
          <div class="hp-brand">
            <div class="hp-brand-name">{{ model.brandName || '易织™小棉鸭®' }}</div>
            <div class="hp-brand-lead" :class="{ 'pc-ph': !model.brandLead }">{{ model.brandLead || '我们希望每个人都能亲手创造自己的随身幸运物。' }}</div>
          </div>
        </div>
        <span class="pc-phone-cap">首页 Hero + 品牌区预览</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 首页内容编辑器·本组件独有（共享原语管页头/卡/按钮/徽章/空态；pc- 类管两栏/手机壳；这里留表单位/上传位私有样式） */
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
select {
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
/* 定格动画 36 格 */
.sm-hint {
  margin: 0 0 10px;
  font-size: 11.5px;
  color: var(--ld-content-2);
  line-height: 1.6;
}
.sm-warn {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--ld-amber);
  line-height: 1.6;
}
.fr-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 6px;
}
.fr-cell {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 3px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg-grey);
  overflow: hidden;
  cursor: pointer;
}
.fr-cell.is-hero {
  border-color: var(--ld-purple-line);
  box-shadow: inset 0 0 0 1px var(--ld-purple-line); /* 定格帧那格加内描边，缩略图铺满时也认得出 */
}
.fr-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.fr-idx {
  position: absolute;
  top: 2px;
  left: 2px;
  padding: 0 3px;
  border-radius: 4px;
  background: var(--ld-bg); /* 缩略图铺满后序号会糊在图上，垫一层底保证可读 */
  font-size: 10px;
  font-family: var(--ld-font-mono);
  color: var(--ld-content-2);
}
.fr-cell .badge {
  position: relative;
  transform: scale(0.85);
}
/* 手机预览（Hero + 品牌） */
.hp-frame {
  padding: 22px 16px;
  border-radius: var(--ld-radius);
  background: linear-gradient(160deg, var(--ld-bg-lilac), var(--ld-bg-sage));
  border: 1px solid var(--ld-line);
  text-align: center;
}
.hp-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--ld-ink);
  line-height: 1.3;
}
.hp-tagline {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ld-content-2);
}
.hp-search {
  margin-top: 14px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  font-size: 12px;
  color: var(--ld-content-2);
}
.hp-brand {
  margin-top: 18px;
  text-align: center;
}
.hp-brand-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--ld-ink);
}
.hp-brand-lead {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ld-content-2);
  line-height: 1.5;
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
.course-row {
  display: grid;
  grid-template-columns: 130px 1fr 1fr 1fr auto;
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
.linkrow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}
.mt {
  margin-top: 12px;
}
.item-block {
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  padding: 12px;
  margin-bottom: 10px;
  background: var(--ld-bg);
}
.item-block textarea {
  margin-bottom: 8px;
}
.item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.item-idx {
  font-size: 12px;
  font-weight: 600;
  color: var(--ld-purple-meta);
}
.pair2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}
.upload-row.inline {
  flex-wrap: wrap;
}
.up-lbl {
  font-size: 12px;
  color: var(--ld-content-2);
}
.user-in {
  max-width: 160px;
}
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
