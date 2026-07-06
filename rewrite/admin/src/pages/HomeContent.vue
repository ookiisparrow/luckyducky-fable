<script setup lang="ts">
// 首页内容（设计语言一致性·M3 UI 批12）：hero 文案/信任条/FAQ/激活页背景图（全局 + 按课三态）。
// 图片走 uploadImage（前端压缩·与商品封面同通道）；保存走白名单（云端二次净化）。逻辑未动，仅套设计语言。
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Plus, Check, Trash2, X, ImageOff, ShieldCheck, HelpCircle } from 'lucide-vue-next'
import { getHomeContent, saveHomeContent } from '../api/content'
import { uploadImage } from '../api/products'
import { normalizeHome, homePayload, type HomeModel } from '../lib/mapContent'
import { b64SizeOk } from '../lib/mapProducts'
import { serialSave } from '../lib/serialSave'
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
    saveTimer = setTimeout(() => void flushSave(), 900)
  },
  { deep: true }
)
async function autosave() {
  if (!model.value) return
  const r = await saveHomeContent(homePayload(model.value))
  autoState.value = r.ok ? 'saved' : 'error'
}
const flushSave = serialSave(autosave) // 串行化·防慢网下两次自动保存乱序覆盖（P2·根因#8）
onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    void flushSave() // 离页补存 pending
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
function addReassure() {
  if (model.value && model.value.reassureItems.length < 6) model.value.reassureItems.push({ icon: '', title: '', body: '', img: '' })
}
function addReview() {
  if (model.value && model.value.reviewsItems.length < 12) model.value.reviewsItems.push({ quote: '', user: '', img: '' })
}
function addFooterLink() {
  if (model.value && model.value.footerLinks.length < 6) model.value.footerLinks.push('')
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
      sub="小程序首页全九板块（Hero / 品牌 / 特写 / 信任条 / 放心区 / 买家秀 / FAQ / 收尾 / 页脚）+ 激活页背景图。留空的字段小程序自动用设计默认文案。保存后立即生效。"
    >
      <Badge v-if="autoState === 'saving'" tone="amber" dot>自动保存中…</Badge>
      <Badge v-else-if="autoState === 'saved'" tone="green" dot>已自动保存</Badge>
      <Badge v-else-if="autoState === 'error'" tone="red" dot>自动保存失败</Badge>
      <UiButton :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存全部' }}</UiButton>
    </PageHeader>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <!-- Hero 文案（含所见即所得预览·卡面预览本页独有） -->
    <Card title="Hero 顶部" sub="首页顶部主标题 / 副标语 / 搜索框占位文案 / 背景图">
      <div class="hero-edit">
        <div class="hero-fields">
          <div class="field"><label>主标题（≤20 字·留空＝「创造幸运」）</label><input v-model="model.heroTitle" maxlength="20" placeholder="创造幸运" /></div>
          <div class="field"><label>副标语（≤40 字·留空＝「Get ducky get lucky」）</label><input v-model="model.heroTagline" maxlength="40" placeholder="Get ducky get lucky" /></div>
          <div class="field"><label>搜索框占位文案（≤40 字·留空＝「入门钩织的妙趣方式」）</label><input v-model="model.heroSearch" maxlength="40" placeholder="入门钩织的妙趣方式" /></div>
        </div>
        <div class="hero-preview">
          <div class="hp-frame">
            <div class="hp-title">{{ model.heroTitle || '创造幸运' }}</div>
            <div class="hp-tagline">{{ model.heroTagline || 'Get ducky get lucky' }}</div>
          </div>
          <span class="hp-cap">小程序首页预览</span>
        </div>
      </div>
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

    <!-- 放心区「把门槛拆掉」（≤6 条·icon/标题/正文/图） -->
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

    <!-- 真实买家秀（≤12 条·quote/user/图） -->
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
.linkrow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}

/* 首页新板块：留空提示间距 / 放心区·买家秀的多字段条目块 */
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
