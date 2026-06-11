<script setup>
/**
 * 第 5 步 · 二维码卡片（双面卡设计器，规格 §六 修订）。
 * 正面 = 插画面（满版图案 + 品牌角标）；反面 = 二维码面（标题/副文案/二维码区/三步说明/品牌条）。
 * 双面并排实时预览；草稿防抖自动保存；「定稿并启用」后第 6 步才能生成批次。
 */
import { ref, computed } from 'vue'
import { useProductsStore } from '@/store/products.js'
import { useAutosave } from '@/composables/useAutosave.js'
import { cloudMode, getCard, saveCard, uploadImage } from '@/api/cloud.js'

const props = defineProps({ product: { type: Object, required: true } })
const store = useProductsStore()

const card = ref(null)
const artUrl = ref('')
const loading = ref(true)
const loadErr = ref('')
const busyArt = ref(false)

const PRESETS = [
  { label: '90 × 54', w: 90, h: 54 },
  { label: '105 × 148', w: 105, h: 148 },
]
const SWATCHES = ['#f6e9b8', '#fbe3ea', '#e3edfb', '#e6f2e7', '#fcfaff', '#ffffff']

function freshCard() {
  return {
    productId: props.product.id,
    courseId: props.product.courseId || 'course-' + props.product.id,
    name: (props.product.name || '新商品') + ' · 激活卡',
    status: 'draft',
    front: { art: '', bg: '#f6e9b8', showBrand: true },
    back: {
      bg: '#ffffff',
      texts: {
        title: '恭喜你解锁新的钩织之旅',
        sub: '扫码解锁专属视频教程',
        scanHint: '请使用微信扫一扫激活课程',
        warning: '提示：激活课程后，该商品将不再支持退货',
      },
      brandText: 'Lucky Ducky · 幸运小鸭',
    },
    sizeMM: { w: 90, h: 54 },
  }
}

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  try {
    const r = await getCard(props.product.id)
    if (r.card) {
      card.value = r.card
      artUrl.value = r.artUrl
    } else {
      card.value = freshCard()
      if (props.product.cover) {
        card.value.front.art = props.product.cover
        artUrl.value = store.imgUrl(props.product.cover)
      }
    }
  } catch (e) {
    loadErr.value = '卡面加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

// 防抖自动保存（含离开页面 flush）：卡面存 cards，存完同步商品的卡片状态（圆点判定）
const { saveState } = useAutosave(card, (snap) => saveCard(snap), {
  delay: 700,
  ready: () => !loading.value,
  afterSave: () => store.update(props.product.id, { cardStatus: card.value.status }),
})

const ratio = computed(() => (card.value ? card.value.sizeMM.h / card.value.sizeMM.w : 0.6))
const prevW = computed(() => (ratio.value > 1 ? 210 : 300)) // 竖排预览：竖版卡收窄防止过高
const isPreset = (p) => card.value && card.value.sizeMM.w === p.w && card.value.sizeMM.h === p.h
function usePreset(p) {
  card.value.sizeMM = { w: p.w, h: p.h }
}
async function pickArt(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || busyArt.value) return
  busyArt.value = true
  try {
    const { ref: fileRef, url } = await uploadImage(file, props.product.id)
    card.value.front.art = fileRef
    artUrl.value = url
  } catch (err) {
    alert('图片上传失败：' + err.message)
  } finally {
    busyArt.value = false
  }
}
function useCover() {
  if (!props.product.cover) return alert('该商品还没有封面图（第 1 步上传）')
  card.value.front.art = props.product.cover
  artUrl.value = store.imgUrl(props.product.cover)
}
function finalize() {
  if (!card.value.front.art) return alert('正面还没有图案——取商品封面图或上传插画')
  card.value.status = card.value.status === 'final' ? 'draft' : 'final'
}
</script>

