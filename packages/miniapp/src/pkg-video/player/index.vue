<script setup>
/**
 * 视频教程 · 播放页。对照设计稿 VideoCatalog.jsx 的 VideoPlayer 重做外壳。
 * 保留真 <video>（非全屏铺满、自绘控件，保小程序同层渲染）+ 知识点分段进度 +
 * 段末自动暂停→「重复播放」。控件：顶部 收起/标题（「更多」按决策撤除，占位清单 ⑫），底部 上一段/求助/下一段（小段切换·连续跨课时）。
 * （研究性开关 0.5×慢放/单段循环/段末暂停开关 按设计稿移除。）
 *
 * 求助面板：设计稿完整版（客服/辅助视频/群/FAQ/反馈），拆在 ./components/HelpSheet/。
 */
import { ref, computed, onMounted, getCurrentInstance, watch } from 'vue'
import { onLoad, onHide, onUnload } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import HelpSheet from './components/HelpSheet/index.vue'
import { goBack } from '@/utils/nav.js'
import { mmss as fmt } from '@/utils/format.js'
import { stepSegment } from './segNav.js'
import { scrubTimeAt } from './scrub.js'
import { useCoursesStore } from '@/store/courses.js'
import { useActivationStore } from '@/store/activation.js'
import { getSystemBarVars } from '@/utils/systemBar.js'
import { track } from '@/utils/track.js'

// 顶部控件避状态栏/胶囊：只下移浮层，视频保持铺满到顶（避免顶部露黑块）
const barVars = getSystemBarVars()

// 视频源单一来源：只走云端 getPlaybackUrl 换短时效临时 URL（见 playUrl/videoSrc）。
// 无真实视频（素材未剪好/未上传）→ 本地占位封面，绝不播外链（T-F7·合规红线·守卫 no-external-video-src）。
const instance = getCurrentInstance()
let ctx = null

// 课程内容从 store 取（小程序端云端、H5/App 回退本地）；load 前是安全空形状
const store = useCoursesStore()
const act = useActivationStore()
const course = computed(() => store.current)
const lessons = computed(() => store.allLessons)

// 当前课时：按 id 从课程表定位（上一段/下一段会连续跨课时切换 idx）
const idx = ref(0) // 默认第一课时（实际由 onLoad 按传入 lessonId 定位）
// 按传入 lessonId 定位课时 + segmentId 定位小段（继续观看续到原小段·非恒第一段）；store 已就绪时同步生效
function locateLesson(o) {
  if (!o) return
  if (o.id) {
    const i = lessons.value.findIndex((l) => l.id === o.id)
    if (i >= 0) idx.value = i
  }
  // 段定位放在课时之后：segs 随 idx 重算，从「这门课时」的小段里找 o.seg
  if (o.seg) {
    const s = segs.value.findIndex((x) => x.id === o.seg)
    if (s >= 0) fileSeg.value = s
  }
}
onLoad(async (o) => {
  locateLesson(o) // 首个 await 前同步定位 → 首帧即正确那节，不先渲默认再跳（闪烁·根因#8）
  await store.load()
  // 播放鉴权（规格 §四-4）：未确认激活 → 回目录（目录显示锁态引导）
  await act.loadMine()
  if (!act.unlocked(store.current.id)) {
    uni.showToast({ title: '课程需扫码激活后观看', icon: 'none' })
    uni.redirectTo({ url: '/pages/catalog/index' })
    return
  }
  locateLesson(o) // 冷启直达播放页：store 刚加载完再定位一次
  // 进入即续播：显式取首段地址（watch 仅在段 id 变化时取址，续播到默认那节时段 id 不变→不取→黑屏·根因#8）
  // + 标记自动起播（pendingPlay → onLoaded 就绪即播）。
  pendingPlay = true
  refreshPlayUrl()
})
const lesson = computed(() => lessons.value[idx.value] || lessons.value[0] || {})
const title = computed(() => lesson.value.name || '')
const ep = computed(() => {
  const ci = course.value.chapters.findIndex((c) => c.id === lesson.value.chapter)
  if (ci < 0) return ''
  return `第 ${ci + 1} 章 · 第 ${idx.value + 1} 节`
})
// 段粒度（连续跨课时）：非全课首段即可上一段、非全课末段即可下一段；与 goSeg 同源 stepSegment 保持一致
const hasPrev = computed(() => stepSegment(lessons.value, idx.value, fileSeg.value, -1) !== null)
const hasNext = computed(() => stepSegment(lessons.value, idx.value, fileSeg.value, 1) !== null)

