<script setup>
/**
 * 小程序橱窗（规格 §八，设计稿 S10）：一比一所见即所得管理。
 * 左：iPhone 17 比例（393×852）手机框，渲染小程序首页关键区块（同一份云端 products 数据）；
 * 右：排序 / 上下架面板。两边同一份列表状态，拖哪边都行，松手防抖保存，小程序重开生效。
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import {
  cloudMode,
  listShowcase,
  saveShowcase,
  unpublishProduct,
  republishProduct,
  getHomeContent,
  saveHomeContent,
  uploadImage,
} from '@/api/cloud.js'

const list = ref([])
const urls = ref({})
const loading = ref(true)
const loadErr = ref('')
const saveState = ref('')

// 首页内容（hero 文案/信任条/FAQ）：与小程序同一份，默认值与小程序本地兜底一致
const DEFAULT_HOME = {
  hero: { title: '创造幸运', tagline: 'Get ducky get lucky' },
  activationBg: '', // 激活页（welcome）全局兜底背景图 fileID；空＝小程序回退 /static/hero-full.jpg
  loadingBg: '', // 全局·正在激活(loading)图 fileID；loading 时拿不到 courseId 故全局；空＝回退 activationBg
  activationBgByCourse: {}, // 按课程·按状态欢迎图（上新向导 StepImages 管）——橱窗不编辑、仅透传保全（防整存抹掉）
  trust: [
    { icon: 'truck', label: '包邮到家' },
    { icon: 'rotate-ccw', label: '七天无理由退货' },
    { icon: 'thumbs-up', label: '多数买家推荐' },
  ],
  faq: [
    { title: '完全没有基础可以做吗？', body: '可以。套装专为零基础设计，附带分步视频，跟着做就能完成第一只小棉鸭。' },
    { title: '材料包里都有什么？', body: '棉线、钩针、填充棉、安全眼、说明卡与幸运卡一应俱全，开盒即可开始。' },
    { title: '做坏了可以补料吗？', body: '可以。线材用尽或钩错都能在社群申请补料，七天内不满意还可无理由退货。' },
  ],
}
const home = ref(JSON.parse(JSON.stringify(DEFAULT_HOME)))
let homeLoaded = false

const featured = computed(() => list.value.filter((p) => p.featured))
const imgOf = (p) => (p.cover ? urls.value[p.cover] || '' : '')

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  try {
    const [r, hc] = await Promise.all([listShowcase(), getHomeContent()])
    list.value = r.list
    urls.value = r.urls
    if (hc) {
      home.value = {
        hero: { ...DEFAULT_HOME.hero, ...hc.hero },
        activationBg: hc.activationBg || '',
        loadingBg: hc.loadingBg || '',
        // 按课程欢迎图：橱窗不编辑，但保存时整存——必须透传保全，否则会把 StepImages 配的按课程图整存抹掉
        activationBgByCourse: hc.activationBgByCourse || {},
        trust: hc.trust?.length ? hc.trust : home.value.trust,
        faq: hc.faq?.length ? hc.faq : home.value.faq,
      }
    }
    homeLoaded = true
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

let timer = null
function persist() {
  saveState.value = 'saving'
  clearTimeout(timer)
  timer = setTimeout(async () => {
    const items = list.value.map((p, i) => ({ id: p.id, sort: i + 1, featured: !!p.featured }))
    const ok = await saveShowcase(items)
    saveState.value = ok ? 'saved' : 'error'
  }, 700)
}

function toggle(p) {
  p.featured = !p.featured
  persist()
}

// 停售/恢复销售（债#12）：独立于橱窗开关——停售即从顾客端商品列表移除（getProducts 不再下发），可恢复。
async function toggleListed(p) {
  try {
    if (p.listed === false) {
      await republishProduct(p.id)
      p.listed = true
    } else {
      if (!confirm(`确定停售「${p.name}」？\n停售后顾客端商品列表不再显示（详情直达与历史订单不受影响），可随时恢复。`)) return
      await unpublishProduct(p.id)
      p.listed = false
    }
  } catch (e) {
    alert(e.message || '操作失败')
  }
}

// 拖拽（手机画面与面板共用同一份 list；手机画面只显示 featured 子集，拖动按全列表索引换位）
const drag = ref(-1)
const over = ref(-1)
function idxOf(p) {
  return list.value.indexOf(p)
}
function dragStart(p) {
  drag.value = idxOf(p)
}
function dragOver(p, e) {
  e.preventDefault()
  if (drag.value >= 0) over.value = idxOf(p)
}
function dragEnd() {
  drag.value = -1
  over.value = -1
}
function drop(p) {
  const from = drag.value
  const to = idxOf(p)
  dragEnd()
  if (from < 0 || to < 0 || from === to) return
  const [moved] = list.value.splice(from, 1)
  list.value.splice(to, 0, moved)
  persist()
}
const isOver = (p) => over.value === idxOf(p) && drag.value >= 0 && drag.value !== idxOf(p)
const isDrag = (p) => drag.value === idxOf(p)

// 首页内容：防抖保存（与排序同一个保存状态提示）
let homeTimer = null
watch(
  home,
  () => {
    if (!homeLoaded) return
    saveState.value = 'saving'
    clearTimeout(homeTimer)
    homeTimer = setTimeout(async () => {
      const ok = await saveHomeContent(JSON.parse(JSON.stringify(home.value)))
      saveState.value = ok ? 'saved' : 'error'
    }, 700)
  },
  { deep: true },
)
// 离开页面：把还在防抖窗口内、尚未落盘的排序/上下架与首页内容立即补存（防丢编辑）。
// 两个保存共用 saveState，pending 时两份都补发一次（保存幂等，多发无副作用）。
onBeforeUnmount(() => {
  clearTimeout(timer)
  clearTimeout(homeTimer)
  if (cloudMode && saveState.value === 'saving') {
    const items = list.value.map((p, i) => ({ id: p.id, sort: i + 1, featured: !!p.featured }))
    if (items.length) saveShowcase(items)
    if (homeLoaded) saveHomeContent(JSON.parse(JSON.stringify(home.value)))
  }
})

// 激活页背景图上传：传云存储 → fileID 入 home.activationBg（watch 自动保存）。
// 预览 url 仅本会话（上传即得）；重载只显「已设置 ✓」（fileID 解析 url 需额外云端、不值当）。
const bgUploading = ref(false)
const bgPreview = ref('') // 本次上传得到的展示 url（重载不保留）
const bgErr = ref('')
async function uploadBg(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // 允许重复选同一文件
  if (!file) return
  bgErr.value = ''
  bgUploading.value = true
  try {
    const { ref: fileID, url } = await uploadImage(file, 'showcase')
    home.value.activationBg = fileID // 触发 watch 防抖保存
    bgPreview.value = url
  } catch (err) {
    bgErr.value = '上传失败：' + (err?.message || err)
  } finally {
    bgUploading.value = false
  }
}
function clearBg() {
  home.value.activationBg = ''
  bgPreview.value = ''
}

// 正在激活(loading)全局图：loading 时拿不到 courseId 故全局（不按课程）。同 activationBg 一套：传图 → fileID 入 home.loadingBg。
const loadingUploading = ref(false)
const loadingPreview = ref('')
const loadingErr = ref('')
async function uploadLoadingBg(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  loadingErr.value = ''
  loadingUploading.value = true
  try {
    const { ref: fileID, url } = await uploadImage(file, 'showcase')
    home.value.loadingBg = fileID // 触发 watch 防抖保存
    loadingPreview.value = url
  } catch (err) {
    loadingErr.value = '上传失败：' + (err?.message || err)
  } finally {
    loadingUploading.value = false
  }
}
function clearLoadingBg() {
  home.value.loadingBg = ''
  loadingPreview.value = ''
}

function addFaq() {
  if (home.value.faq.length >= 8) return
  home.value.faq.push({ title: '', body: '' })
}
function delFaq(i) {
  home.value.faq.splice(i, 1)
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>小程序橱窗</h1>
        <p class="sub">一比一预览小程序首页 · 在画面或右侧列表上拖动排序、开关上下架 · 改动自动保存，小程序重开生效</p>
      </div>
      <span class="save" :class="saveState">
        {{ { saving: '保存中…', saved: '已保存 ✓', error: '保存失败' }[saveState] || '' }}
      </span>
    </header>

    <p v-if="!cloudMode" class="hint warn">橱窗管理需云端模式（配置 admin/.env.local）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <div v-else class="work">
      <!-- 手机框：iPhone 17 比例 393:852 -->
      <div class="stage">
        <div class="phone">
          <div class="p-status"><span>12:30</span><span>●●●</span></div>
          <div class="p-hero">
            <div class="p-brand">🦆 Lucky Ducky</div>
            <div class="p-title">{{ home.hero.title }}</div>
            <div class="p-sub">{{ home.hero.tagline }}</div>
          </div>
          <div class="p-strip">
            <div class="p-strip-head"><b>人气商品</b><span>全部 ›</span></div>
            <div class="p-cards">
              <div
                v-for="p in featured"
                :key="p.id"
                class="p-card"
                :class="{ over: isOver(p), dragging: isDrag(p) }"
                draggable="true"
                @dragstart="dragStart(p)"
                @dragover="dragOver(p, $event)"
                @dragend="dragEnd"
                @drop="drop(p)"
              >
                <div class="p-img">
                  <img v-if="imgOf(p)" :src="imgOf(p)" alt="" />
                  <span v-else class="p-img-ph">📦</span>
                </div>
                <div class="p-body">
                  <div class="p-name">{{ p.name }}</div>
                  <div class="p-tag">{{ p.tag }}</div>
                  <div class="p-price">￥{{ p.price }}</div>
                </div>
              </div>
              <p v-if="!featured.length" class="p-empty">橱窗空了——右侧打开几个商品的开关</p>
            </div>
          </div>
          <div class="p-spacer"></div>
          <div class="p-tabbar"><b>● 首页</b><span>购物车</span><span>我</span></div>
        </div>
        <p class="stage-note">iPhone 17 比例（393×852）· 与小程序首页同一份数据</p>
      </div>

      <!-- 排序与上下架面板 -->
      <div class="panel card">
        <h3>首页 · 人气商品（排序与上下架）</h3>
        <div
          v-for="p in list"
          :key="p.id"
          class="row"
          :class="{ over: isOver(p), dragging: isDrag(p), off: !p.featured }"
          draggable="true"
          @dragstart="dragStart(p)"
          @dragover="dragOver(p, $event)"
          @dragend="dragEnd"
          @drop="drop(p)"
        >
          <span class="grip">⠿</span>
          <div class="thumb">
            <img v-if="imgOf(p)" :src="imgOf(p)" alt="" />
            <span v-else>📦</span>
          </div>
          <div class="info">
            <div class="name">{{ p.name }}<span v-if="p.listed === false" class="off-tag">已停售</span></div>
            <div class="meta">￥{{ p.price }} · 排序 {{ idxOf(p) + 1 }}{{ p.featured ? '' : ' · 不在首页橱窗' }}</div>
          </div>
          <button
            class="btn ghost sm"
            :title="p.listed === false ? '恢复销售：顾客端列表重新出现' : '停售：从顾客端列表移除（详情直达/历史订单不受影响）'"
            @click="toggleListed(p)"
          >
            {{ p.listed === false ? '恢复销售' : '停售' }}
          </button>
          <button class="switch" :class="{ on: p.featured }" :title="p.featured ? '点击下架橱窗' : '点击上架橱窗'" @click="toggle(p)">
            <span class="knob"></span>
          </button>
        </div>
        <p class="hint">「停售」= 从顾客端商品列表移除（可恢复·详情直达与历史订单不受影响）；开关 = 是否出现在首页橱窗。两侧画面双向联动，拖哪边都行。</p>

        <h3 style="margin-top: 22px">首页 · 头图文案（左侧手机实时预览）</h3>
        <label class="field-label">主标题</label>
        <input v-model="home.hero.title" class="input" maxlength="20" />
        <label class="field-label" style="margin-top: 8px">口号（副标题）</label>
        <input v-model="home.hero.tagline" class="input" maxlength="40" />

        <h3 style="margin-top: 22px">激活页 · 背景图（扫码激活页全屏底图）</h3>
        <div class="bgrow">
          <div class="bgthumb">
            <img v-if="bgPreview" :src="bgPreview" alt="" />
            <span v-else-if="home.activationBg" class="bgset">已设置 ✓</span>
            <span v-else class="bgph">默认底图</span>
          </div>
          <div class="bgctl">
            <label class="btn ghost sm bgbtn" :class="{ disabled: bgUploading }">
              {{ bgUploading ? '上传中…' : '上传背景图' }}
              <input type="file" accept="image/*" :disabled="bgUploading" hidden @change="uploadBg" />
            </label>
            <button v-if="home.activationBg" class="del" @click="clearBg">恢复默认</button>
          </div>
        </div>
        <p v-if="bgErr" class="hint warn">{{ bgErr }}</p>
        <p class="hint">扫码激活页（welcome）的全屏兜底背景图（无码引导/激活失败用）；不设＝用内置默认图。建议竖图（约 1080×1920）。改动自动保存，小程序重开生效。</p>

        <h3 style="margin-top: 22px">激活页 · 正在激活图（全局）</h3>
        <div class="bgrow">
          <div class="bgthumb">
            <img v-if="loadingPreview" :src="loadingPreview" alt="" />
            <span v-else-if="home.loadingBg" class="bgset">已设置 ✓</span>
            <span v-else class="bgph">默认底图</span>
          </div>
          <div class="bgctl">
            <label class="btn ghost sm bgbtn" :class="{ disabled: loadingUploading }">
              {{ loadingUploading ? '上传中…' : '上传背景图' }}
              <input type="file" accept="image/*" :disabled="loadingUploading" hidden @change="uploadLoadingBg" />
            </label>
            <button v-if="home.loadingBg" class="del" @click="clearLoadingBg">恢复默认</button>
          </div>
        </div>
        <p v-if="loadingErr" class="hint warn">{{ loadingErr }}</p>
        <p class="hint">「正在激活…」加载屏的全屏图。此刻还没识别出是哪门课，所以是全局图（不按课程）；不设＝回退上面的兜底背景图。</p>

        <h3 style="margin-top: 22px">首页 · 信任条（3 项短语）</h3>
        <div class="trustrow">
          <input v-for="(t, i) in home.trust" :key="i" v-model="t.label" class="input" maxlength="12" />
        </div>

        <h3 style="margin-top: 22px">首页 · 大家都在问（FAQ）</h3>
        <div v-for="(f, i) in home.faq" :key="i" class="faqrow">
          <div class="faqhead">
            <input v-model="f.title" class="input" maxlength="40" placeholder="问题" />
            <button class="del" @click="delFaq(i)">删除</button>
          </div>
          <textarea v-model="f.body" class="input area" maxlength="150" placeholder="回答"></textarea>
        </div>
        <button class="btn ghost sm" :disabled="home.faq.length >= 8" @click="addFaq">＋ 添加一条（最多 8 条）</button>
        <p class="hint" style="margin-top: 14px">文案改动自动保存；小程序重开生效。改坏了清空该块即可回到默认文案。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
h1 {
  font-size: 22px;
  color: var(--ink);
  margin: 0 0 5px;
}
.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--content-2);
}
.save {
  font-size: 12px;
  color: var(--content-2);
}
.save.error {
  color: var(--red);
}
.work {
  display: flex;
  gap: 22px;
  align-items: flex-start;
}
.stage {
  flex: 0 0 460px;
  background: var(--bg-grey);
  border-radius: 14px;
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.phone {
  width: 330px;
  aspect-ratio: 393 / 852; /* iPhone 17 逻辑分辨率比例 */
  border: 6px solid var(--purple-ink);
  border-radius: 34px;
  background: var(--white);
  box-shadow: 0 16px 36px rgba(36, 23, 51, 0.19);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.stage-note {
  font-size: 11px;
  color: var(--content-2);
  margin: 0;
}
.p-status {
  display: flex;
  justify-content: space-between;
  padding: 8px 18px 4px;
  font-size: 10px;
  color: var(--ink);
}
.p-hero {
  background: var(--bg-sage);
  padding: 18px 18px 16px;
}
.p-brand {
  font-size: 11px;
  font-weight: 700;
}
.p-title {
  font-size: 24px;
  font-weight: 700;
  color: #000;
  margin: 4px 0 2px;
}
.p-sub {
  font-size: 10.5px;
  color: var(--content-2);
}
.p-strip {
  padding: 14px;
}
.p-strip-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 10px;
}
.p-strip-head span {
  color: var(--content-2);
  font-size: 10.5px;
}
.p-cards {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.p-card {
  flex: 0 0 122px;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--white);
  cursor: grab;
  position: relative;
}
.p-card.over::before,
.row.over::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 99px;
  background: var(--brand);
}
.row.over::before {
  left: 0;
  top: -5px;
  bottom: auto;
  width: auto;
  right: 0;
  height: 3px;
}
.p-card.dragging,
.row.dragging {
  opacity: 0.45;
  border-color: var(--brand);
}
.p-img {
  height: 92px;
  background: var(--bg-sage);
  display: flex;
  align-items: center;
  justify-content: center;
}
.p-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.p-img-ph {
  font-size: 28px;
}
.p-body {
  padding: 8px 9px 9px;
}
.p-name {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-tag {
  font-size: 8px;
  color: var(--purple-meta);
  margin: 2px 0;
}
.p-price {
  font-size: 11px;
  font-weight: 700;
}
.p-empty {
  font-size: 11px;
  color: var(--content-2);
  padding: 20px 10px;
}
.p-spacer {
  flex: 1;
}
.p-tabbar {
  display: flex;
  justify-content: space-around;
  border-top: 1px solid var(--line);
  padding: 10px 20px 14px;
  font-size: 9.5px;
  color: var(--content-2);
}
.p-tabbar b {
  color: var(--brand-active);
}
.panel {
  flex: 1;
  min-width: 0;
  padding: 20px;
}
.panel h3 {
  font-size: 13.5px;
  color: var(--ink);
  margin: 0 0 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 12px;
  margin-bottom: 8px;
  cursor: grab;
  position: relative;
  background: var(--white);
}
.row.off {
  background: var(--bg-grey);
  opacity: 0.75;
}
.grip {
  color: var(--line-strong);
}
.thumb {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: var(--bg-sage);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.info {
  flex: 1;
  min-width: 0;
}
.name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}
.off-tag {
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: #b42318;
  background: #fee4e2;
  border-radius: 6px;
}
.meta {
  font-size: 10.5px;
  color: var(--content-2);
  margin-top: 2px;
}
.switch {
  width: 36px;
  height: 20px;
  border-radius: 99px;
  border: none;
  background: var(--line-strong);
  position: relative;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 0.15s;
}
.switch.on {
  background: var(--brand);
}
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--white);
  transition: left 0.15s;
}
.switch.on .knob {
  left: 18px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  margin: 8px 0 0;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
.trustrow {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.faqrow {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.faqhead {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.del {
  border: none;
  background: none;
  color: var(--content-2);
  font-size: 11.5px;
  cursor: pointer;
  flex: 0 0 auto;
}
.del:hover {
  color: var(--red);
}
.area {
  min-height: 54px;
  resize: vertical;
}
.btn.sm {
  padding: 7px 13px;
  font-size: 12px;
}
.bgrow {
  display: flex;
  align-items: center;
  gap: 14px;
}
.bgthumb {
  width: 56px;
  height: 84px;
  border-radius: 8px;
  background: var(--bg-sage);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid var(--line);
}
.bgthumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.bgset {
  font-size: 11px;
  color: var(--green);
  font-weight: 600;
  text-align: center;
}
.bgph {
  font-size: 10.5px;
  color: var(--content-2);
  text-align: center;
}
.bgctl {
  display: flex;
  align-items: center;
  gap: 12px;
}
.bgbtn {
  cursor: pointer;
}
.bgbtn.disabled {
  opacity: 0.6;
  pointer-events: none;
}
</style>
