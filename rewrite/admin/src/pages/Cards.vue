<script setup lang="ts">
// 二维码卡片设计器（换皮丢了整块·误判「卡后端」·实则后端 getCard/saveCard + cards 集合早就绪·仅前端从没接）：
// 正面=插画面（满版图+品牌角标）/ 反面=二维码面（标题/副文案/占位/扫码引导/退货小字+品牌条）·双面实时预览·防抖自动保存·
// 定稿并启用（第 6 步批次生成前置）·卡面 SVG 下载（印刷交付）。深链自商品页「卡片设计」。
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCard, saveCard, uploadImage, listDrafts } from '../api/products'
import { b64SizeOk } from '../lib/mapProducts'
import { buildFrontSvg, buildBackSvg, type CardModel } from '../lib/cardSvg'
import { serialSave } from '../lib/serialSave'
// 视图层原语（批F 共享 UI）+ lucide 图标——仅新增 import，管道零改。
// 注意：lucide 的 Image 与 compress() 里 new Image() 的全局 Image 同名，别名 ImageIcon 防遮蔽。
import UiButton from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import { Download, Upload, Image as ImageIcon } from 'lucide-vue-next'

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
  if ((r as any).error === 'SESSION_LOST') return // 会话失效集中导登录（client.onSessionLost·单源·根因#5）
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
    saveTimer = setTimeout(() => void flushSave(), 700)
  },
  { deep: true }
)
// pendingStatus（P1 复审补漏·根因#8）：finalize() 定稿写并入本队列而非旁路直发——旁路会与随后触发的
// 新 autosave 并发在途，谁的响应后到就把谁的 status 落库，慢网下刚定的 final 可能被晚到的旧 draft
// autosave 盖回去（settled()-only 方案只排空「点击那一刻已在途」的链，堵不住这条）。pendingStatus 让
// 队列里「当前及尾随补跑」的每一轮 run() 都携带 next 状态，直到 finalize 收尾才清空。
let pendingStatus: CardModel['status'] | null = null
async function autosave() {
  if (!card.value) return
  const payload = pendingStatus ? { ...card.value, status: pendingStatus } : card.value
  const r = await saveCard(payload as unknown as Record<string, unknown>)
  autoState.value = (r as any).ok ? 'saved' : 'error'
}
// 串行化·防慢网下两次自动保存乱序覆盖（P2·根因#8）；key='cards:'+productId（批D·P1）：改走模块级共享
// 槽位，快速切走再切回本页（或向导内切步再切回）重建组件实例时，新实例接管旧实例仍在途的补存链，防旧
// 快照晚到覆盖新实例已存的编辑；按 productId 分槽——不同商品的卡面互不干扰。
const flushSave = serialSave(autosave, 'cards:' + productId)
onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    void flushSave()
  }
})

