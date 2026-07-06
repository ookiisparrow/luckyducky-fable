<script setup lang="ts">
// 二维码卡片设计器（换皮丢了整块·误判「卡后端」·实则后端 getCard/saveCard + cards 集合早就绪·仅前端从没接）：
// 正面=插画面（满版图+品牌角标）/ 反面=二维码面（标题/副文案/占位/扫码引导/退货小字+品牌条）·双面实时预览·防抖自动保存·
// 定稿并启用（第 6 步批次生成前置）·卡面 SVG 下载（印刷交付）。深链自商品页「卡片设计」。
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCard, saveCard, uploadImage, listDrafts } from '../api/products'
import { b64SizeOk } from '../lib/mapProducts'
import { buildFrontSvg, buildBackSvg, type CardModel } from '../lib/cardSvg'

// 嵌入模式（上新向导步 5 复用·向后兼容·独立 /cards?productId 用法不传 props 行为不变）：
// embed=true 隐页头/返回·wizardProductId 覆盖 route.query.productId。
const props = defineProps<{ embed?: boolean; wizardProductId?: string }>()
const route = useRoute()
const router = useRouter()
const productId = props.wizardProductId || String(route.query.productId || '')

const card = ref<CardModel | null>(null)
const artUrl = ref('')
const loading = ref(true)
const loadErr = ref('')
const busyArt = ref(false)
const autoState = ref('') // '' | saving | saved | error
const product = ref<Record<string, any> | null>(null)
const coverUrl = ref('')

const PRESETS = [
  { label: '90 × 54', w: 90, h: 54 },
  { label: '105 × 148', w: 105, h: 148 },
]
const SWATCHES = ['#f6e9b8', '#fbe3ea', '#e3edfb', '#e6f2e7', '#fcfaff', '#ffffff'] // structure-ok 卡面衬底候选色（印刷卡面·非 UI 主题·卡面本就自选色）

function freshCard(): CardModel {
  const p = product.value || {}
  return {
    productId,
    courseId: String(p.courseId || '') || 'course-' + productId,
    name: (String(p.name || '') || '新商品') + ' · 激活卡',
    status: 'draft',
    front: { art: '', bg: '#f6e9b8', showBrand: true }, // structure-ok 卡面默认衬底（印刷·非主题）
    back: {
      bg: '#ffffff', // structure-ok 卡面默认底（印刷·非主题）
      texts: {
        title: '恭喜你解锁新的钩织之旅',
        sub: '扫码解锁专属视频教程',
        scanHint: '请使用微信扫一扫激活课程',
        warning: '提示：激活课程后，该商品将不再支持退货',
      },
      brandText: 'Lucky Ducky · 小棉鸭',
    },
    sizeMM: { w: 90, h: 54 },
  }
}

let loaded = false
onMounted(async () => {
  if (!productId) {
    loadErr.value = '缺少 productId（请从商品页「卡片设计」进入）'
    loading.value = false
    return
  }
  // 载入产品（取名/封面·「取商品封面图」用）+ 卡片草稿
  const [dr, r] = await Promise.all([listDrafts(), getCard(productId)])
  if ((dr as any).ok) {
    const urls = (dr as any).urls || {}
    product.value = ((dr as any).list as Record<string, any>[]).find((p) => String(p.id || p._id) === productId) || null
    if (product.value?.cover) coverUrl.value = urls[String(product.value.cover)] || ''
  }
  if ((r as any).error === 'SESSION_LOST') return void router.push('/login')
  if ((r as any).ok) {
    card.value = ((r as any).card as CardModel) || freshCard()
    artUrl.value = String((r as any).artUrl || '')
    if (!(r as any).card && product.value?.cover) {
      card.value.front.art = String(product.value.cover)
      artUrl.value = coverUrl.value
    }
  } else loadErr.value = '卡面加载失败：' + String((r as any).error || '')
  loading.value = false
  void nextTick(() => (loaded = true))
})

// 防抖自动保存（含离页补存·load-guard）
let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  card,
  () => {
    if (!card.value || !loaded) return
    autoState.value = 'saving'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void autosave(), 700)
  },
  { deep: true }
)
async function autosave() {
  if (!card.value) return
  const r = await saveCard(card.value as unknown as Record<string, unknown>)
  autoState.value = (r as any).ok ? 'saved' : 'error'
}
onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    void autosave()
  }
})

const ratio = computed(() => (card.value ? card.value.sizeMM.h / card.value.sizeMM.w : 0.6))
const prevW = computed(() => (ratio.value > 1 ? 200 : 290))
const isPreset = (p: { w: number; h: number }) => card.value && card.value.sizeMM.w === p.w && card.value.sizeMM.h === p.h

