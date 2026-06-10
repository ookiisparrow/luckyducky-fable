<script setup>
/**
 * 视频教程 · 播放页。对照设计稿 VideoCatalog.jsx 的 VideoPlayer 重做外壳。
 * 保留真 <video>（非全屏铺满、自绘控件，保小程序同层渲染）+ 知识点分段进度 +
 * 段末自动暂停→「重复播放」。控件按设计稿：顶部 收起/标题/更多，底部 上一集/求助/下一集。
 * （研究性开关 0.5×慢放/单段循环/段末暂停开关 按设计稿移除。）
 *
 * 求助面板：设计稿完整版（客服/辅助视频/群/FAQ/反馈），拆在 ./components/HelpSheet/。
 */
import { ref, computed, onMounted, getCurrentInstance } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import HelpSheet from './components/HelpSheet/index.vue'
import { goBack } from '@/utils/nav.js'
import { mmss as fmt } from '@/utils/format.js'
import { useCoursesStore } from '@/store/courses.js'
import { useActivationStore } from '@/store/activation.js'
import { getSystemBarVars } from '@/utils/systemBar.js'

// 顶部控件避状态栏/胶囊：只下移浮层，视频保持铺满到顶（避免顶部露黑块）
const barVars = getSystemBarVars()

// 占位视频：segment.videoFileId 剪好前所有段共用一条，按时长等分模拟分段；
// 素材按段剪好后改为「每段独立文件 + 云函数换临时 URL」（规格 v2 §三/§四）
const SRC = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'

const instance = getCurrentInstance()
let ctx = null

// 课程内容从 store 取（小程序端云端、H5/App 回退本地）；load 前是安全空形状
const store = useCoursesStore()
const act = useActivationStore()
const course = computed(() => store.current)
const lessons = computed(() => store.allLessons)

// 当前课时：按 id 从课程表定位，支持上一集/下一集
const idx = ref(2) // 默认 l3
onLoad(async (o) => {
  await store.load()
  // 播放鉴权（规格 §四-4）：未确认激活 → 回目录（目录显示锁态引导）
  await act.loadMine()
  if (!act.unlocked(store.current.id)) {
    uni.showToast({ title: '课程需扫码激活后观看', icon: 'none' })
    uni.redirectTo({ url: '/pages/catalog/index' })
    return
  }
  if (o && o.id) {
    const i = lessons.value.findIndex((l) => l.id === o.id)
    if (i >= 0) idx.value = i
  }
})
const lesson = computed(() => lessons.value[idx.value] || lessons.value[0] || {})
const title = computed(() => lesson.value.name || '')
const ep = computed(() => {
  const ci = course.value.chapters.findIndex((c) => c.id === lesson.value.chapter)
  if (ci < 0) return ''
  return `第 ${ci + 1} 章 · 第 ${idx.value + 1} 节`
})
const hasPrev = computed(() => idx.value > 0)
const hasNext = computed(() => idx.value < lessons.value.length - 1)

const duration = ref(0)
const current = ref(0)
const playing = ref(false)
const endedSeg = ref(null) // 刚在哪段末尾停下（显示「重复播放」）
let playingSeg = 0
let seeking = false