const ratio = computed(() => {
  const w = card.value?.sizeMM.w as number, h = card.value?.sizeMM.h as number
  return w > 0 && h > 0 ? h / w : 0.6 // 防清空/0/负 → Infinity/NaN 塌陷预览
})
const prevW = computed(() => (ratio.value > 1 ? 200 : 290))
const isPreset = (p: { w: number; h: number }) => card.value && card.value.sizeMM.w === p.w && card.value.sizeMM.h === p.h
// 尺寸失焦即校正（P2·清空/0/负数会写 NaN 进 sizeMM·塌陷预览+导出无效印刷 SVG）：clamp 到 40–300 整数·非法回退 85
function clampDims() {
  if (!card.value) return
  const fix = (n: number) => (Number.isFinite(n) && n > 0 ? Math.min(300, Math.max(40, Math.round(n))) : 85)
  card.value.sizeMM = { w: fix(card.value.sizeMM.w), h: fix(card.value.sizeMM.h) }
}

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
async function finalize() {
  if (!card.value) return
  if (!card.value.front.art) {
    loadErr.value = '正面还没有图案——取商品封面图或上传插画'
    return
  }
  // 先落库、成功才翻定稿态（审核补漏·病根#14 伪成功）：不乐观翻——防前端显「已定稿」而后端仍 draft，
  // 第 6 步码批次依赖 cardFinal 落库·否则生成失败且排障无线索。
  if (saveTimer) {
    clearTimeout(saveTimer) // 取消未触发的防抖定时器（只挡得住这半·同 Products/HomeContent 约定）
    saveTimer = null
  }
  const next = card.value.status === 'final' ? 'draft' : 'final'
  // 定稿写并入同一条 serialSave 队列（P1 复审补漏·根因#8）：不再旁路直发 saveCard，改走 flushSave()
  // 本尊（非 .settled()）——trigger() 对「已在途」的链只标脏、不并发再发一次 POST，会等其跑完再补跑
  // 一轮；期间若又有新 autosave 触发（watch 的 900ms 计时器到点），一样标脏排进同一条链，不会跟本次
  // 定稿写并发在途。pendingStatus 保证链上「当前轮 + 尾随补跑轮」发出的都是 next 状态，不被旧 draft
  // 覆盖；flushSave() 收尾即整条链跑空，autoState 反映的是链上最后一轮（即本次定稿）的真实结果。
  pendingStatus = next
  await flushSave()
  pendingStatus = null
  if (!card.value) return // 排空期间页面被卸载（embed 模式随向导切步）——card 已置空则不再往下写
  if (autoState.value === 'saved') {
    card.value.status = next
    loadErr.value = ''
  } else {
    loadErr.value = (next === 'final' ? '定稿' : '取消定稿') + '保存失败：请重试'
  }
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
  <div class="ld-page">
    <!-- 编辑器头（embed 双模：向导内 v-if="!embed" 隐标题/返回，仅留自动保存 + 定稿；PageHeader 不适配此双模，标题块内部门控） -->
    <header class="cards-head">
      <div v-if="!embed" class="cards-title">
        <h1>二维码卡片设计</h1>
        <p class="cards-sub">正面 = 插画面（颜值与品牌），反面 = 二维码面（扫码与指引）；印刷包输出正反两张矢量图。</p>
      </div>
      <div class="cards-actions">
        <Badge v-if="autoState" :tone="autoState === 'saved' ? 'green' : autoState === 'error' ? 'red' : 'neutral'" dot>
          {{ autoState === 'saving' ? '自动保存中…' : autoState === 'saved' ? '已自动保存' : '自动保存失败' }}
        </Badge>
        <UiButton v-if="!embed" variant="ghost" @click="router.back()">← 返回</UiButton>
        <UiButton v-if="card" :variant="card.status === 'final' ? 'ghost' : 'primary'" @click="finalize">{{ card.status === 'final' ? '↩ 改回草稿' : '✅ 定稿并启用' }}</UiButton>
      </div>
    </header>

    <p v-if="loadErr" class="err-line">{{ loadErr }}</p>
    <p v-else-if="loading" class="ld-status">加载中…</p>

    <div v-else-if="card" class="work">
      <!-- 双面预览 -->
      <div class="stage">
        <div class="side">
          <div class="cardprev" :style="{ width: prevW + 'px', height: prevW * ratio + 'px', background: card.front.bg }">
            <img v-if="artUrl" :src="artUrl" alt="" class="front-art" />
            <span v-else class="front-ph">满版插画 / 产品图</span>
            <span v-if="card.front.showBrand" class="front-chip">🦆 Lucky Ducky · 小棉鸭</span>
          </div>
          <div class="side-foot">
            <span class="side-label">正面 · 插画面</span>
            <button class="dl" @click="downloadSvg('front')"><Download :size="12" :stroke-width="1.9" /><span>下载 SVG</span></button>
          </div>
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
          <div class="side-foot">
            <span class="side-label">反面 · 二维码面</span>
            <button class="dl" @click="downloadSvg('back')"><Download :size="12" :stroke-width="1.9" /><span>下载 SVG</span></button>
          </div>
        </div>
        <p class="stage-note">{{ card.sizeMM.w }} × {{ card.sizeMM.h }} mm · <b :class="{ ok: card.status === 'final' }">{{ card.status === 'final' ? '已定稿' : '草稿' }}</b></p>
      </div>

      <!-- 属性面板（每组一张 Card） -->
      <div class="panel">
        <Card title="卡片尺寸（mm，双面同尺寸）">
          <div class="presets">
            <button v-for="p in PRESETS" :key="p.label" class="ld-chip" :class="{ on: isPreset(p) }" @click="card.sizeMM = { w: p.w, h: p.h }">{{ p.label }}</button>
          </div>
          <div class="dims">
            <label>宽 <input v-model.number="card.sizeMM.w" @change="clampDims" type="number" min="40" max="300" class="num" /></label>
            <span>×</span>
            <label>高 <input v-model.number="card.sizeMM.h" @change="clampDims" type="number" min="40" max="300" class="num" /></label>
          </div>
        </Card>

        <Card title="正面 · 插画面">
          <div class="artrow">
            <div class="artthumb" :style="{ background: card.front.bg }"><img v-if="artUrl" :src="artUrl" alt="" /></div>
            <div class="artbtns">
              <UiButton variant="ghost" size="sm" @click="useCover"><ImageIcon :size="14" :stroke-width="1.8" /><span>取商品封面图</span></UiButton>
              <label class="upload-btn"><input type="file" accept="image/*" hidden @change="pickArt" /><Upload :size="14" :stroke-width="1.8" /><span>{{ busyArt ? '上传中…' : '上传插画' }}</span></label>
            </div>
          </div>
          <label class="check"><input v-model="card.front.showBrand" type="checkbox" /> 左下角品牌角标</label>
          <div class="swatchline">
            <span class="swlabel">衬底色</span>
            <button v-for="c in SWATCHES" :key="'f' + c" class="swatch" :class="{ on: card.front.bg === c }" :style="{ background: c }" @click="card.front.bg = c"></button>
          </div>
        </Card>

        <Card title="反面 · 二维码面">
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
        </Card>

        <p class="hint">二维码区按激活码自动生成、无需设计；定稿后到「激活码批次」生成批次——印刷包含 正面.svg + 反面.svg + 地址清单。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 本页独有：编辑器头（embed 双模·标题块内部门控）· 卡面双面预览（正/背）· 属性面板内的色板/上传位/内联输入。
 * 页头文字节奏套 PageHeader 视觉但保留手写（PageHeader 强渲标题·不适配 embed 隐标题留操作）；
 * 卡容器/徽章/按钮/尺寸预设 chip/状态行已交共享原语（Card/Badge/UiButton/.ld-chip/.ld-status）。 */
.cards-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.cards-title h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--ld-ink);
  line-height: 1.25;
}
.cards-sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.cards-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  margin-left: auto;
}
.err-line {
  margin: 0;
  font-size: 13px;
  color: var(--ld-red);
}