<template>
  <div>
    <div class="headrow">
      <div>
        <h2>第 5 步 · 二维码卡片（双面）</h2>
        <p class="desc">正面 = 插画面（颜值与品牌），反面 = 二维码面（扫码与指引）；印刷包输出正反两张矢量图</p>
      </div>
      <span class="save" :class="saveState">
        {{ { saving: '保存中…', saved: '已保存 ✓', error: '保存失败' }[saveState] || '' }}
      </span>
      <button v-if="card" class="btn" :class="card.status === 'final' ? 'ghost' : 'primary'" @click="finalize">
        {{ card.status === 'final' ? '↩ 改回草稿' : '✅ 定稿并启用' }}
      </button>
    </div>

    <p v-if="!cloudMode" class="hint warn">卡面设计需云端模式。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <div v-else-if="card" class="work">
      <!-- 双面预览 -->
      <div class="stage">
        <div class="side">
          <div class="cardprev front" :style="{ width: prevW + 'px', height: prevW * ratio + 'px', background: card.front.bg }">
            <img v-if="artUrl" :src="artUrl" alt="" class="front-art" />
            <span v-else class="front-ph">满版插画 / 产品图</span>
            <span v-if="card.front.showBrand" class="front-chip">🦆 Lucky Ducky · 幸运小鸭</span>
          </div>
          <p class="side-label">正面 · 插画面</p>
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
          <p class="side-label">反面 · 二维码面</p>
        </div>
        <p class="stage-note">
          {{ card.sizeMM.w }} × {{ card.sizeMM.h }} mm ·
          <b :class="card.status === 'final' ? 'ok' : ''">{{ card.status === 'final' ? '已定稿' : '草稿' }}</b>
        </p>
      </div>

      <!-- 属性面板 -->
      <div class="panel">
        <div class="sec">
          <div class="sec-t">卡片尺寸（mm，双面同尺寸）</div>
          <div class="presets">
            <button v-for="p in PRESETS" :key="p.label" class="preset" :class="{ on: isPreset(p) }" @click="usePreset(p)">
              {{ p.label }}
            </button>
          </div>
          <div class="dims">
            <label>宽 <input v-model.number="card.sizeMM.w" type="number" min="40" max="300" class="input num" /></label>
            <span>×</span>
            <label>高 <input v-model.number="card.sizeMM.h" type="number" min="40" max="300" class="input num" /></label>
          </div>
        </div>

        <div class="sec group">
          <div class="sec-t">正面 · 插画面</div>
          <div class="artrow">
            <div class="artthumb" :style="{ background: card.front.bg }">
              <img v-if="artUrl" :src="artUrl" alt="" />
            </div>
            <div class="artbtns">
              <button class="btn ghost sm" @click="useCover">取商品封面图</button>
              <label class="btn ghost sm">
                <input type="file" accept="image/*" hidden @change="pickArt" />{{ busyArt ? '上传中…' : '上传插画' }}
              </label>
            </div>
          </div>
          <label class="check"><input v-model="card.front.showBrand" type="checkbox" /> 左下角品牌角标</label>
          <div class="swatchline">
            <span class="swlabel">衬底色（图未满版时露出）</span>
            <button v-for="c in SWATCHES" :key="'f' + c" class="swatch" :class="{ on: card.front.bg === c }" :style="{ background: c }" @click="card.front.bg = c"></button>
          </div>
        </div>

        <div class="sec group">
          <div class="sec-t">反面 · 二维码面</div>
          <label class="field-label">主标题</label>
          <input v-model="card.back.texts.title" class="input" maxlength="40" />
          <label class="field-label" style="margin-top: 8px">副文案</label>
          <input v-model="card.back.texts.sub" class="input" maxlength="60" />
          <label class="field-label" style="margin-top: 8px">扫码引导</label>
          <input v-model="card.back.texts.scanHint" class="input" maxlength="30" />
          <label class="field-label" style="margin-top: 8px">退货提醒（小字）</label>
          <input v-model="card.back.texts.warning" class="input" maxlength="50" />
          <label class="field-label" style="margin-top: 8px">底部品牌条文字</label>
          <input v-model="card.back.brandText" class="input" maxlength="30" />
          <div class="swatchline" style="margin-top: 10px">
            <span class="swlabel">底色</span>
            <button v-for="c in SWATCHES" :key="'b' + c" class="swatch" :class="{ on: card.back.bg === c }" :style="{ background: c }" @click="card.back.bg = c"></button>
          </div>
        </div>

        <p class="hint">二维码区按激活码自动生成，无需设计；定稿后第 6 步生成批次——印刷包含 正面.svg + 反面.svg + 地址清单。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.headrow {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.headrow > div:first-child {
  flex: 1;
}
h2 {
  font-size: 16.5px;
  color: var(--ink);
  margin: 0 0 4px;
}
.desc {
  font-size: 12px;
  color: var(--content-2);
  margin: 0 0 16px;
}
.save {
  font-size: 12px;
  color: var(--content-2);
  align-self: center;
}
.save.error {
  color: var(--red);
}
.btn.sm {
  padding: 7px 13px;
  font-size: 12px;
}
.work {
  display: flex;
  gap: 26px;
  align-items: flex-start;
}
.stage {
  flex: 0 0 380px;
  background: var(--bg-grey);
  border-radius: 14px;
  padding: 26px 28px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}
.side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.side-label {
  font-size: 11.5px;
  color: var(--content-2);
  margin: 0;
}
.stage-note {
  width: 100%;
  text-align: center;
  font-size: 11.5px;
  color: var(--content-2);
  margin: 0;
}
.stage-note .ok {
  color: var(--green);
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
  color: var(--content-2);
}
.front-chip {
  position: absolute;
  left: 6%;
  bottom: 6%;
  background: rgba(36, 23, 51, 0.92);
  color: var(--white);
  font-size: 9px;
  font-weight: 600;
  border-radius: 99px;
  padding: 3.5px 10px;
}
.b-t1 {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin-top: 7%;
  padding: 0 10px;
  text-align: center;
}
.b-t2 {
  font-size: 9px;
  color: var(--content-2);
  margin-top: 2px;
}
.b-qr {
  width: 34%;
  aspect-ratio: 1;
  border: 1px dashed var(--line-strong);
  border-radius: 6px;
  margin-top: 4%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 8.5px;
  color: var(--content-2);
  line-height: 1.5;
}
.b-t3 {
  font-size: 9px;
  font-weight: 600;
  color: var(--content);
  margin-top: 3%;
}
.b-flex {
  flex: 1;
}
.b-warn {
  font-size: 7px;
  color: #9a9aa2;
  padding: 0 8px 4px;
  text-align: center;
}
.b-bar {
  margin-top: auto;
  width: 100%;
  background: var(--purple-ink);
  color: var(--white);
  font-size: 8.5px;
  font-weight: 600;
  text-align: center;
  padding: 4.5% 0;
}
.panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 430px;
}
.sec.group {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px;
}
.sec-t {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 10px;
}
.presets {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.preset {
  border: 1px solid var(--line-strong);
  background: var(--white);
  border-radius: 99px;
  padding: 6px 12px;
  font-size: 11.5px;
  cursor: pointer;
}
.preset.on {
  border-color: var(--brand);
  background: var(--bg-lilac);
  color: var(--brand-active);
  font-weight: 600;
}
.dims {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12px;
  color: var(--content-2);
}
.dims label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.input.num {
  width: 80px;
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
  border: 1px solid var(--line);
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
  color: var(--content);
  margin-bottom: 10px;
}
.swatchline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.swlabel {
  font-size: 11px;
  color: var(--content-2);
  margin-right: 2px;
}
.swatch {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--line);
  cursor: pointer;
}
.swatch.on {
  border: 2.5px solid var(--brand);
}
.steps3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  margin: 0;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
</style>
