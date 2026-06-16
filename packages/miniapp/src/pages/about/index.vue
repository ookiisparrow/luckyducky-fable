<script setup>
/**
 * 关于我们。首页页脚「关于我们 / Lucky 鸭」两个入口进这里。
 * 文案为初稿（demo·待用户定稿）；自称店名引 constants/brand.js 的 BRAND_NAME 单源（病根#5），
 * 不硬编码。品牌调性沿用首页 BrandIntro「亲手创造随身幸运物」/ ClosingCTA「Get ducky get lucky」。
 */
import CoNavBar from '@/components/CoNavBar.vue'
import { goBack } from '@/utils/nav.js'
import { BRAND_NAME } from '@/constants/brand.js'

const BRAND = BRAND_NAME

const LEAD = '我们希望每个人都能亲手创造自己的随身幸运物。'
// 品牌故事初稿（demo·待定稿）
const SECTIONS = [
  [
    '我们是谁',
    `${BRAND} 是一家专注钩织的材料包品牌。我们把毛线、配件、工具与配套教学打包成一个个材料包，让没有基础的人也能从第一针开始，亲手钩出属于自己的小鸭与小物。`,
  ],
  [
    '我们做什么',
    '每一份材料包都配有分步教学视频：扫码开课，跟着视频一针一线，把一团毛线变成可以随身携带的幸运物。从选材到教学，我们只想让「开始」这件事变得足够简单。',
  ],
  [
    '我们相信',
    'Get ducky get lucky。手作的温度来自亲手完成的那一刻——当你为自己或在乎的人钩出一只小鸭，幸运也随之被你亲手创造出来。',
  ],
]

const back = () => goBack('/pages/index/index')
</script>

<template>
  <view class="co">
    <CoNavBar title="关于我们" @back="back" />
    <view class="co-body">
      <view class="co-card about">
        <image class="about-logo" src="/static/logo-wordmark.svg" mode="widthFix" />
        <text class="about-name">{{ BRAND }}</text>
        <text class="about-lead">{{ LEAD }}</text>
        <view v-for="(s, i) in SECTIONS" :key="i" class="about-sec">
          <text class="about-h">{{ s[0] }}</text>
          <text class="about-p">{{ s[1] }}</text>
        </view>
        <text class="about-note">以上为品牌介绍初稿，正式发布前将定稿。</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

.about {
  padding: 24px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.about-logo {
  width: 160px;
  margin-bottom: 12px;
}
.about-name {
  font-family: $font-display;
  font-weight: 500;
  font-size: 18px;
  color: $content;
  letter-spacing: 0.02em;
}
.about-lead {
  display: block;
  font-family: $font-display;
  font-size: 16px;
  line-height: 1.6;
  color: $content;
  margin: 16px 0 24px;
  max-width: 300px;
}
.about-sec {
  width: 100%;
  text-align: left;
  margin-bottom: 16px;
}
.about-h {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: $content;
  margin-bottom: 6px;
}
.about-p {
  display: block;
  font-size: 13px;
  line-height: 1.8;
  color: $content;
}
.about-note {
  display: block;
  width: 100%;
  text-align: left;
  margin-top: 8px;
  font-size: 12px;
  color: $purple-meta;
}
</style>