.work {
  display: flex;
  gap: 26px;
  align-items: flex-start;
  flex-wrap: wrap;
}

/* 预览台（淡紫衬底·托起正反两张卡面） */
.stage {
  flex: 0 0 360px;
  background: var(--ld-bg-lilac);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 11px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-brand-active);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.dl:hover {
  border-color: var(--ld-purple-line);
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

/* 卡面（正/背·印刷预览·rgba 阴影/半透角标非主题色不入 token） */
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

/* 属性面板：右列纵向堆叠三张 Card + 提示 */
.panel {
  flex: 1;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 430px;
}
.presets {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
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
  border-radius: var(--ld-radius-sm);
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
  border-radius: var(--ld-radius-sm);
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
  flex-wrap: wrap;
}
/* 上传插画：file input 触发器必须是 <label> 包 <input>，无法用 <button> UiButton——手写成 ghost 观感 */
.upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  color: var(--ld-content);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.upload-btn:hover {
  border-color: var(--ld-purple-line);
  color: var(--ld-purple-ink);
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
  flex-wrap: wrap;
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
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  box-sizing: border-box;
}
.hint {
  padding: 10px 14px;
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg-lilac);
  border: 1px solid var(--ld-line);
  font-size: 11.5px;
  margin: 0;
  color: var(--ld-content-2);
}
</style>
