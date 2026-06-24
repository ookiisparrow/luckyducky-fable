<script setup>
/**
 * 「我的课程」列表 —— 用户已购买并激活的全部课程（act.mine 去重取课程对象）。
 * 「我」页「全部教程」指向这里（非某单门课的课时·根因#8 多课）；点一门课 → setCurrent + 进该课目录(catalog)。
 * 封面按项目约定用灰占位（课程无封面字段），标题/进度叠加；冷启显骨架不空白、不抢先显演示。
 */
import { computed, ref } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import Skeleton from '@/components/Skeleton.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import { useCoursesStore } from '@/store/courses.js'
import { useActivationStore } from '@/store/activation.js'
import { useProgressStore } from '@/store/progress.js'
import { goBack } from '@/utils/nav.js'
import { resolveMyCourses } from './myCourses.js'

const courses = useCoursesStore()
const act = useActivationStore()
const progress = useProgressStore()

onShow(() => {
  courses.load()
  act.loadMine()
  progress.load(true)
})
const refreshing = ref(false)
async function onRefresh() {
  refreshing.value = true
  try {
    await Promise.all([courses.load(true), act.loadMine(true), progress.load(true)])
  } finally {
    refreshing.value = false
  }
}
onPullDownRefresh(async () => {
  await onRefresh()
  uni.stopPullDownRefresh()
})

// 就绪：激活态 + 课程列表到位才决定显什么；未就绪显骨架（不抢先显空/演示·根因#8）
const ready = computed(() => act.loaded && courses.loaded)
// 我的课程：act.mine 去重取课程对象（纯函数 resolveMyCourses）
const myCourses = computed(() => resolveMyCourses(act.mine, courses.getById))

// 单门课进度（已学/总课时）
function meta(c) {
  const lessons = (c.chapters || []).flatMap((ch) =>
    (ch.lessons || []).map((l) => ({ ...l, chapter: ch.id }))
  )
  const total = lessons.length
  const done = lessons.filter((l) => progress.ofLesson(c.id, l).done).length
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 }
}

function openCourse(c) {
  courses.setCurrent(c.id) // 聚焦该课，目录据此取课（多课·防默认 list[0]）
  uni.navigateTo({ url: `/pages/catalog/index?courseId=${c.id}` })
}
const back = () => goBack('/pages/me/index')
function goShop() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="mc">
    <CoNavBar title="我的课程" @back="back" />

    <!-- 冷启/弱网：骨架占位，不空白也不抢先显演示（T-F2·根因#8） -->
    <view v-if="!ready" class="mc-body">
      <view v-for="n in 2" :key="n" class="mc-card">
        <Skeleton w="100%" h="150px" radius="14px" mb="12px" />
        <Skeleton w="56%" h="15px" mb="8px" />
        <Skeleton w="34%" h="12px" />
      </view>
    </view>

    <!-- 有课程：卡片列表 -->
    <view v-else-if="myCourses.length" class="mc-body">
      <view v-for="c in myCourses" :key="c.id" class="mc-card ld-tap" @tap="openCourse(c)">
        <view class="mc-cover">
          <MediaSlot ratio="16/9" />
          <view class="mc-cover-scrim"></view>
          <text class="mc-cover-title">{{ c.title }}</text>
        </view>
        <view class="mc-info">
          <text class="mc-meta"
            >共 {{ meta(c).total }} 节 · 已学 {{ meta(c).done }} · {{ meta(c).pct }}%</text
          >
          <view class="mc-prog"
            ><view class="mc-prog-fill" :style="{ width: meta(c).pct + '%' }"></view
          ></view>
        </view>
        <view class="mc-go"><Icon name="chevron-right" :size="18" /></view>
      </view>
    </view>

    <!-- 空态：还没有激活课程 -->
    <view v-else class="mc-empty">
      <view class="mc-empty-ico"><Icon name="graduation-cap" :size="28" /></view>
      <text class="mc-empty-title">还没有课程</text>
      <text class="mc-empty-sub">购买材料包、扫码激活后即可在这里看到你的全部课程</text>
      <view class="mc-empty-btn" @tap="goShop"
        ><text>去逛逛</text><Icon name="chevron-right" :size="15"
      /></view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.mc {
  min-height: 100vh;
  background: $bg-grey;
  font-family: $font-cn;
}
.mc-body {
  padding: 12px 20px 32px;
}
.mc-card {
  position: relative;
  background: $white;
  border-radius: $r-md;
  border: 1px solid $line;
  box-shadow: $shadow-soft;
  padding: 12px;
  margin-bottom: 16px;
}
.mc-cover {
  position: relative;
  border-radius: $r-sm;
  overflow: hidden;
}
.mc-cover-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(20, 14, 30, 0.6) 0%, rgba(20, 14, 30, 0.05) 50%);
}
.mc-cover-title {
  position: absolute;
  left: 12px;
  bottom: 10px;
  right: 12px;
  color: $white;
  font-family: $font-display;
  font-weight: 600;
  font-size: 17px;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.4);
}
.mc-info {
  padding: 12px 4px 2px;
}
.mc-meta {
  font-family: $font-sans;
  font-size: 12.5px;
  color: $content-2;
}
.mc-prog {
  margin-top: 8px;
  height: 4px;
  border-radius: 999px;
  background: $bg-lilac;
  overflow: hidden;
}
.mc-prog-fill {
  height: 100%;
  border-radius: 999px;
  background: $purple;
}
.mc-go {
  position: absolute;
  right: 14px;
  top: 50%;
  display: flex;
  color: $content-2;
}
/* 空态 */
.mc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 64px 32px;
}
.mc-empty-ico {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: $bg-lilac;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mc-empty-title {
  font-size: 16px;
  font-weight: 600;
  color: $ink;
  margin-top: 16px;
}
.mc-empty-sub {
  font-size: 13px;
  line-height: 1.6;
  color: $purple-meta;
  margin-top: 8px;
}
.mc-empty-btn {
  display: flex;
  align-items: center;
  margin-top: 18px;
  background: $purple-ink;
  color: $white;
  border-radius: $r-pill;
  font-size: 14px;
  font-weight: 600;
  padding: 9px 14px 9px 18px;
}
</style>
