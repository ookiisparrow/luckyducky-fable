<script setup>
/**
 * 视频教程 · 播放页（最小可用版 / 研究性切片）。
 * 证明最难也最值钱的几件事（都是钩织学习的"承重"交互）：
 *  - 真实 <video> 铺满屏幕 + 自绘控件（非原生全屏，保住小程序「同层渲染」）
 *  - 分段进度（按知识点切成 N 段）
 *  - 段末自动暂停：一段播完自动停 → 手忙时不用碰屏（钩织双手被占）
 *  - 单段循环 + 0.5x 慢放：反复看清"某一针"
 *
 * 跨端说明见 CLAUDE.md / 本轮研究结论：
 *  - 视频用 controls=false 自绘；非全屏铺满，靠同层渲染让下面的 <view> 叠在视频上。
 *  - 进度/分段/暂停全靠 timeupdate(250ms) + VideoContext(seek/play/pause/playbackRate)。
 *  - 当前 src 是占位示例视频，将来用 MediaSlot/真实拍摄替换；小程序需在后台配置合法域名
 *    或在开发者工具勾「不校验合法域名」。
 */
import { ref, computed, onMounted, getCurrentInstance } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { goBack } from '@/utils/nav.js'

// —— 占位视频（替换为真实钩织拍摄）——
const SRC = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
// 知识点分段（决定分几段、每段叫什么）
const KP = ['先看成品', '这是什么', '材料工具', '关键针法慢动作', '收尾自检']

const instance = getCurrentInstance()
let ctx = null // VideoContext（非响应式）

// 课名 / 章节（从课程目录跳进来时由 query 传入，带默认值便于直接打开）
const title = ref('看懂图解里的符号')
const ep = ref('第 1 章 · 第 3 节')
onLoad((o) => {
  if (o && o.name) title.value = decodeURIComponent(o.name)
  if (o && o.ep) ep.value = decodeURIComponent(o.ep)
})

const duration = ref(0)
const current = ref(0)
const playing = ref(false)
const slow = ref(false) // 0.5x 慢放
const loopSeg = ref(false) // 单段循环
const autoPause = ref(true) // 段末自动暂停（默认开，照顾"手被占"）
const endedSeg = ref(null) // 刚在哪一段末尾停下（显示"重复/继续"）
let playingSeg = 0 // 正在播放的段（用于判断越界）
let seeking = false // 主动跳转时，跳过一次越界判断