async function pickArt(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file || busyArt.value || !card.value) return
  const b64 = await compress(file)
  if (!b64SizeOk(b64)) {
    loadErr.value = '图片压缩后仍超限，换小一点的图'
    return
  }
  busyArt.value = true
  const r = await uploadImage(b64, productId, 'jpg')
  busyArt.value = false
  if ((r as any).ok) {
    card.value.front.art = String((r as any).fileID || '')
    artUrl.value = String((r as any).url || '')
    loadErr.value = ''
  } else loadErr.value = '图片上传失败：' + String((r as any).error || '')
}
function useCover() {
  if (!card.value) return
  if (!product.value?.cover) {
    loadErr.value = '该商品还没有封面图（去商品页上传）'
    return
  }
  card.value.front.art = String(product.value.cover)
  artUrl.value = coverUrl.value
}
function finalize() {
  if (!card.value) return
  if (!card.value.front.art) {
    loadErr.value = '正面还没有图案——取商品封面图或上传插画'
    return
  }
  card.value.status = card.value.status === 'final' ? 'draft' : 'final'
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

// 卡面 SVG 下载（印刷交付·印刷厂按地址清单一码一图·二维码区为占位）
function downloadSvg(kind: 'front' | 'back') {
  if (!card.value) return
  const svg = kind === 'front' ? buildFrontSvg(card.value, artUrl.value) : buildBackSvg(card.value)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `卡面-${kind === 'front' ? '正面-插画' : '反面-二维码'}-${productId}.svg`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div v-if="!embed">
        <h1>二维码卡片设计</h1>
        <p class="sub">正面 = 插画面（颜值与品牌），反面 = 二维码面（扫码与指引）；印刷包输出正反两张矢量图。</p>
      </div>
      <div class="head-r">
        <span class="auto" :class="autoState">{{ autoState === 'saving' ? '自动保存中…' : autoState === 'saved' ? '已自动保存' : autoState === 'error' ? '自动保存失败' : '' }}</span>
        <button v-if="!embed" class="btn-ghost" @click="router.back()">← 返回</button>
        <button v-if="card" class="btn-primary" :class="{ ghost: card.status === 'final' }" @click="finalize">{{ card.status === 'final' ? '↩ 改回草稿' : '✅ 定稿并启用' }}</button>
      </div>
    </header>

    <p v-if="loadErr" class="status">{{ loadErr }}</p>
    <p v-else-if="loading" class="status-soft">加载中…</p>

    <div v-else-if="card" class="work">
      <!-- 双面预览 -->
      <div class="stage">
        <div class="side">
          <div class="cardprev" :style="{ width: prevW + 'px', height: prevW * ratio + 'px', background: card.front.bg }">
            <img v-if="artUrl" :src="artUrl" alt="" class="front-art" />
            <span v-else class="front-ph">满版插画 / 产品图</span>
            <span v-if="card.front.showBrand" class="front-chip">🦆 Lucky Ducky · 小棉鸭</span>
          </div>
          <div class="side-foot"><span class="side-label">正面 · 插画面</span><button class="dl" @click="downloadSvg('front')">下载 SVG</button></div>
        </div>
        <div class="side">
          <div class="cardprev back" :style="{ width: prevW + 'px', height: prevW * ratio + 'px', background: card.back.bg }">
            <div class="b-t1">{{ card.back.texts.title }}</div>
            <div class="b-t2">{{ card.back.texts.sub }}</div>
            <div class="b-qr">二维码区<br />一码一图</div>
            <div class="b-t3">{{ card.back.texts.scanHint }}</div>
            <div class="b-flex"></div>
            <div class="b-warn">{{ card.back.texts.warning }}</div>
            <div class="b-bar">{{ card.back.brandText }}</div>
          </div>
          <div class="side-foot"><span class="side-label">反面 · 二维码面</span><button class="dl" @click="downloadSvg('back')">下载 SVG</button></div>
        </div>
        <p class="stage-note">{{ card.sizeMM.w }} × {{ card.sizeMM.h }} mm · <b :class="{ ok: card.status === 'final' }">{{ card.status === 'final' ? '已定稿' : '草稿' }}</b></p>
      </div>

      <!-- 属性面板 -->
      <div class="panel">
        <div class="sec">
          <div class="sec-t">卡片尺寸（mm，双面同尺寸）</div>
          <div class="presets">
            <button v-for="p in PRESETS" :key="p.label" class="preset" :class="{ on: isPreset(p) }" @click="card.sizeMM = { w: p.w, h: p.h }">{{ p.label }}</button>
          </div>
          <div class="dims">
            <label>宽 <input v-model.number="card.sizeMM.w" type="number" min="40" max="300" class="num" /></label>
            <span>×</span>
            <label>高 <input v-model.number="card.sizeMM.h" type="number" min="40" max="300" class="num" /></label>
          </div>
        </div>

        <div class="sec group">
          <div class="sec-t">正面 · 插画面</div>
          <div class="artrow">
            <div class="artthumb" :style="{ background: card.front.bg }"><img v-if="artUrl" :src="artUrl" alt="" /></div>
            <div class="artbtns">
              <button class="btn-ghost sm" @click="useCover">取商品封面图</button>
              <label class="btn-ghost sm"><input type="file" accept="image/*" hidden @change="pickArt" />{{ busyArt ? '上传中…' : '上传插画' }}</label>
            </div>
          </div>
          <label class="check"><input v-model="card.front.showBrand" type="checkbox" /> 左下角品牌角标</label>
          <div class="swatchline">
            <span class="swlabel">衬底色</span>
            <button v-for="c in SWATCHES" :key="'f' + c" class="swatch" :class="{ on: card.front.bg === c }" :style="{ background: c }" @click="card.front.bg = c"></button>
          </div>
        </div>

        <div class="sec group">
          <div class="sec-t">反面 · 二维码面</div>
          <label class="fl">主标题</label>
          <input v-model="card.back.texts.title" class="in" maxlength="40" />
          <label class="fl">副文案</label>
          <input v-model="card.back.texts.sub" class="in" maxlength="60" />
          <label class="fl">扫码引导</label>
          <input v-model="card.back.texts.scanHint" class="in" maxlength="30" />
          <label class="fl">退货提醒（小字）</label>
          <input v-model="card.back.texts.warning" class="in" maxlength="50" />
          <label class="fl">底部品牌条文字</label>
          <input v-model="card.back.brandText" class="in" maxlength="30" />
          <div class="swatchline" style="margin-top: 10px">
            <span class="swlabel">底色</span>
            <button v-for="c in SWATCHES" :key="'b' + c" class="swatch" :class="{ on: card.back.bg === c }" :style="{ background: c }" @click="card.back.bg = c"></button>
          </div>
        </div>
        <p class="hint">二维码区按激活码自动生成、无需设计；定稿后到「激活码批次」生成批次——印刷包含 正面.svg + 反面.svg + 地址清单。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1080px;
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
  gap: 10px;
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
.btn-primary {
  padding: 9px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary.ghost,
.btn-ghost {
  background: var(--ld-bg);
  color: var(--ld-content);
  border: 1px solid var(--ld-line);
}
.btn-ghost {
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-ghost.sm {
  padding: 6px 12px;
  font-size: 12px;
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
}
.work {
  display: flex;
  gap: 26px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.stage {
  flex: 0 0 360px;
  background: var(--ld-bg-lilac);
  border-radius: 14px;
  padding: 24px 26px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}
.side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.side-foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.side-label {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.dl {
  padding: 3px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-brand-active);
  font-size: 11px;
  cursor: pointer;
}
.stage-note {
  width: 100%;
  text-align: center;
  font-size: 11.5px;
  color: var(--ld-content-2);
  margin: 0;
}
.stage-note .ok {
  color: var(--ld-green);
}
.cardprev {
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(36, 23, 51, 0.18);
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.front-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.front-ph {
  margin: auto;
  font-size: 11px;
  color: var(--ld-content-2);
}
.front-chip {
  position: absolute;
  left: 6%;
  bottom: 6%;
  background: rgba(36, 23, 51, 0.92);
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  border-radius: 99px;
  padding: 3.5px 10px;
}
.b-t1 {
  font-size: 13px;
  font-weight: 700;
  color: var(--ld-ink);
  margin-top: 7%;
  padding: 0 10px;
  text-align: center;
}
.b-t2 {
  font-size: 9px;
  color: var(--ld-content-2);
  margin-top: 2px;
}
.b-qr {
  width: 34%;
  aspect-ratio: 1;
  border: 1px dashed var(--ld-line-strong);
  border-radius: 6px;
  margin-top: 4%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 8.5px;
  color: var(--ld-content-2);
  line-height: 1.5;
}
.b-t3 {
  font-size: 9px;
  font-weight: 600;
  color: var(--ld-content);
  margin-top: 3%;
}
.b-flex {
  flex: 1;
}
.b-warn {
  font-size: 7px;
  color: var(--ld-content-2);
  padding: 0 8px 4px;
  text-align: center;
}
.b-bar {
  margin-top: auto;
  width: 100%;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 8.5px;
  font-weight: 600;
  text-align: center;
  padding: 4.5% 0;
}
.panel {
  flex: 1;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 430px;
}
.sec.group {
  border: 1px solid var(--ld-line);
  border-radius: 12px;
  padding: 14px 16px;
}
.sec-t {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ld-ink);
  margin-bottom: 10px;
}
.presets {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.preset {
  border: 1px solid var(--ld-line-strong);
  background: var(--ld-bg);
  border-radius: 99px;
  padding: 6px 12px;
  font-size: 11.5px;
  cursor: pointer;
}
.preset.on {
  border-color: var(--ld-brand);
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
  font-weight: 600;
}
.dims {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12px;
  color: var(--ld-content-2);
}
.dims label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.num {
  width: 80px;
  padding: 7px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
}
.artrow {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}
.artthumb {
  width: 74px;
  height: 50px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--ld-line);
  flex: 0 0 auto;
}
.artthumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.artbtns {
  display: flex;
  gap: 8px;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ld-content);
  margin-bottom: 10px;
}
.swatchline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.swlabel {
  font-size: 11px;
  color: var(--ld-content-2);
  margin-right: 2px;
}
.swatch {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--ld-line);
  cursor: pointer;
}
.swatch.on {
  border: 2.5px solid var(--ld-brand);
}
.fl {
  display: block;
  margin: 8px 0 4px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.in {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--ld-bg-lilac);
  font-size: 11.5px;
  margin: 0;
  color: var(--ld-content-2);
}
</style>
