<script setup>
/**
 * 视频教程 · 课程目录页。对应原设计 VideoCatalog（目录部分）。
 * 灰色封面 + 课程标题 + 开始学习 + 章节折叠 + 课时状态；点课时进播放页。
 * 封面/缩略按项目约定用灰占位，真实媒体以后注入。
 */
import { ref, computed, watch } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import Skeleton from '@/components/Skeleton.vue'
import { useCoursesStore } from '@/store/courses.js'
import { useActivationStore } from '@/store/activation.js'
import { useProgressStore } from '@/store/progress.js'
import { goBack } from '@/utils/nav.js'
import { getSystemBarVars } from '@/utils/systemBar.js'

// 封面浮层按钮避状态栏/胶囊：动态值经 CSS 变量进 scoped
const barVars = getSystemBarVars()

// 课程内容从 store 取（小程序端云端、H5/App 回退本地）；load 前是安全空形状
const store = useCoursesStore()
const act = useActivationStore()
const progress = useProgressStore()
// 扫码激活跳转带的 courseId → 目录聚焦该课（多课不再恒 list[0]·根因#8）
onLoad((q) => {
  if (q && q.courseId) store.setCurrent(decodeURIComponent(q.courseId))
})
// onShow 而非 onMounted：从播放页返回时强刷进度，刚看完的段立即点亮
onShow(async () => {
  await Promise.all([store.load(), act.loadMine(), progress.load(true)])
  // 从 TabBar 直接进（无 courseId）且尚未聚焦 → 默认聚焦用户已解锁的课，而非恒 list[0]（根因#8）
  if (!store.currentId && act.mine.length) store.setCurrent(act.mine[act.mine.length - 1].courseId)
  prefetchFirstSegment() // 还在列表页时就预热第一段地址 → 点进去免取址往返、缩短首屏黑屏（根因#8）
})
// 在列表页提前换好「续看课时」首段的播放地址，塞进跨页共享缓存（解析器单例）→ 进播放页 refreshPlayUrl
// 直接命中、省掉那趟 getPlaybackUrl 云往返（课程/鉴权进播放页时已是热的，取址是唯一剩下的延迟）。
// 只预热已解锁课（未授权 getPlaybackUrl 必返空·白跑）；目标段与 startFirst 同口径（第一个未学完课时·首段）。
function prefetchFirstSegment() {
  if (!act.unlocked(course.value.id)) return
  const l = lessons.value.find((x) => !prog(x).done) || lessons.value[0]
  const seg = l && (l.segments || [])[0]
  if (seg && seg.hasVideo) store.prefetchPlaybackUrl(seg.id)
}
// 下拉刷新：强刷课程/激活/进度后收转圈（finally 保证失败也不卡转圈·根因#8）
onPullDownRefresh(async () => {
  try {
    await Promise.all([store.load(true), act.loadMine(true), progress.load(true)])
  } finally {
    uni.stopPullDownRefresh()
  }
})
const course = computed(() => store.current)
const lessons = computed(() => store.allLessons)
// 课程权限（规格 §四-4）：未确认激活 → 章节锁态；H5/App 回退演示模式全解锁
const unlocked = computed(() => act.unlocked(course.value.id))

// 默认展开第一章——从 chapters[0] 动态取（深审 P2·守卫 catalog-chapter-fold-correct：原写死 { c1: true }，
// 只有种子鸭课第一章 id 恰为 c1，控制台建的课章节 id 随机 → 进目录全折叠）。课程切换（第一章 id 变）即重置。
const open = ref({})
watch(
  () => course.value.chapters[0] && course.value.chapters[0].id,
  (first) => {
    if (first) open.value = { [first]: true }
  },
  { immediate: true }
)
function toggleChapter(id) {
  open.value = { ...open.value, [id]: !open.value[id] }
}
// 展开高度按课时数动态算（深审 P2·同守卫）：写死 max-height 会截断超高章节（每章上限 50 节·约 9 节即溢出）。
// 120px/节 为宽裕上界（行高 ~60px·名称换行也够），只影响折叠动画曲线、保证不裁内容。
const chapMaxH = (c) => `${((c.lessons && c.lessons.length) || 0) * 120 + 24}px`

// 学习进度是用户态，与课程内容分离（小程序端云端 segment 粒度，H5/App 回退样例）
const prog = (l) => progress.ofLesson(course.value.id, l)

const doneCount = computed(() => lessons.value.filter((l) => prog(l).done).length)
const total = computed(() => lessons.value.length)
const progPct = computed(() =>
  total.value ? Math.round((doneCount.value / total.value) * 100) : 0
)