const duration = ref(0)
const current = ref(0)
const playing = ref(false)
const endedSeg = ref(null) // 刚在哪段末尾停下（显示「重复播放」）
let playingSeg = 0
let seeking = false
// 切段起播标记：换段后新 src 异步现取，置 true → 待新段元数据就绪（onLoaded）再起播，
// 不靠固定 setTimeout 猜（地址常没取回/没加载完就 play → 播一瞬间旧残帧再切→真机卡顿·根因#8）。
let pendingPlay = false
// 进度条拖拽：dragging 期间 onTimeupdate 不回写 current（进度跟手指走·防与播放头打架）；
// scrubRect 缓存进度条几何（拖动每帧同步用，不每帧异步 createSelectorQuery）。
let dragging = false
let scrubRect = null

// 分段进度条 = 当前课时的 segments（来自课程数据，不再硬编码）
const segs = computed(() => lesson.value.segments || [])
const segCount = computed(() => segs.value.length || 1)
// 分段视频模式（规格 §三/决策 §14 配套）：该课时所有小段都有真实视频（控制台第④步上传）
// → 每段独立播放（src 按段切换，段末=视频自然结束）；否则回退占位视频按时长等分
const fileSeg = ref(0) // 文件模式下的当前段
const fileMode = computed(() => segs.value.length > 0 && segs.value.every((s) => s.hasVideo))
// 服务端保护（审计 P1）：videoFileId 不再随目录下发，按当前段经云函数 getPlaybackUrl 换短时效临时 URL
const playUrl = ref('')
// 视频源：有真实分段视频走云端临时 URL；否则空（占位态显封面·不播外链·T-F7）
const videoSrc = computed(() => (fileMode.value ? playUrl.value : ''))
// 占位态：无真实视频时显本地封面、隐藏播放控件（不播任何外链·T-F7 合规）
const placeholderMode = computed(() => !fileMode.value)
const curFileSegId = computed(() => (fileMode.value ? segs.value[fileSeg.value]?.id || '' : ''))
let lastFetchedSeg = '' // 已取过地址的段 id：去重，防 watch 与 onLoad 显式调对同段双取（双取=两个不同临时 URL→重载闪）
async function refreshPlayUrl() {
  const seg = curFileSegId.value
  if (seg && seg === lastFetchedSeg) return // 同段已取，不重取
  lastFetchedSeg = seg
  playUrl.value = seg ? await store.playbackUrl(seg) : ''
}
watch(curFileSegId, refreshPlayUrl) // 段切换 / 换集 → 段 id 变 → 取址（首段=默认段时不变，由 onLoad 显式取）
const segLen = computed(() => (duration.value > 0 ? duration.value / segCount.value : 0))
const curSeg = computed(() => {
  if (segLen.value <= 0) return 0
  return Math.min(segCount.value - 1, Math.floor(current.value / segLen.value))
})
const pct = computed(() => (duration.value > 0 ? (current.value / duration.value) * 100 : 0))
// 当前展示段：文件模式按 fileSeg，占位模式按时间切片推算
const activeSeg = computed(() => (fileMode.value ? fileSeg.value : curSeg.value))
const curSegName = computed(() => (segs.value[activeSeg.value] || {}).name || '')
const segFill = (i) => {
  if (fileMode.value) {
    return i < fileSeg.value ? 100 : i === fileSeg.value ? pct.value : 0
  }
  if (segLen.value <= 0) return 0
  return Math.max(0, Math.min(100, ((current.value - i * segLen.value) / segLen.value) * 100))
}

onMounted(() => {
  ctx = uni.createVideoContext('lessonVideo', instance.proxy)
})

