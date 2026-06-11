<script setup>
/**
 * 小程序橱窗（规格 §八，设计稿 S10）：一比一所见即所得管理。
 * 左：iPhone 17 比例（393×852）手机框，渲染小程序首页关键区块（同一份云端 products 数据）；
 * 右：排序 / 上下架面板。两边同一份列表状态，拖哪边都行，松手防抖保存，小程序重开生效。
 */
import { ref, computed } from 'vue'
import { cloudMode, listShowcase, saveShowcase } from '@/api/cloud.js'

const list = ref([])
const urls = ref({})
const loading = ref(true)
const loadErr = ref('')
const saveState = ref('')

const featured = computed(() => list.value.filter((p) => p.featured))
const imgOf = (p) => (p.cover ? urls.value[p.cover] || '' : '')

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  try {
    const r = await listShowcase()
    list.value = r.list
    urls.value = r.urls
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
            <div class="p-title">创造幸运</div>
            <div class="p-sub">Get ducky get lucky</div>
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
            <div class="name">{{ p.name }}</div>
            <div class="meta">￥{{ p.price }} · 排序 {{ idxOf(p) + 1 }}{{ p.featured ? '' : ' · 不在首页橱窗' }}</div>
          </div>
          <button class="switch" :class="{ on: p.featured }" :title="p.featured ? '点击下架橱窗' : '点击上架橱窗'" @click="toggle(p)">
            <span class="knob"></span>
          </button>
        </div>
        <p class="hint">开关 = 是否出现在首页橱窗；下架橱窗不影响详情页直达与历史订单。两侧画面双向联动，拖哪边都行。</p>
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
</style>
