<script setup>
/**
 * 首屏 Hero：全屏大图 + 叠加标题/标语 + 搜索按钮 + 购买按钮。
 * 对应原型 Sections.jsx 的 Hero。hero 图是唯一保留的真实图片。
 */
import { getSystemBar } from '@/utils/systemBar.js'

defineProps({
  title: { type: String, default: '创造幸运' },
  tagline: { type: String, default: 'Get ducky get lucky' },
})
const emit = defineEmits(['buy', 'explore'])
// 顶部留白避状态栏（注入 CSS 变量，左上角 logo 据此下移；微信胶囊在右上不冲突）
const topStyle = { '--sbh': getSystemBar().statusBarHeight + 'px' }
</script>

<template>
  <view class="ld-hero" :style="topStyle">
    <image class="ld-hero-photo" src="/static/hero-full.jpg" mode="aspectFill" />
    <view class="ld-hero-scrim"></view>
    <image class="ld-hero-logo" src="/static/logo-wordmark.svg" mode="heightFix" />
    <view class="ld-hero-copy">
      <text class="ld-display">{{ title }}</text>
      <text class="ld-hero-tag">{{ tagline }}</text>
      <view class="ld-hero-cta">
        <view class="ld-search" @tap="emit('explore')">
          <text class="ld-search-text">入门钩织的妙趣方式</text>
        </view>
        <view class="ld-btn-buy" @tap="emit('buy')">
          <text class="ld-btn-buy-text">购买</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-hero {
  position: relative;
  min-height: 100vh;
  background: $bg-sage;
}
.ld-hero-photo {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}
.ld-hero-scrim {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 420px;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0),
    rgba(255, 255, 255, 0.55) 55%,
    rgba(255, 255, 255, 0.9)
  );
}
/* 左上角品牌字标（hero 顶部为浅色，用深色 wordmark） */
.ld-hero-logo {
  position: absolute;
  left: 20px;
  /* #ifdef MP-WEIXIN */
  top: calc(var(--sbh, 20px) + 10px);
  /* #endif */
  /* #ifndef MP-WEIXIN */
  top: calc(env(safe-area-inset-top) + 10px);
  /* #endif */
  height: 28px;
  z-index: 5;
}
.ld-hero-copy {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 150px;
  padding: 0 $pad-page;
  text-align: center;
}
.ld-display {
  display: block;
  @include ld-display;
}
.ld-hero-tag {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  margin-top: 9px;
  color: $ink-pure;
  letter-spacing: 0.04em;
}
.ld-hero-cta {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  margin-top: 24px;
}
.ld-search {
  display: flex;
  align-items: center;
  justify-content: center;
  background: $white;
  border: 1px solid $brand;
  border-radius: $r-pill;
  padding: 12px 22px;
}
.ld-search-text {
  font-size: 15px;
  color: $brand;
  font-weight: 500;
  white-space: nowrap;
}
.ld-btn-buy {
  display: flex;
  align-items: center;
  background: $purple-ink;
  border-radius: $r-pill;
  padding: 0 26px;
  height: 48px;
}
.ld-btn-buy:active {
  background: $purple-ink-active;
}
.ld-btn-buy-text {
  color: $white;
  font-size: 16px;
  font-weight: 500;
}
</style>
