<script setup lang="ts">
// 目录与播放页签（批C）：课程目录页 hero 图 + 续播文案 + 课时空态文案；播放页求助面板三卡标题 + FAQ 增删改（≤20）。
// hero 图走 uploadImage 通道（前端压缩·与首页/商品封面同管线）、存 fileID、会话内缩略预览（sessionUrls）。
// 帮助视频不在此签编辑（已有 /help-videos 页），只留一行链接提示。
import { ref } from 'vue'
import { Plus, Trash2, Check, X, HelpCircle } from 'lucide-vue-next'
import { usePageContent } from '../../lib/usePageContent'
import { normalizeCatalogPlayer, catalogPlayerPayload } from '../../lib/mapPageContent'
import { uploadImage } from '../../api/products'
import { b64SizeOk } from '../../lib/mapProducts'
import UiButton from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'
import Card from '../ui/Card.vue'
import EmptyState from '../ui/EmptyState.vue'

const { model, message, busy, autoState, save } = usePageContent('catalogPlayer', normalizeCatalogPlayer, catalogPlayerPayload)
const sessionUrls = ref<Record<string, string>>({}) // 新上传 fileID→url 缩略预览（本会话）
const thumb = (fileID: string) => sessionUrls.value[fileID] || ''
const uploading = ref(false)

function addFaq() {
  if (model.value && model.value.help.faq.length < 20) model.value.help.faq.push({ q: '', a: '' })
}
function delFaq(i: number) {
  model.value?.help.faq.splice(i, 1)
}