const segCount = KP.length
const segLen = computed(() => (duration.value > 0 ? duration.value / segCount : 0))
const curSeg = computed(() => {
  if (segLen.value <= 0) return 0
  return Math.min(segCount - 1, Math.floor(current.value / segLen.value))
})
// 每段进度条填充百分比
const segFill = (i) => {
  if (segLen.value <= 0) return 0
  return Math.max(0, Math.min(100, ((current.value - i * segLen.value) / segLen.value) * 100))
}
const pct = computed(() => (duration.value > 0 ? (current.value / duration.value) * 100 : 0))
const fmt = (s) => {
  s = Math.max(0, Math.round(s || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

onMounted(() => {
  ctx = uni.createVideoContext('lessonVideo', instance.proxy)
})

function onLoaded(e) {
  if (e.detail && e.detail.duration) duration.value = e.detail.duration
}
function onTimeupdate(e) {
  const d = e.detail || {}
  if (d.duration) duration.value = d.duration
  const t = d.currentTime || 0

  // 单段循环：到段尾就跳回段首
  if (loopSeg.value && segLen.value > 0) {
    const end = (playingSeg + 1) * segLen.value
    if (t >= end - 0.25) {
      seeking = true
      ctx && ctx.seek(playingSeg * segLen.value)
      current.value = playingSeg * segLen.value
      return
    }
  }
  // 段末自动暂停
  if (autoPause.value && !loopSeg.value && playing.value && segLen.value > 0 && !seeking) {
    const end = (playingSeg + 1) * segLen.value
    if (t >= end - 0.2 && playingSeg < segCount - 1) {
      ctx && ctx.pause()
      current.value = end
      endedSeg.value = playingSeg
      return
    }
  }
  seeking = false
  current.value = t
}
function onPlay() {
  playing.value = true
}
function onPause() {
  playing.value = false
}
function onEnded() {
  playing.value = false
}

function toggle() {
  if (!ctx) return
  if (endedSeg.value !== null) {
    // 从段末"继续"→ 进入下一段
    playingSeg = Math.min(segCount - 1, endedSeg.value + 1)
    endedSeg.value = null
    seeking = true
    ctx.seek(playingSeg * segLen.value)
    ctx.play()
    return
  }
  if (playing.value) ctx.pause()
  else {
    playingSeg = curSeg.value
    ctx.play()
  }
}
function repeatSeg() {
  if (!ctx) return
  const s = endedSeg.value !== null ? endedSeg.value : curSeg.value
  playingSeg = s
  endedSeg.value = null
  seeking = true
  ctx.seek(s * segLen.value)
  current.value = s * segLen.value
  ctx.play()
}
function jumpSeg(i) {
  if (!ctx || segLen.value <= 0) return
  playingSeg = i
  endedSeg.value = null
  seeking = true
  ctx.seek(i * segLen.value)
  current.value = i * segLen.value
  ctx.play()
}
function toggleSlow() {
  slow.value = !slow.value
  ctx && ctx.playbackRate(slow.value ? 0.5 : 1)
}
function toggleLoop() {
  loopSeg.value = !loopSeg.value
  if (loopSeg.value) {
    playingSeg = curSeg.value
    endedSeg.value = null
  }
}

// ③ 进度点按跳转（拖动太依赖手势，先做"点哪跳哪"，最稳跨端）
function seekTap(e) {
  if (!ctx || duration.value <= 0) return
  const x = (e.detail && e.detail.x) || (e.touches && e.touches[0] && e.touches[0].clientX) || 0
  uni
    .createSelectorQuery()
    .in(instance.proxy)
    .select('.vp-scrub-track')
    .boundingClientRect((r) => {
      if (!r) return
      const ratio = Math.min(1, Math.max(0, (x - r.left) / r.width))
      const tt = ratio * duration.value
      seeking = true
      endedSeg.value = null
      playingSeg = segLen.value > 0 ? Math.floor(tt / segLen.value) : 0
      current.value = tt
      ctx.seek(tt)
    })
    .exec()
}
function rewind10() {
  if (!ctx) return
  const tt = Math.max(0, current.value - 10)
  seeking = true
  endedSeg.value = null
  current.value = tt
  ctx.seek(tt)
}

// ④ 求助面板
const help = ref(false)
const helpView = ref(null) // null=选项列表 / 'faq'=常见问题
const faqOpen = ref(0)
const FAQ = [
  { q: '完全没有基础，也能学会吗？', a: '可以。课程从拿钩针、起针开始，每一针都有慢动作示范，跟着钩就好。' },
  { q: '钩错了能拆掉重来吗？', a: '当然。钩织最大的好处就是可拆，轻轻抽线就能回到上一步，不浪费毛线，大胆试。' },
  { q: '材料用完了怎么补？', a: '套装里的毛线、棉花都能单独补购，常用色号长期有货。' },
  { q: '钩完一只大概要多久？', a: '新手平均 3–4 小时，可分几次完成，不赶进度。' },
]
function openHelp() {
  ctx && ctx.pause()
  help.value = true
  helpView.value = null
}
function closeHelp() {
  help.value = false
  helpView.value = null
}
function helpAction(msg) {
  closeHelp()
  uni.showToast({ title: msg, icon: 'none' })
}

const back = () => goBack('/pages/index/index')
</script>

<template>
  <view class="vp">
    <!-- 视频：非全屏铺满，自绘控件（controls=false） -->
    <video
      id="lessonVideo"
      class="vp-video"
      :src="SRC"
      :controls="false"
      :show-center-play-btn="false"
      :enable-progress-gesture="false"
      object-fit="cover"
      :show-fullscreen-btn="false"
      @loadedmetadata="onLoaded"
      @timeupdate="onTimeupdate"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
    ></video>

    <!-- 点画面：播放/暂停 -->
    <view class="vp-hit" @tap="toggle"></view>

    <!-- 顶部：返回 + 标题 + 分段进度 -->
    <view class="vp-top">
      <view class="vp-topbar">
        <view class="vp-icbtn" @tap="back"><text class="vp-chev">‹</text></view>
        <view class="vp-titlewrap">
          <text class="vp-ep">{{ ep }}</text>
          <text class="vp-title">{{ title }}</text>
        </view>
        <view class="vp-icbtn"></view>
      </view>
      <view class="vp-seg">
        <view class="vp-seg-bars">
          <view v-for="(k, i) in KP" :key="i" class="vp-seg-bar" @tap="jumpSeg(i)">
            <view class="vp-seg-fill" :style="{ width: segFill(i) + '%' }"></view>
          </view>
        </view>
        <text class="vp-seg-label">【{{ curSeg + 1 }}/{{ segCount }}】{{ KP[curSeg] }}</text>
      </view>
    </view>

    <!-- 中间大播放键（暂停时显示） -->
    <view v-if="!playing && endedSeg === null" class="vp-bigplay" @tap="toggle">
      <text class="vp-bigplay-ic">▶</text>
    </view>

    <!-- 段末提示：重复本段 / 继续 -->
    <view v-if="endedSeg !== null" class="vp-segend">
      <view class="vp-segend-btn ghost" @tap="repeatSeg"><text>↺ 重复本段</text></view>
      <view class="vp-segend-btn solid" @tap="toggle"><text>继续 ›</text></view>
    </view>

    <!-- 底部控制 -->
    <view class="vp-ctl">
      <view class="vp-times">
        <text class="vp-time">{{ fmt(current) }}</text>
        <text class="vp-time">{{ fmt(duration) }}</text>
      </view>
      <view class="vp-scrub" @tap="seekTap">
        <view class="vp-scrub-track"><view class="vp-scrub-fill" :style="{ width: pct + '%' }"></view></view>
      </view>
      <view class="vp-row2">
        <view class="vp-pill" @tap="rewind10"><text>↺ 后退 10 秒</text></view>
        <view class="vp-pill" @tap="openHelp"><text>? 求助</text></view>
      </view>
      <view class="vp-tools">
        <view class="vp-tool" :class="{ on: slow }" @tap="toggleSlow"><text>0.5×慢放</text></view>
        <view class="vp-tool" :class="{ on: loopSeg }" @tap="toggleLoop"><text>单段循环</text></view>
        <view class="vp-tool" :class="{ on: autoPause }" @tap="autoPause = !autoPause"><text>段末暂停</text></view>
        <view class="vp-tool" @tap="repeatSeg"><text>↺ 重看本段</text></view>
      </view>
    </view>

    <!-- ④ 求助面板 -->
    <view v-if="help" class="hs-mask" @tap="closeHelp"></view>
    <view class="hs-sheet" :class="{ on: help }">
      <view class="hs-grab"></view>
      <view class="hs-head">
        <view v-if="helpView" class="hs-back" @tap="helpView = null"><text>‹</text></view>
        <text class="hs-title">{{ helpView === 'faq' ? '常见问题' : '需要帮忙吗？' }}</text>
        <view class="hs-x" @tap="closeHelp"><text>✕</text></view>
      </view>
      <view class="hs-body">
        <view v-if="!helpView">
          <view class="hs-opt" @tap="helpView = 'faq'">
            <text class="hs-opt-t">常见问题</text>
            <text class="hs-opt-s">新手最常卡住的几个问题</text>
          </view>
          <view class="hs-opt" @tap="helpAction('正在接入在线客服…')">
            <text class="hs-opt-t">联系在线客服</text>
            <text class="hs-opt-s">工作日 9:00–21:00 · 约 1 分钟应答</text>
          </view>
          <view class="hs-opt" @tap="helpAction('已复制学习群号 · 88-Ducky')">
            <text class="hs-opt-t">加入学习交流群</text>
            <text class="hs-opt-s">和一起钩鸭的小伙伴互相打气</text>
          </view>
          <view class="hs-opt" @tap="helpAction('反馈已收到 · 感谢你帮小鸭变得更好~')">
            <text class="hs-opt-t">反馈视频问题</text>
            <text class="hs-opt-s">卡顿 / 看不清 / 没声音…</text>
          </view>
        </view>
        <view v-else-if="helpView === 'faq'">
          <view
            v-for="(qa, i) in FAQ"
            :key="i"
            class="hs-faq-item"
            :class="{ open: faqOpen === i }"
          >
            <view class="hs-faq-q" @tap="faqOpen = faqOpen === i ? -1 : i">
              <text>{{ qa.q }}</text>
              <text class="hs-faq-chev">⌄</text>
            </view>
            <view class="hs-faq-a" :class="{ open: faqOpen === i }"><text>{{ qa.a }}</text></view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.vp {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #000;
  overflow: hidden;
}
.vp-video {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.vp-hit {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

/* 顶部 */
.vp-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: calc(12px + env(safe-area-inset-top)) 14px 14px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
}
.vp-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vp-icbtn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.vp-chev {
  color: #fff;
  font-size: 30px;
  line-height: 1;
}
.vp-titlewrap {
  flex: 1;
  min-width: 0;
}
.vp-ep {
  display: block;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
}
.vp-title {
  display: block;
  font-family: $font-display;
  font-size: 15px;
  color: #fff;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 分段进度 */
.vp-seg {
  margin-top: 10px;
}
.vp-seg-bars {
  display: flex;
  gap: 4px;
}
.vp-seg-bar {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
  overflow: hidden;
}
.vp-seg-fill {
  height: 100%;
  background: #fff;
}
.vp-seg-label {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
}

/* 中间大播放键 */
.vp-bigplay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
}
.vp-bigplay-ic {
  color: #fff;
  font-size: 26px;
  margin-left: 4px;
}

/* 段末提示 */
.vp-segend {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 12px;
}
.vp-segend-btn {
  padding: 12px 22px;
  border-radius: $r-pill;
}
.vp-segend-btn text {
  font-size: 15px;
  font-weight: 500;
}
.vp-segend-btn.ghost {
  background: rgba(255, 255, 255, 0.18);
}
.vp-segend-btn.ghost text {
  color: #fff;
}
.vp-segend-btn.solid {
  background: $purple;
}
.vp-segend-btn.solid text {
  color: #fff;
}

/* 底部控制 */
.vp-ctl {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0));
}
.vp-times {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}
.vp-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
}
.vp-scrub {
  padding: 9px 0; /* 加大点按热区，细条仍是 3px */
}
.vp-scrub-track {
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
  overflow: hidden;
}
.vp-scrub-fill {
  height: 100%;
  background: $purple;
}
.vp-row2 {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.vp-pill {
  flex: 1;
  padding: 9px 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
}
.vp-pill text {
  font-size: 12px;
  color: #fff;
}
.vp-tools {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.vp-tool {
  flex: 1;
  padding: 9px 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
}
.vp-tool text {
  font-size: 12px;
  color: #fff;
}
.vp-tool.on {
  background: $purple;
}

/* ④ 求助面板 */
.hs-mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 8;
}
.hs-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 78%;
  background: #fff;
  border-radius: 18px 18px 0 0;
  transform: translateY(110%);
  transition: transform 0.28s ease;
  z-index: 9;
  display: flex;
  flex-direction: column;
}
.hs-sheet.on {
  transform: translateY(0);
}
.hs-grab {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: $line-strong;
  margin: 8px auto 4px;
}
.hs-head {
  display: flex;
  align-items: center;
  padding: 8px 14px 12px;
  border-bottom: 1px solid $line;
}
.hs-back,
.hs-x {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.hs-back text {
  font-size: 24px;
  color: $ink;
}
.hs-x text {
  font-size: 16px;
  color: $content-2;
}
.hs-title {
  flex: 1;
  text-align: center;
  font-family: $font-display;
  font-weight: 500;
  font-size: 16px;
  color: $ink;
}
.hs-body {
  padding: 4px 16px calc(20px + env(safe-area-inset-bottom));
  overflow-y: auto;
}
.hs-opt {
  padding: 14px 4px;
  border-bottom: 1px solid $line;
}
.hs-opt-t {
  display: block;
  font-size: 15px;
  color: $ink;
}
.hs-opt-s {
  display: block;
  font-size: 12px;
  color: $content-2;
  margin-top: 3px;
}
.hs-faq-item {
  border-bottom: 1px solid $line;
}
.hs-faq-q {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 4px;
}
.hs-faq-q text {
  font-size: 14px;
  color: $ink;
}
.hs-faq-chev {
  transition: transform 0.2s;
  color: $content-2;
}
.hs-faq-item.open .hs-faq-chev {
  transform: rotate(180deg);
}
.hs-faq-a {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
}
.hs-faq-a.open {
  max-height: 240px;
}
.hs-faq-a text {
  display: block;
  padding: 0 4px 14px;
  font-size: 13px;
  line-height: 1.6;
  color: $content;
}
</style>
