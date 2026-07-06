<script setup lang="ts">
// 小程序橱窗（换皮回归还原批·1:1 承接旧线 Showcase 手感）：左 iPhone WYSIWYG 实时预览（同一份云端数据
// 渲染小程序首页人气条），右排序/推荐面板。两边同一份列表状态，拖哪边都行，松手防抖自动保存、离页补存。
// 停售/恢复已迁至 Products（在售态这里只读显示）；hero/背景/信任条/FAQ 已迁至 HomeContent。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { listShowcase, saveShowcase } from '../api/products'
import { mapShowcaseRows, type ShowcaseRowVM } from '../lib/mapProducts'
import { serialSave } from '../lib/serialSave'
import { Store, GripVertical } from 'lucide-vue-next'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const rows = ref<ShowcaseRowVM[]>([])
const message = ref('')
const saveState = ref<'' | 'saving' | 'saved' | 'error'>('')

const featured = computed(() => rows.value.filter((r) => r.featured))

async function reload() {
  message.value = '加载中…'
  const r = await listShowcase()
  rows.value = r.ok ? mapShowcaseRows(r.list, r.urls) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

// 防抖自动保存（700ms·换皮退成手动按钮·忘点即丢编辑）：拖动/开关都走它
let timer: ReturnType<typeof setTimeout> | null = null
// 串行化实际保存（防慢网下多次拖拽/开关的保存乱序覆盖·P2·根因#8）：run 现读 rows·补存即最新排序
const flushSave = serialSave(async () => {
  const r = await saveShowcase(rows.value.map((x, i) => ({ id: x.id, sort: i + 1, featured: x.featured })))
  saveState.value = r.ok ? 'saved' : 'error'
})
function persist() {
  saveState.value = 'saving'
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null // 触发后清空·让 timer 真实反映「有未落盘的待发编辑」（供 onBeforeUnmount 判据）
    void flushSave()
  }, 700)
}
function toggle(r: ShowcaseRowVM) {
  r.featured = !r.featured
  persist()
}

// 拖拽排序（手机人气条与面板共用同一份 rows·拖哪边都行）——HTML5 DnD
const drag = ref(-1)
const over = ref(-1)
const idxOf = (r: ShowcaseRowVM) => rows.value.indexOf(r)
function dragStart(r: ShowcaseRowVM) {
  drag.value = idxOf(r)
}
function dragOver(r: ShowcaseRowVM, e: DragEvent) {
  e.preventDefault()
  if (drag.value >= 0) over.value = idxOf(r)
}
function dragEnd() {
  drag.value = -1
  over.value = -1
}
function drop(r: ShowcaseRowVM) {
  const from = drag.value
  const to = idxOf(r)
  dragEnd()
  if (from < 0 || to < 0 || from === to) return
  const moved = rows.value.splice(from, 1)[0]
  rows.value.splice(to, 0, moved)
  persist()
}
const isOver = (r: ShowcaseRowVM) => over.value === idxOf(r) && drag.value >= 0 && drag.value !== idxOf(r)
const isDrag = (r: ShowcaseRowVM) => drag.value === idxOf(r)

// 离页补存：还在防抖窗口内未落盘的改动立即补发（保存幂等·多发无副作用）。
// 判据用 pending timer 而非 saveState==='saving'：先发的自动保存完成会把 saveState 复位成 'saved'，
// 而后一次编辑只活在待触发的 timer 里——按 saveState 判会漏补、离页丢这次编辑（P2·同 HomeContent 的 if(saveTimer)）
onBeforeUnmount(() => {
  if (timer) {
    clearTimeout(timer)
    timer = null
    void flushSave()
  }
})