async function onHero(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 重置 value：允许上传失败后重选同一文件重试（否则浏览器不再触发 change）
  if (!file || !model.value) return
  const b64 = await compress(file)
  if (!b64SizeOk(b64)) {
    message.value = '图片压缩后仍超限，换小一点的图'
    return
  }
  uploading.value = true
  const r = await uploadImage(b64, 'catalogcontent', 'jpg')
  uploading.value = false
  if (r.ok) {
    const fid = String(r.fileID || '')
    model.value.catalog.heroImage = fid
    if (fid) sessionUrls.value[fid] = String(r.url || '')
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
        <Card title="课程目录页" sub="目录顶部 hero 图 + 续播按钮文案 + 章节无课时的空态文案">
          <div class="pc-field">
            <label>目录 hero 图（留空＝小程序用默认渐变）</label>
            <div class="pc-row">
              <input type="file" accept="image/*" class="pc-file" @change="onHero" />
              <img v-if="thumb(model.catalog.heroImage)" :src="thumb(model.catalog.heroImage)" class="pc-thumb" alt="" />
              <span v-if="model.catalog.heroImage" class="pc-filetag"><Check :size="12" :stroke-width="2" />已设置</span>
              <button v-if="model.catalog.heroImage" class="pc-clr" title="恢复默认" @click="model.catalog.heroImage = ''"><X :size="14" :stroke-width="2" /></button>
              <span v-if="uploading" class="pc-hint">上传中…</span>
            </div>
          </div>
          <div class="pc-field"><label>续播按钮文案（≤40 字·留空＝默认「继续学习」）</label><input v-model="model.catalog.resumeCta" class="pc-input" maxlength="40" placeholder="继续学习" /></div>
          <div class="pc-field"><label>课时空态文案（≤40 字·章节暂无课时时显示）</label><input v-model="model.catalog.emptyLesson" class="pc-input" maxlength="40" placeholder="课程内容整理中，敬请期待" /></div>
        </Card>

        <Card title="播放页求助面板" sub="播放页「遇到问题了」面板三栏标题 + 常见问题 FAQ">
          <div class="pc-field"><label>联系客服栏标题（≤60 字）</label><input v-model="model.help.contactTitle" class="pc-input" maxlength="60" placeholder="联系客服" /></div>
          <div class="pc-field"><label>帮助视频栏标题（≤60 字）</label><input v-model="model.help.videosTitle" class="pc-input" maxlength="60" placeholder="帮助视频" /></div>
          <div class="pc-field"><label>常见问题栏标题（≤60 字）</label><input v-model="model.help.faqTitle" class="pc-input" maxlength="60" placeholder="常见问题" /></div>
          <p class="pc-hint">帮助视频的增删改与上传在「帮助视频」页（侧栏 · 商品与上新组）单独维护，此处只设栏标题。</p>
        </Card>

        <Card title="常见问题 FAQ" :sub="`求助面板 FAQ · 最多 20 条 · 当前 ${model.help.faq.length} 条`">
          <template #head>
            <UiButton variant="ghost" size="sm" :disabled="model.help.faq.length >= 20" @click="addFaq"><Plus :size="14" :stroke-width="2" />新增一条</UiButton>
          </template>
          <EmptyState v-if="!model.help.faq.length" :icon="HelpCircle" text="暂无 FAQ，点「新增一条」添加" />
          <div v-for="(f, i) in model.help.faq" :key="i" class="pc-item">
            <div class="pc-item-head"><span class="pc-item-idx">第 {{ i + 1 }} 条</span><button class="pc-iconbtn" title="删除这条" @click="delFaq(i)"><Trash2 :size="14" :stroke-width="1.8" /></button></div>
            <div class="pc-field"><label>问题（≤120 字）</label><input v-model="f.q" class="pc-input" maxlength="120" placeholder="视频卡住 / 加载不出来怎么办？" /></div>
            <div class="pc-field"><label>回答（≤1000 字）</label><textarea v-model="f.a" class="pc-textarea" maxlength="1000" placeholder="请检查网络后重新进入课程；仍有问题点「联系客服」。" /></div>
          </div>
        </Card>
      </div>

      <!-- 右侧手机预览：目录 hero + 续播 + 求助三卡标题 -->
      <div class="pc-phone-wrap">
        <div class="pc-phone">
          <div class="ph-hero" :class="{ 'ph-hero-img': !!thumb(model.catalog.heroImage) }" :style="thumb(model.catalog.heroImage) ? { backgroundImage: `url(${thumb(model.catalog.heroImage)})` } : {}">
            <span v-if="!thumb(model.catalog.heroImage)" class="pc-ph">（目录 hero 图）</span>
          </div>
          <div class="ph-resume">▶ {{ model.catalog.resumeCta || '继续学习' }}</div>
          <div class="ph-empty pc-ph">空态：{{ model.catalog.emptyLesson || '（默认空态文案）' }}</div>
          <div class="ph-help">
            <div class="ph-help-cap">遇到问题了</div>
            <div class="ph-help-card">{{ model.help.contactTitle || '联系客服' }}</div>
            <div class="ph-help-card">{{ model.help.videosTitle || '帮助视频' }}</div>
            <div class="ph-help-card">{{ model.help.faqTitle || '常见问题' }} · {{ model.help.faq.length }} 条</div>
          </div>
        </div>
        <span class="pc-phone-cap">课程目录 + 求助面板预览</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pc-file {
  font-size: 12px;
}
.ph-hero {
  height: 120px;
  border-radius: 14px;
  background: var(--ld-bg);
  border: 1px dashed var(--ld-line-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.ph-hero-img {
  border: none;
  background-size: cover;
  background-position: center;
}
.ph-resume {
  margin-top: 14px;
  padding: 10px;
  border-radius: 10px;
  background: var(--ld-brand);
  color: #fff;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
}
.ph-empty {
  margin-top: 12px;
  font-size: 12px;
  text-align: center;
}
.ph-help {
  margin-top: 18px;
}
.ph-help-cap {
  font-size: 13px;
  font-weight: 700;
  color: var(--ld-ink);
  margin-bottom: 8px;
}
.ph-help-card {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12.5px;
  color: var(--ld-content);
  margin-bottom: 8px;
}
</style>