function lessonState(l) {
  if (prog(l).done) return 'done'
  if (prog(l).watched) return 'watching'
  return 'todo'
}
function lessonIcon(l) {
  if (prog(l).done) return 'check-on'
  return 'play-ink'
}
function lessonSub(l, li) {
  if (prog(l).done) return '已看完'
  if (prog(l).watched) return `上次看到 ${Math.round(prog(l).watched * 100)}%`
  return `第 ${li + 1} 节`
}

// 点课时 → 进播放页，带上 lessonId + courseId（播放页据 courseId 定身份·防串课·审计 #3）
function openLesson(lesson) {
  uni.navigateTo({ url: `/pkg-video/player/index?id=${lesson.id}&courseId=${course.value.id}` })
}
function startFirst() {
  if (!unlocked.value) {
    uni.showToast({ title: '课程需扫码激活后观看', icon: 'none' })
    return
  }
  // 从第一个未学完的课开始（没有就第一节）
  const next = lessons.value.find((l) => !prog(l).done) || lessons.value[0]
  if (next) openLesson(next)
}
const back = () => goBack('/pages/index/index')
function fav() {
  uni.showToast({ title: '已收藏本课程~', icon: 'none' })
}
function replayIntro() {
  uni.navigateTo({ url: '/pages/welcome/index' })
}
</script>

