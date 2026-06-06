<script setup>
/**
 * 视频教程 · 课程目录页。对应原设计 VideoCatalog（目录部分）。
 * 灰色封面 + 课程标题 + 开始学习 + 章节折叠 + 课时状态；点课时进播放页。
 * 封面/缩略按项目约定用灰占位，真实媒体以后注入。
 */
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import { COURSE, ALL_LESSONS } from '@/data/course.js'
import { goBack } from '@/utils/nav.js'

// 默认展开第 1 章
const open = ref({ c1: true })
function toggleChapter(id) {
  open.value = { ...open.value, [id]: !open.value[id] }
}

const doneCount = computed(() => ALL_LESSONS.filter((l) => l.done).length)
const total = ALL_LESSONS.length
const progPct = computed(() => Math.round((doneCount.value / total) * 100))

function lessonState(l) {
  if (l.done) return 'done'
  if (l.watched) return 'watching'
  return 'todo'
}
function lessonIcon(l) {
  if (l.done) return 'check-on'
  return 'play-ink'
}
function lessonSub(l, li) {
  if (l.done) return '已看完'
  if (l.watched) return `上次看到 ${Math.round(l.watched * 100)}%`
  return `第 ${li + 1} 节`
}

// 点课时 → 进播放页，带上 章节/节次/课名（播放页显示用）
function openLesson(lesson) {
  // 只传 id，播放页按 id 从课程表取名/章节、并支持上一集/下一集
  uni.navigateTo({ url: `/pages/player/index?id=${lesson.id}` })
}
function startFirst() {
  // 从第一个未学完的课开始（没有就第一节）
  const next = ALL_LESSONS.find((l) => !l.done) || ALL_LESSONS[0]
  openLesson(next)
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
  <view class="vc">
    <!-- 封面（灰占位 + 标题叠加） -->
    <view class="vc-cover">
      <view class="vc-cover-scrim"></view>
      <view class="vc-back" @tap="back"><Icon name="chevron-left" :size="22" /></view>
      <view class="vc-fav" @tap="fav"><Icon name="bookmark" :size="20" /></view>
      <view class="vc-cover-copy">
        <text class="vc-cover-eyebrow">视频教程</text>
        <text class="vc-cover-title">{{ COURSE.title }}</text>
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

    <!-- 章节折叠 -->
    <view class="vc-chapters">
      <view
        v-for="(c, ci) in COURSE.chapters"
        :key="c.id"
        class="vc-chapter"
        :class="{ open: open[c.id] }"
      >
        <view class="vc-chap-head" @tap="toggleChapter(c.id)">
          <text class="vc-chap-no">{{ ci + 1 }}</text>
          <view class="vc-chap-text">
            <text class="vc-chap-title">{{ c.title }}</text>
            <text class="vc-chap-sub">
              {{ c.lessons.length }} 节课 · 已学 {{ c.lessons.filter((l) => l.done).length }}
            </text>
          </view>
          <view class="vc-chap-chev"><Icon name="chevron-down" :size="20" /></view>
        </view>

        <view class="vc-chap-body" :class="{ open: open[c.id] }">
          <view class="vc-chap-inner">
            <view
              v-for="(l, li) in c.lessons"
              :key="l.id"
              class="vc-lesson"
              :class="lessonState(l)"
              @tap="openLesson(l)"
            >
              <view class="vc-lesson-ico"><Icon :name="lessonIcon(l)" :size="20" /></view>
              <view class="vc-lesson-mid">
                <text class="vc-lesson-name">{{ l.name }}</text>
                <view class="vc-lesson-subrow">
                  <text class="vc-lesson-sub" :class="{ done: l.done }">{{ lessonSub(l, li) }}</text>
                  <text v-if="l.free" class="vc-free">试看</text>
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
  top: calc(14px + env(safe-area-inset-top));
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
  right: 12px;
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
.vc-chap-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease;
}
.vc-chap-body.open {
  max-height: 600px;
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
.vc-lesson:active {
  opacity: 0.6;
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
.vc-free {
  font-size: 11px;
  color: $purple;
  border: 0.5px solid $purple-line;
  border-radius: 4px;
  padding: 1px 6px;
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