onMounted(reload)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="小程序橱窗" sub="左侧一比一预览小程序首页 · 在画面或右侧列表上拖动排序、点开关上下架橱窗 · 改动自动保存，小程序重开生效">
      <Badge v-if="saveState" :tone="saveState === 'saved' ? 'green' : saveState === 'error' ? 'red' : 'neutral'" dot>
        {{ saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : '保存失败' }}
      </Badge>
    </PageHeader>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <Card v-if="rows.length">
      <div class="work">
        <!-- iPhone WYSIWYG 预览（393×852 比例·同一份云端数据） -->
        <div class="stage">
          <div class="phone">
            <div class="p-status"><span>12:30</span><span>●●●</span></div>
            <div class="p-hero"><div class="p-brand">🦆 Lucky Ducky</div><div class="p-title">创造幸运</div><div class="p-sub">Get ducky get lucky</div></div>
            <div class="p-strip">
              <div class="p-strip-head"><b>人气商品</b><span>全部 ›</span></div>
              <div class="p-cards">
                <div
                  v-for="r in featured"
                  :key="r.id"
                  class="p-card"
                  :class="{ over: isOver(r), dragging: isDrag(r) }"
                  draggable="true"
                  @dragstart="dragStart(r)"
                  @dragover="dragOver(r, $event)"
                  @dragend="dragEnd"
                  @drop="drop(r)"
                >
                  <div class="p-img"><img v-if="r.coverUrl" :src="r.coverUrl" alt="" /><span v-else class="p-img-ph">📦</span></div>
                  <div class="p-body"><div class="p-name">{{ r.name }}</div><div class="p-tag">{{ r.tag }}</div><div class="p-price">￥{{ r.price }}</div></div>
                </div>
                <p v-if="!featured.length" class="p-empty">橱窗空了——右侧打开几个商品的开关</p>
              </div>
            </div>
            <div class="p-spacer"></div>
            <div class="p-tabbar"><b>● 首页</b><span>购物车</span><span>我</span></div>
          </div>
          <p class="stage-note">iPhone 比例（393×852）· 与小程序首页同一份数据</p>
        </div>

        <!-- 排序与推荐面板 -->
        <div class="panel">
          <h3>首页 · 人气商品（拖动排序 · 开关上下架橱窗）</h3>
          <div
            v-for="r in rows"
            :key="r.id"
            class="row"
            :class="{ over: isOver(r), dragging: isDrag(r), off: !r.featured }"
            draggable="true"
            @dragstart="dragStart(r)"
            @dragover="dragOver(r, $event)"
            @dragend="dragEnd"
            @drop="drop(r)"
          >
            <GripVertical class="grip" :size="16" :stroke-width="2" />
            <div class="thumb"><img v-if="r.coverUrl" :src="r.coverUrl" alt="" /><span v-else>📦</span></div>
            <div class="info">
              <div class="name">{{ r.name }}<span v-if="!r.listed" class="off-tag">已下架</span></div>
              <div class="meta">￥{{ r.price }} · 排序 {{ idxOf(r) + 1 }}{{ r.featured ? '' : ' · 不在首页橱窗' }}</div>
            </div>
            <button class="switch" :class="{ on: r.featured }" :title="r.featured ? '点击下架橱窗' : '点击上架橱窗'" @click="toggle(r)"><span class="knob"></span></button>
          </div>
          <p class="hint">开关 = 是否出现在首页橱窗；拖哪边都行、两侧画面双向联动。停售/恢复销售在「商品管理」页。</p>
        </div>
      </div>
    </Card>
    <EmptyState v-else-if="!message" :icon="Store" text="还没有可排序的商品" />
  </div>
</template>

<style scoped>
/* 两栏工作区：左 iPhone 预览定宽 · 右排序面板自适应（窄屏堆叠）。 */
.work {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 22px;
  align-items: start;
}
@media (max-width: 920px) {
  .work {
    grid-template-columns: 1fr;
  }
}
.stage {
  background: var(--ld-bg-grey);
  border-radius: var(--ld-radius);
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.phone {
  width: 300px;
  aspect-ratio: 393 / 852;
  border: 6px solid var(--ld-purple-ink);
  border-radius: 34px;
  background: var(--ld-bg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.stage-note {
  font-size: 11px;
  color: var(--ld-content-2);
  margin: 0;
}
.p-status {
  display: flex;
  justify-content: space-between;
  padding: 8px 18px 4px;
  font-size: 10px;
  color: var(--ld-ink);
}
.p-hero {
  background: var(--ld-bg-sage);
  padding: 18px 18px 16px;
}
.p-brand {
  font-size: 11px;
  font-weight: 700;
}
.p-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--ld-ink);
  margin: 4px 0 2px;
}
.p-sub {
  font-size: 10.5px;
  color: var(--ld-content-2);
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
  color: var(--ld-content-2);
  font-size: 10.5px;
}
.p-cards {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.p-card {
  flex: 0 0 116px;
  border: 1px solid var(--ld-line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--ld-bg);
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
  background: var(--ld-brand);
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
  border-color: var(--ld-brand);
}
.p-img {
  height: 88px;
  background: var(--ld-bg-sage);
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
  font-size: 26px;
}
.p-body {
  padding: 8px 9px 9px;
}
.p-name {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--ld-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-tag {
  font-size: 8px;
  color: var(--ld-purple-meta);
  margin: 2px 0;
}
.p-price {
  font-size: 11px;
  font-weight: 700;
}
.p-empty {
  font-size: 11px;
  color: var(--ld-content-2);
  padding: 20px 10px;
}
.p-spacer {
  flex: 1;
}
.p-tabbar {
  display: flex;
  justify-content: space-around;
  border-top: 1px solid var(--ld-line);
  padding: 10px 20px 14px;
  font-size: 9.5px;
  color: var(--ld-content-2);
}
.p-tabbar b {
  color: var(--ld-brand-active);
}
.panel {
  min-width: 0;
}
.panel h3 {
  font-size: 13.5px;
  color: var(--ld-ink);
  margin: 0 0 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  padding: 9px 12px;
  margin-bottom: 8px;
  cursor: grab;
  position: relative;
  background: var(--ld-bg);
}
.row.off {
  background: var(--ld-bg-grey);
  opacity: 0.75;
}
.grip {
  color: var(--ld-line-strong);
  flex: 0 0 auto;
  cursor: grab;
}
.thumb {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: var(--ld-bg-sage);
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
  color: var(--ld-ink);
}
.off-tag {
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--ld-red);
  background: var(--ld-bg-red-soft);
  border-radius: 6px;
}
.meta {
  font-size: 10.5px;
  color: var(--ld-content-2);
  margin-top: 2px;
}
.switch {
  width: 36px;
  height: 20px;
  border-radius: 99px;
  border: none;
  background: var(--ld-line-strong);
  position: relative;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 0.15s;
}
.switch.on {
  background: var(--ld-brand);
}
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--ld-bg);
  transition: left 0.15s;
}
.switch.on .knob {
  left: 18px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--ld-bg-lilac);
  font-size: 11.5px;
  margin: 8px 0 0;
  color: var(--ld-content-2);
}
</style>