function onLoaded(e) {
  if (e.detail && e.detail.duration) duration.value = e.detail.duration
  measureScrub() // 控件就绪 → 缓存进度条几何，供点按/拖拽同步换算
  // 切段后新 src 元数据就绪 → 此刻起播（避免固定 200ms 撞上未加载完→卡顿·根因#8）
  if (pendingPlay) {
    pendingPlay = false
    ctx && ctx.play()
  }
}
function onTimeupdate(e) {
  const d = e.detail || {}
  if (d.duration) duration.value = d.duration
  if (dragging) return // 拖动中：进度由手指控制，忽略播放回报，避免拇指与播放头打架
  const t = d.currentTime || 0
  // 段末自动暂停（占位等分模式；文件模式由 onEnded 天然承担段末）
  // endedSeg === null 守卫：pause 生效前 timeupdate 可能再触发，防重复进入（埋点防重报）
  if (!fileMode.value && playing.value && segLen.value > 0 && !seeking && endedSeg.value === null) {
    const end = (playingSeg + 1) * segLen.value
    if (t >= end - 0.2 && playingSeg < segCount.value - 1) {
      ctx && ctx.pause()
      current.value = end
      endedSeg.value = playingSeg
      reportSegDone(playingSeg)
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
  if (fileMode.value) {
    // 文件模式：一段视频自然结束 = 该段看完；非最后一段弹「重复播放/继续」
    reportSegDone(fileSeg.value)
    if (fileSeg.value < segCount.value - 1) endedSeg.value = fileSeg.value
    return
  }
  reportSegDone(segCount.value - 1) // 占位模式：整条播完 = 最后一段看完
}

// —— 进度上报（一次埋点两用：events 流水 + 云端进度折叠，见 utils/track.js）——
// 文件模式下 at/dur 为「当前段内」的秒数（继续学习卡随之显示段内位置）
const segIdOf = (i) => (segs.value[i] || {}).id || ''
const progressMeta = () => ({
  courseId: course.value.id || '',
  lessonId: lesson.value.id || '',
  at: Math.round(current.value),
  dur: Math.round(duration.value),
})
function reportSegDone(i) {
  if (!lesson.value.id) return
  track('segment_done', { page: 'player', targetId: segIdOf(i), meta: progressMeta() })
}
// 离开播放页（切后台 / 返回）→ 记「最后看到」位置，喂「我」页继续学习卡
function reportWatchPoint() {
  if (!lesson.value.id || current.value <= 0) return
  track('watch_at', { page: 'player', targetId: segIdOf(activeSeg.value), meta: progressMeta() })
}
onHide(reportWatchPoint)
onUnload(reportWatchPoint)

// 点画面 / 大播放键：暂停↔播放；段末→继续进入下一段
function toggle() {
  if (!ctx) return
  if (endedSeg.value !== null) {
    const ended = endedSeg.value // 先存再清（审核批次B：清空后 null+1=1，第 2 段后继续播会跳回第 2 段）
    endedSeg.value = null
    if (fileMode.value) {
      // 进入下一段：切 src（自动从头），待新段元数据就绪再起播（pendingPlay·同 goSeg·非猜定时）
      fileSeg.value = Math.min(segCount.value - 1, fileSeg.value + 1)
      current.value = 0
      duration.value = 0
      pendingPlay = true
      return
    }
    playingSeg = Math.min(segCount.value - 1, ended + 1)
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
  if (fileMode.value) {
    endedSeg.value = null
    seeking = true
    ctx.seek(0)
    current.value = 0
    ctx.play()
    return
  }
  const s = endedSeg.value !== null ? endedSeg.value : curSeg.value
  playingSeg = s
  endedSeg.value = null
  seeking = true
  ctx.seek(s * segLen.value)
  current.value = s * segLen.value
  ctx.play()
}
// 进度条拖拽 + 点按：触点 clientX + 缓存的进度条几何 scrubRect → 目标时间（scrubTimeAt 钳位·单测锁）。
// 拖动中只更新 current（拇指实时跟随、onTimeupdate 被 dragging 挡住不打架）；松手才真 seek。
// 点按＝touchstart+touchend 无 move，同一套处理（touchend 按落点 seek），不再单设 @tap。
function measureScrub() {
  uni
    .createSelectorQuery()
    .in(instance.proxy)
    .select('.vp-scrub-bg')
    .boundingClientRect((r) => {
      if (r) scrubRect = r
    })
    .exec()
}
function touchX(e) {
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
  return t ? t.clientX : null
}
function onScrubStart(e) {
  if (duration.value <= 0) return
  dragging = true
  measureScrub() // 刷新几何（拖动期间用缓存，不每帧异步查）
  const tt = scrubTimeAt(touchX(e), scrubRect, duration.value)
  if (tt != null) current.value = tt
}
function onScrubMove(e) {
  if (!dragging) return
  const tt = scrubTimeAt(touchX(e), scrubRect, duration.value)
  if (tt != null) current.value = tt
}
function onScrubEnd(e) {
  if (!dragging) return
  dragging = false
  if (!ctx) return
  const tt = scrubTimeAt(touchX(e), scrubRect, duration.value)
  const target = tt != null ? tt : current.value
  current.value = target
  endedSeg.value = null
  seeking = true
  if (!fileMode.value) playingSeg = segLen.value > 0 ? Math.floor(target / segLen.value) : 0
  ctx.seek(target)
}
// 上一段 / 下一段（小段切换·连续跨课时）：到本课时边界自动接相邻课时（规格 R8 升级·纯函数 segNav）。
// 目标段定位交给 stepSegment（边界/跨课时/空课时逻辑单测锁），这里只把结果落到 idx/fileSeg 并起播。
function goSeg(dir) {
  const t = stepSegment(lessons.value, idx.value, fileSeg.value, dir)
  if (!t) return // 全课首/末段，无处可去（按钮已灰）
  ctx && ctx.pause() // 先停当前段，切换间隙不续播旧段残帧
  idx.value = t.lessonIdx
  fileSeg.value = t.segIdx
  endedSeg.value = null
  playingSeg = 0
  seeking = true
  current.value = 0
  duration.value = 0
  // 段 id 变 → watch(curFileSegId) 重取 playUrl → 新 src 元数据就绪（onLoaded）再起播（pendingPlay·非猜定时）
  pendingPlay = true
}
const prev = () => goSeg(-1)
const next = () => goSeg(1)

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
      :src="videoSrc"
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

    <!-- 点画面：播放/暂停（在控件下方一层）；占位态无视频不响应点播 -->
    <view v-if="!placeholderMode" class="vp-hit" @tap="toggle"></view>
    <view class="vp-shade"></view>

    <!-- 占位封面（无真实视频·素材未剪好）：本地占位、绝不播外链（T-F7·合规）。
         顶栏 z-index 高于此层，返回键仍可点。 -->
    <view v-if="placeholderMode" class="vp-placeholder">
      <text class="vp-ph-title">课程视频整理中</text>
      <text class="vp-ph-sub">视频上线后即可在此观看，敬请期待</text>
    </view>

    <!-- 顶部：收起 + 标题(居中) + 右等宽空位(保持标题居中) + 分段进度 -->
    <view class="vp-top">
      <view class="vp-topbar">
        <view class="vp-icbtn" @tap="back"><Icon name="chevron-down-w" :size="24" /></view>
        <view class="vp-titlewrap">
          <text class="vp-ep">{{ ep }}</text>
          <text class="vp-title">{{ title }}</text>
        </view>
        <!-- 「更多」按钮已按决策撤除（上线前占位清单 ⑫）；留等宽空位维持标题居中 -->
        <view class="vp-icbtn"></view>
      </view>
      <view v-if="!placeholderMode" class="vp-seg">
        <view class="vp-seg-bars">
          <view v-for="(s, i) in segs" :key="s.id" class="vp-seg-bar">
            <view class="vp-seg-fill" :style="{ width: segFill(i) + '%' }"></view>
          </view>
        </view>
        <text class="vp-seg-label"
          ><text class="num">【{{ activeSeg + 1 }}/{{ segCount }}】</text>{{ curSegName }}</text
        >
      </view>
    </view>

    <!-- 中央大播放键（暂停且非段末时；占位态无视频不显） -->
    <view v-if="!playing && endedSeg === null && !placeholderMode" class="vp-bigplay" @tap="toggle">
      <Icon name="play-fill-w" :size="34" />
    </view>

    <!-- 底部控制（占位态无视频不显） -->
    <view v-if="!placeholderMode" class="vp-ctl">
      <view v-if="endedSeg !== null" class="vp-replay-bar" @tap="replaySeg">
        <Icon name="rotate-ccw-dark" :size="21" /><text>重复播放</text>
      </view>
      <view
        class="vp-scrub"
        @touchstart="onScrubStart"
        @touchmove.stop.prevent="onScrubMove"
        @touchend="onScrubEnd"
        @touchcancel="onScrubEnd"
      >
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
/* 占位封面（无真实视频·T-F7）：盖住黑底视频区，居中文案；z-index 低于顶栏(5) 故返回键可点 */
.vp-placeholder {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 40px;
  text-align: center;
  background: linear-gradient(160deg, rgba(123, 92, 175, 0.28) 0%, rgba(0, 0, 0, 0.72) 100%);
}
.vp-ph-title {
  font-size: 17px;
  font-weight: 600;
  color: #fff;
}
.vp-ph-sub {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.6);
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
