<script setup>
/**
 * 品牌介绍区。对应原型 Sections.jsx 的 BrandIntro。
 * id="intro" 供 hero 的「入门钩织的妙趣方式」按钮滚动定位。
 */
import { BRAND_NAME } from '@/constants/brand.js'
</script>

<template>
  <view id="intro" class="ld-intro">
    <image class="ld-intro-logo" src="/static/logo-wordmark.svg" mode="widthFix" />
    <text class="ld-intro-name">{{ BRAND_NAME }}</text>
    <view class="ld-intro-lead">
      <text class="ld-intro-lead-line">我们希望每个人都能</text>
      <text class="ld-intro-lead-line">亲手创造自己的随身幸运物。</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-intro {
  padding: 76px $pad-page 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.ld-intro-logo {
  width: 196px;
  margin-bottom: 14px;
}
.ld-intro-name {
  font-family: $font-display;
  font-weight: 500;
  font-size: 20px;
  color: $content;
  letter-spacing: 0.02em;
}
.ld-intro-lead {
  margin: 30px auto 40px;
  max-width: 330px;
}
.ld-intro-lead-line {
  display: block;
  font-family: $font-display;
  font-size: 18px;
  line-height: 1.55;
  color: $content;
}
</style>