<template>
  <view class="vc" :style="barVars">
    <!-- 封面（灰占位 + 标题叠加） -->
    <view class="vc-cover">
      <view class="vc-cover-scrim"></view>
      <view class="vc-back" @tap="back"><Icon name="chevron-left" :size="22" /></view>
      <view class="vc-fav" @tap="fav"><Icon name="bookmark" :size="20" /></view>
      <view class="vc-cover-copy">
        <text class="vc-cover-eyebrow">视频教程</text>
        <text class="vc-cover-title">{{ course.title }}</text>
        <text class="vc-cover-meta">共 {{ total }} 节 · 已学 {{ doneCount }} · {{ progPct }}%</text>
        <text class="vc-replay" @tap="replayIntro">重看视频教程引导</text>
      </view>
    </view>

    <!-- 开始学习 -->
    <view class="vc-startwrap">
      <view class="vc-start" @tap="startFirst">
        <Icon name="play" :size="18" />
        <text class="vc-start-text">开始学习</text>
      </view>
    </view>

    <!-- 冷启 / 弱网加载骨架：课程数据未到时占位章节区，避免空白（T-F2·根因#8） -->
    <view v-if="store.loading && !store.loaded" class="vc-chapters vc-skel">
      <view v-for="n in 3" :key="n" class="vc-skel-chap">
        <Skeleton circle w="26px" />
        <view class="vc-skel-lines">
          <Skeleton w="55%" h="15px" mb="8px" />
          <Skeleton w="32%" h="12px" />
        </view>
      </view>
    </view>

    <!-- 未激活：锁态引导（规格「未激活课不可见」；章节明细不展示） -->
    <view v-else-if="!unlocked" class="vc-chapters">
      <view class="vc-lock">
        <view class="vc-lock-ico"><Icon name="qr-code-ink" :size="28" /></view>
        <text class="vc-lock-title">课程需扫码激活</text>
        <text class="vc-lock-sub"
          >视频课随材料包附赠。收到包裹后，扫描包装内的专属二维码，即可解锁全部课程。</text
        >
      </view>
    </view>

    <!-- 章节折叠 -->
    <view v-else class="vc-chapters">
      <view
        v-for="(c, ci) in course.chapters"
        :key="c.id"
        class="vc-chapter"
        :class="{ open: open[c.id] }"
      >
        <view class="vc-chap-head" @tap="toggleChapter(c.id)">
          <text class="vc-chap-no">{{ ci + 1 }}</text>
          <view class="vc-chap-text">
            <text class="vc-chap-title">{{ c.title }}</text>
            <text class="vc-chap-sub">
              {{ c.lessons.length }} 节课 · 已学 {{ c.lessons.filter((l) => prog(l).done).length }}
            </text>
          </view>
          <view class="vc-chap-chev"><Icon name="chevron-down" :size="20" /></view>
        </view>

        <view
          class="vc-chap-body"
          :class="{ open: open[c.id] }"
          :style="open[c.id] ? { maxHeight: chapMaxH(c) } : null"
        >
          <view class="vc-chap-inner">
            <view
              v-for="(l, li) in c.lessons"
              :key="l.id"
              class="vc-lesson ld-tap"
              :class="lessonState(l)"
              @tap="openLesson(l)"
            >
              <view class="vc-lesson-ico"><Icon :name="lessonIcon(l)" :size="20" /></view>
              <view class="vc-lesson-mid">
                <text class="vc-lesson-name">{{ l.name }}</text>
                <view class="vc-lesson-subrow">
                  <text class="vc-lesson-sub" :class="{ done: prog(l).done }">{{
                    lessonSub(l, li)
                  }}</text>
                </view>
              </view>
              <text class="vc-lesson-dur">{{ l.dur }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view class="vc-foot"></view>
  </view>
</template>

<style lang="scss" scoped>
.vc {
  min-height: 100vh;
  background: $bg;
}

/* 封面 */
.vc-cover {
  position: relative;
  height: 320px;
  background: $bg-sage; /* 灰占位 */
  display: flex;
  align-items: flex-end;
}
.vc-cover-scrim {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 70%;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.5));
}
.vc-back,
.vc-fav {
  position: absolute;
  /* 小程序：与胶囊同一水平带（按钮 38px 在导航带内垂直居中） */
  /* #ifdef MP-WEIXIN */
  top: calc(var(--sbh, 0px) + (var(--navh, 44px) - 38px) / 2);
  /* #endif */
  /* #ifndef MP-WEIXIN */
  top: calc(14px + env(safe-area-inset-top));
  /* #endif */
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.vc-back {
  left: 12px;
}
.vc-fav {
  /* #ifdef MP-WEIXIN */
  right: calc(12px + var(--gap, 0px)); /* 为胶囊让位 */
  /* #endif */
  /* #ifndef MP-WEIXIN */
  right: 12px;
  /* #endif */
}
.vc-cover-copy {
  position: relative;
  z-index: 1;
  padding: 0 20px 20px;
}
.vc-cover-eyebrow {
  display: block;
  font-family: $font-sans;
  font-size: 12px;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 8px;
}
.vc-cover-title {
  display: block;
  font-family: $font-display;
  font-weight: 700;
  font-size: 24px;
  line-height: 1.25;
  color: #fff;
}
.vc-cover-meta {
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 8px;
}
.vc-replay {
  display: inline-block;
  margin-top: 12px;
  font-size: 12.5px;
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
  padding: 6px 12px;
  border-radius: $r-pill;
}
.vc-replay:active {
  background: rgba(255, 255, 255, 0.3);
}

/* 开始学习 */
.vc-startwrap {
  padding: 16px 20px 4px;
}
.vc-start {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  border-radius: $r-pill;
  background: $purple-ink;
}
.vc-start:active {
  background: $purple-ink-active;
}
.vc-start-text {
  font-size: 16px;
  font-weight: 500;
  color: #fff;
}

/* 章节 */
.vc-chapters {
  padding: 12px 20px 0;
}
/* 加载骨架（T-F2）：章节区占位，结构对齐章节头（序号圆 + 标题/小字） */
.vc-skel-chap {
  display: flex;
  align-items: center;
  padding: 16px 0;
  border-bottom: 0.5px solid $line-soft;
}
.vc-skel-lines {
  flex: 1;
  margin-left: 14px;
}
/* 未激活锁态卡 */
.vc-lock {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 44px 28px;
  background: $bg-lilac;
  border-radius: $r-md;
  margin-top: 8px;
}
.vc-lock-ico {
  margin-bottom: 14px;
}
.vc-lock-title {
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.vc-lock-sub {
  font-size: 13px;
  line-height: 1.7;
  color: $content;
  margin-top: 8px;
  max-width: 260px;
}
.vc-chapter {
  border-bottom: 1px solid $line;
}
.vc-chap-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
}
.vc-chap-no {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: $bg-lilac;
  color: $purple;
  font-family: $font-sans;
  font-weight: 600;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.vc-chap-text {
  flex: 1;
  min-width: 0;
}
.vc-chap-title {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 16px;
  color: $ink;
}
.vc-chap-sub {
  display: block;
  font-size: 12px;
  color: $content-2;
  margin-top: 3px;
}
.vc-chap-chev {
  flex: 0 0 auto;
  display: flex;
  transition: transform 0.25s;
}
.vc-chapter.open .vc-chap-chev {
  transform: rotate(180deg);
}
/* 折叠动画：闭合态 max-height:0；展开高度由 :style 按课时数动态给（守卫 catalog-chapter-fold-correct：
   写死数值会截断超高章节·深审 P2） */
.vc-chap-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease;
}
.vc-chap-inner {
  padding-bottom: 8px;
}

/* 课时行 */
.vc-lesson {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0 12px 38px;
}
.vc-lesson-ico {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.vc-lesson-mid {
  flex: 1;
  min-width: 0;
}
.vc-lesson-name {
  display: block;
  font-size: 15px;
  color: $ink;
  line-height: 1.3;
}
.vc-lesson.done .vc-lesson-name {
  color: $content-2;
}
.vc-lesson-subrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
}
.vc-lesson-sub {
  font-size: 12px;
  color: $content-2;
}
.vc-lesson-sub.done {
  color: $purple;
}
.vc-lesson-dur {
  flex: 0 0 auto;
  font-family: $font-sans;
  font-size: 12px;
  color: $content-2;
}
.vc-foot {
  height: calc(40px + env(safe-area-inset-bottom));
}
</style>
