<script setup>
/**
 * 视频教程 · 欢迎流（变体 A · 沉浸全屏）。对应原设计 Welcome.jsx 的 VariantA。
 * 2 屏：轻触欢迎 → 正式开始 →（开始学习）进入课程目录。
 * 品牌第一印象：用真实大图铺满 + 简洁文案建立信心。
 */
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { getSystemBarVars } from '@/utils/systemBar.js'
import { STORAGE_KEYS } from '@/constants/storage.js'

const page = ref(0) // 0=欢迎屏 1=开始屏

// 顶部关闭/返回/logo 避状态栏与胶囊：动态值经 CSS 变量进 scoped
const barVars = getSystemBarVars()

// 标记「看过」（之后「全部教程」不再自动弹欢迎页，可在目录页「重看引导」再看）。
// 只在用户「开始学习」或「关闭」这类明确动作时才记 —— 之前是在 onLoad 一进页面就记，
// 导致「打开后没看就被动关掉」也算看过、下次不再自动引导。改成动作触发更贴合真实意图。
function markSeen() {
  uni.setStorageSync(STORAGE_KEYS.VIDEO_INTRO_SEEN, true)
}

function next() {
  page.value = 1
}
function back() {
  page.value = 0
}
function close() {
  markSeen()
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/index/index' })
}
function start() {
  markSeen()
  // 用 redirectTo 替换掉欢迎页：返回时直接回上一层，不再夹一屏引导
  uni.redirectTo({ url: '/pages/catalog/index' })
}
</script>

<template>
  <view class="wel" :style="barVars">
    <image class="wel-photo" src="/static/hero-full.jpg" mode="aspectFill" />
    <view class="wel-scrim"></view>

    <!-- 屏 0：欢迎 -->
    <view v-if="page === 0" class="wel-screen" @tap="next">
      <view class="wel-close" @tap.stop="close"><Icon name="x" :size="20" /></view>
      <view class="wel-top">
        <image class="wel-logo" src="/static/logo-white.svg" mode="heightFix" />
      </view>
      <view class="wel-body">
        <text class="wel-eyebrow">VIDEO COURSE · 视频教程</text>
        <view class="wel-display">
          <text class="wel-display-l">开启你的</text>
          <text class="wel-display-l">钩织之旅</text>
        </view>
        <text class="wel-lead">欢迎来到易织™小棉鸭®，跟着视频一针一线，钩出属于你的幸运。</text>
        <view class="wel-foot">
          <view class="wel-dots"><view class="dot on"></view><view class="dot"></view></view>
          <view class="wel-mini" @tap.stop="next"><text>下一页</text><Icon name="arrow-right" :size="16" /></view>
        </view>
      </view>
    </view>

    <!-- 屏 1：开始 -->
    <view v-else class="wel-screen">
      <view class="wel-close back" @tap="back"><Icon name="chevron-left" :size="22" /></view>
      <view class="wel-top">
        <image class="wel-logo" src="/static/logo-white.svg" mode="heightFix" />
      </view>
      <view class="wel-body">
        <text class="wel-eyebrow">准备好了吗</text>
        <view class="wel-display">
          <text class="wel-display-l">现在，</text>
          <text class="wel-display-l">从第一针开始</text>
        </view>
        <text class="wel-lead">我们已为你备好每一步视频，跟着钩就好，慢慢来，第一次也能完成。</text>
        <view class="wel-cta" @tap="start">
          <text class="wel-cta-text">开始学习</text>
          <Icon name="arrow-right" :size="18" />
        </view>
        <view class="wel-dots"><view class="dot"></view><view class="dot on"></view></view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.wel {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #000;
  overflow: hidden;
}
.wel-photo {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.wel-scrim {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 70%;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.35) 45%, rgba(0, 0, 0, 0.82) 100%);
}
.wel-screen {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.wel-close {
  position: absolute;
  /* 小程序：与胶囊同一水平带，右端为胶囊让位 */
  /* #ifdef MP-WEIXIN */
  top: calc(var(--sbh, 0px) + (var(--navh, 44px) - 38px) / 2);
  right: calc(16px + var(--gap, 0px));
  /* #endif */
  /* #ifndef MP-WEIXIN */
  top: calc(16px + env(safe-area-inset-top));
  right: 16px;
  /* #endif */
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}
.wel-close.back {
  left: 12px;
  right: auto;
  background: transparent;
}
.wel-top {
  position: absolute;
  /* logo 居中行放在导航带下方 */
  /* #ifdef MP-WEIXIN */
  top: calc(var(--sbh, 0px) + var(--navh, 44px) + 12px);
  /* #endif */
  /* #ifndef MP-WEIXIN */
  top: calc(56px + env(safe-area-inset-top));
  /* #endif */
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
}
.wel-logo {
  height: 30px;
  opacity: 0.96;
}
.wel-body {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(56px + env(safe-area-inset-bottom));
  padding: 0 28px;
}
.wel-eyebrow {
  display: block;
  font-family: $font-sans;
  font-size: 12px;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 14px;
}
.wel-display {
  margin-bottom: 16px;
}
.wel-display-l {
  display: block;
  font-family: $font-display;
  font-weight: 600;
  font-size: 40px;
  line-height: 1.12;
  color: #fff;
  letter-spacing: -0.5px;
}
.wel-lead {
  display: block;
  font-size: 15px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.88);
  max-width: 300px;
}
.wel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 28px;
}
.wel-dots {
  display: flex;
  gap: 7px;
  margin-top: 28px;
}
.wel-foot .wel-dots {
  margin-top: 0;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
}
.dot.on {
  width: 18px;
  border-radius: 4px;
  background: #fff;
}
.wel-mini {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: $r-pill;
  background: rgba(255, 255, 255, 0.18);
}
.wel-mini text {
  font-size: 14px;
  color: #fff;
}
.wel-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 52px;
  border-radius: $r-pill;
  background: $purple-ink;
  margin-top: 28px;
}
.wel-cta:active {
  background: $purple-ink-active;
}
.wel-cta-text {
  font-size: 17px;
  font-weight: 500;
  color: #fff;
}
</style>