// 分段进度条 = 当前课时的 segments（来自课程数据，不再硬编码）
const segs = computed(() => lesson.value.segments || [])
const segCount = computed(() => segs.value.length || 1)
const segLen = computed(() => (duration.value > 0 ? duration.value / segCount.value : 0))
const curSeg = computed(() => {
  if (segLen.value <= 0) return 0
  return Math.min(segCount.value - 1, Math.floor(current.value / segLen.value))
})
const curSegName = computed(() => (segs.value[curSeg.value] || {}).name || '')
const segFill = (i) => {
  if (segLen.value <= 0) return 0
  return Math.max(0, Math.min(100, ((current.value - i * segLen.value) / segLen.value) * 100))
}
const pct = computed(() => (duration.value > 0 ? (current.value / duration.value) * 100 : 0))

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
  // 段末自动暂停（始终开，照顾钩织时双手被占）→ 弹「重复播放」
  if (playing.value && segLen.value > 0 && !seeking) {
    const end = (playingSeg + 1) * segLen.value
    if (t >= end - 0.2 && playingSeg < segCount.value - 1) {
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

// 点画面 / 大播放键：暂停↔播放；段末→继续进入下一段
function toggle() {
  if (!ctx) return
  if (endedSeg.value !== null) {
    playingSeg = Math.min(segCount.value - 1, endedSeg.value + 1)
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
// 重复播放本段
function replaySeg() {
  if (!ctx) return
  const s = endedSeg.value !== null ? endedSeg.value : curSeg.value
  playingSeg = s
  endedSeg.value = null
  seeking = true
  ctx.seek(s * segLen.value)
  current.value = s * segLen.value
  ctx.play()
}
// 进度条点按跳转
function seekTap(e) {
  if (!ctx || duration.value <= 0) return
  const x = (e.detail && e.detail.x) || (e.touches && e.touches[0] && e.touches[0].clientX) || 0
  uni
    .createSelectorQuery()
    .in(instance.proxy)
    .select('.vp-scrub-bg')
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
// 上一集 / 下一集
function switchLesson(n) {
  const i = idx.value + n
  if (i < 0 || i >= lessons.value.length) return
  idx.value = i
  endedSeg.value = null
  playingSeg = 0
  seeking = true
  current.value = 0
  if (ctx) {
    ctx.seek(0)
    ctx.play()
  }
}
const prev = () => switchLesson(-1)
const next = () => switchLesson(1)
function more() {
  uni.showToast({ title: '更多（开发中）', icon: 'none' })
}

// —— 求助面板（player 专属，拆在 ./components/HelpSheet/）——
// 打开前先暂停主视频，再用 ref 调子组件的 open()
const helpRef = ref(null)
function openHelp() {
  ctx && ctx.pause()
  helpRef.value && helpRef.value.open()
}

const back = () => goBack('/pages/catalog/index')
</script>

<template>
  <view class="vp" :style="barVars">
    <!-- 真实视频：非全屏铺满，自绘控件 -->
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

    <!-- 点画面：播放/暂停（在控件下方一层） -->
    <view class="vp-hit" @tap="toggle"></view>
    <view class="vp-shade"></view>

    <!-- 顶部：收起 + 标题(居中) + 更多 + 分段进度 -->
    <view class="vp-top">
      <view class="vp-topbar">
        <view class="vp-icbtn" @tap="back"><Icon name="chevron-down-w" :size="24" /></view>
        <view class="vp-titlewrap">
          <text class="vp-ep">{{ ep }}</text>
          <text class="vp-title">{{ title }}</text>
        </view>
        <view class="vp-icbtn" @tap="more"><Icon name="ellipsis-w" :size="24" /></view>
      </view>
      <view class="vp-seg">
        <view class="vp-seg-bars">
          <view v-for="(s, i) in segs" :key="s.id" class="vp-seg-bar">
            <view class="vp-seg-fill" :style="{ width: segFill(i) + '%' }"></view>
          </view>
        </view>
        <text class="vp-seg-label"
          ><text class="num">【{{ curSeg + 1 }}/{{ segCount }}】</text>{{ curSegName }}</text
        >
      </view>
    </view>

    <!-- 中央大播放键（暂停且非段末时） -->
    <view v-if="!playing && endedSeg === null" class="vp-bigplay" @tap="toggle">
      <Icon name="play-fill-w" :size="34" />
    </view>

    <!-- 底部控制 -->
    <view class="vp-ctl">
      <view v-if="endedSeg !== null" class="vp-replay-bar" @tap="replaySeg">
        <Icon name="rotate-ccw-dark" :size="21" /><text>重复播放</text>
      </view>
      <view class="vp-scrub" @tap="seekTap">
        <view class="vp-scrub-bg">
          <view class="vp-scrub-fill" :style="{ width: pct + '%' }"></view>
          <view class="vp-scrub-thumb" :style="{ left: pct + '%' }"></view>
        </view>
      </view>
      <view class="vp-times"
        ><text>{{ fmt(current) }}</text
        ><text>{{ fmt(duration) }}</text></view
      >
      <view class="vp-row">
        <view class="vp-icbtn lg" :class="{ disabled: !hasPrev }" @tap="prev">
          <Icon name="skip-back-w" :size="27" />
        </view>
        <view class="vp-helpbtn" @tap="openHelp"><text class="vp-help-q">?</text></view>
        <view class="vp-icbtn lg" :class="{ disabled: !hasNext }" @tap="next">
          <Icon name="skip-forward-w" :size="27" />
        </view>
      </view>
    </view>

    <!-- 求助面板（./components/HelpSheet/；ep/title 传给副标题） -->
    <HelpSheet ref="helpRef" :ep="ep" :title="title" />
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
  color: #fff;
  font-family: $font-cn;
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
  inset: 0;
  z-index: 1;
}
/* 顶+底渐变,保证控件清晰 */
.vp-shade {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background:
    linear-gradient(to bottom, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0) 24%),
    linear-gradient(to top, rgba(0, 0, 0, 0.78) 0%, rgba(0, 0, 0, 0) 42%);
}

/* 顶部覆盖层 */
.vp-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  /* 只给浮层留出状态栏高度，视频容器保持铺满到顶（不整体下移，避免顶部露黑块） */
  /* #ifdef MP-WEIXIN */
  padding: var(--sbh, 0px) 10px 6px;
  /* #endif */
  /* #ifndef MP-WEIXIN */
  padding: calc(8px + env(safe-area-inset-top)) 10px 6px;
  /* #endif */
}
.vp-topbar {
  display: flex;
  align-items: center;
  /* 小程序：收起/标题/更多与胶囊同水平带居中，右端为胶囊让位 */
  /* #ifdef MP-WEIXIN */
  min-height: var(--navh, 44px);
  padding-right: var(--gap, 0px);
  /* #endif */
}
.vp-icbtn {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.vp-icbtn:active {
  background: rgba(255, 255, 255, 0.15);
}
.vp-icbtn.lg {
  width: 54px;
  height: 54px;
}
.vp-icbtn.disabled {
  opacity: 0.3;
}
.vp-titlewrap {
  flex: 1 1 auto;
  min-width: 0;
  text-align: center;
}
.vp-ep {
  display: block;
  font-family: $font-sans;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  opacity: 0.82;
}
.vp-title {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 15px;
  line-height: 1.3;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.4);
}
/* 分段进度 */
.vp-seg {
  padding: 4px 16px 6px;
}
.vp-seg-bars {
  display: flex;
}
.vp-seg-bar {
  flex: 1 1 0;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
  overflow: hidden;
  margin-right: 5px;
}
.vp-seg-bar:last-child {
  margin-right: 0;
}
.vp-seg-fill {
  height: 100%;
  background: #fff;
  border-radius: 999px;
}
.vp-seg-label {
  display: block;
  margin-top: 11px;
  font-weight: 500;
  font-size: 14px;
  color: #fff;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.45);
}
.vp-seg-label .num {
  font-family: $font-sans;
  font-weight: 600;
}

/* 中央大播放键 */
.vp-bigplay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 4;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.vp-bigplay:active {
  transform: translate(-50%, -50%) scale(0.92);
}

/* 底部控制 */
.vp-ctl {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  padding: 6px 18px calc(16px + env(safe-area-inset-bottom));
}
.vp-replay-bar {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: #fff;
  color: #1a1320;
  font-weight: 600;
  font-size: 16px;
  margin-bottom: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}
.vp-replay-bar:active {
  transform: translateY(1px);
}
.vp-replay-bar text {
  margin-left: 8px;
}
.vp-scrub {
  padding: 9px 0;
}
.vp-scrub-bg {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.3);
}
.vp-scrub-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: $purple;
}
.vp-scrub-thumb {
  position: absolute;
  top: 50%;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
}
.vp-times {
  display: flex;
  justify-content: space-between;
  font-family: $font-sans;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.86);
}
.vp-row {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
}
.vp-row .vp-icbtn.lg {
  margin: 0 34px;
}
/* 求助按钮（琥珀色圆 · 裸 ? 号） */
.vp-helpbtn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #f5b030; /* 求助琥珀（播放器专用，深色语境内联） */
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 16px rgba(242, 172, 60, 0.4);
}
.vp-helpbtn:active {
  transform: scale(0.94);
}
.vp-help-q {
  font-family: $font-display;
  font-weight: 700;
  font-size: 22px;
  color: #4a3408;
  line-height: 1;
}
</style>
